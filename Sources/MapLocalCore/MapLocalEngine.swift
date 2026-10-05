//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import os

/// One write to the configuration, as the panel asks for it.
public enum ConfigurationChange: Sendable {
    case replace(Configuration)
    /// Changes only the fields that are not nil. `order` lists every rule id in the new order.
    case patch(enabled: Bool?, allowedHosts: [String]?, unmatched: Unmatched?, order: [String]?)
    case upsertRule(Rule)
    case deleteRule(id: String)
    case setActive(ruleID: String, response: String)
    /// The user signed out in the app, so no mocked sign-in session is left in it.
    case acknowledgeMockedSession
}

/// Why `MapLocalEngine.apply` refused a change.
public enum ApplyError: Error, Equatable {
    /// The change was based on an older revision than `current`.
    case conflict(current: Int)
    /// The configuration was opened read-only and cannot be written.
    case readOnly
    case notFound(MapLocalMessage)
    case invalid(MapLocalMessage)
}

/// One request the engine saw, and what it did with it.
public struct RequestEvent: Sendable, Equatable, Codable {
    public enum Outcome: Codable, Sendable, Equatable {
        case passthrough
        case mocked(rule: String, response: String, status: Int?, error: Int?)
        case unmocked(status: Int?, error: Int?)
    }

    /// The order the engine saw requests in, starting from 1 at launch.
    public var seq: Int = 0
    public var date: Date
    public var method: String
    public var host: String
    public var path: String
    public var query: [String: String] = [:]
    public var outcome: Outcome
}

/// Everything the panel shows about the engine, sent again whenever any of it changes.
public struct EngineState: Sendable, Equatable {
    public var configuration: Configuration
    public var readOnly: Bool
    /// Problems found while reading the configuration, such as rules that cannot be applied.
    public var issues: [MapLocalMessage]
    /// Hosts of requests that went to the network, in the order they were first seen.
    public var observedHosts: [String]
    /// Whether the app may still hold a sign-in session that a mocked response created.
    public var mayHoldMockedSession: Bool
    public var blockedHosts: [String] = []
    /// A fresh value every time an engine is created.
    ///
    /// When it changes, the panel knows the app was relaunched. `revision` alone cannot
    /// tell, because a relaunched app may report a revision the panel has already seen.
    public var launchID: String = ""
}

/// Holds the configuration, answers requests from it, and reports what happened.
///
/// Writes are checked against the revision they were based on, saved, and broadcast in
/// one step, so every subscriber sees the states in the order they were made.
public final class MapLocalEngine: Sendable {
    public let blockedHosts: Set<String>
    /// The clock mocked delays wait on. Tests pass a clock they advance by hand.
    public let clock: any Clock<Duration>
    private let store: ConfigurationStore
    private let lock: OSAllocatedUnfairLock<EngineState>
    private let requests = Broadcaster<RequestEvent>(replay: false)
    /// How many request events `recentRequests(limit:)` can return.
    public static let recentCapacity = 500
    private struct RequestLog {
        var seq = 0
        var recent: [RequestEvent] = []
    }
    private let log = OSAllocatedUnfairLock(initialState: RequestLog())
    private let states = Broadcaster<EngineState>(replay: true)

    /// Creates an engine and loads the stored configuration.
    ///
    /// - Parameter blockedHosts: Hosts that are never mocked. Scheme, port, trailing dot and
    ///   case are normalized; a value still not readable as a host is dropped.
    public init(
        store: ConfigurationStore,
        blockedHosts: Set<String>,
        clock: any Clock<Duration> = ContinuousClock()
    ) {
        self.store = store
        self.clock = clock
        self.blockedHosts = Set(blockedHosts.compactMap(HostName.normalize))
        let loaded = store.load()
        let initial = EngineState(
            configuration: loaded.configuration,
            readOnly: loaded.readOnly,
            issues: loaded.issues,
            observedHosts: [],
            mayHoldMockedSession: store.loadAuthMocked(),
            blockedHosts: self.blockedHosts.sorted(),
            launchID: UUID().uuidString
        )
        lock = OSAllocatedUnfairLock(initialState: initial)
        states.send(initial)
    }

    public var state: EngineState { lock.withLock { $0 } }

    /// Returns how to answer `request`, or nil to let it reach the network.
    public func decide(_ request: URLRequest) -> Decision? {
        let configuration = lock.withLock { $0.configuration }
        return Matcher.decide(request, configuration: configuration, blockedHosts: blockedHosts)
    }

    /// Applies a change made on top of `baseRevision`, or throws `ApplyError.conflict`.
    ///
    /// Applying, saving and broadcasting happen under one lock in revision order, because
    /// Necto does not guarantee the order of operations. The broadcast is inside the lock
    /// too, so the last state a subscriber receives is the actual last state.
    @discardableResult
    public func apply(_ change: ConfigurationChange, baseRevision: Int) throws -> Configuration {
        try apply(change, expectedRevision: baseRevision)
    }

    /// Applies a change without checking the revision.
    ///
    /// For writes that cannot know the device's current revision, such as importing a
    /// shared file.
    @discardableResult
    public func applyForcing(_ change: ConfigurationChange) throws -> Configuration {
        try apply(change, expectedRevision: nil)
    }

    private func apply(_ change: ConfigurationChange, expectedRevision: Int?) throws -> Configuration {
        try lock.withLock { state in
            guard !state.readOnly else { throw ApplyError.readOnly }
            if let expectedRevision, state.configuration.revision != expectedRevision {
                throw ApplyError.conflict(current: state.configuration.revision)
            }
            if case .acknowledgeMockedSession = change {
                store.saveAuthMocked(false)
                state.mayHoldMockedSession = false
            }
            var configuration = try Self.applying(change, to: state.configuration)
            configuration.revision = state.configuration.revision + 1
            configuration.version = Configuration.currentVersion
            try store.save(configuration)
            state.configuration = configuration
            state.issues = configuration.unsupportedIssues
            states.send(state)
            return configuration
        }
    }

    static func applying(_ change: ConfigurationChange, to current: Configuration) throws -> Configuration {
        var configuration = current
        switch change {
        case let .replace(new):
            guard new.version <= Configuration.currentVersion else {
                throw ApplyError.invalid(MapLocalMessage(.versionTooNew, [
                    "version": String(new.version),
                    "supported": String(Configuration.currentVersion),
                ]))
            }
            configuration = new
        case let .patch(enabled, hosts, unmatched, order):
            if let enabled { configuration.enabled = enabled }
            if let hosts {
                configuration.allowedHosts = try hosts.map { raw in
                    guard let host = HostName.normalize(raw) else {
                        throw ApplyError.invalid(MapLocalMessage(.invalidHost, ["key": "allowedHosts", "value": raw]))
                    }
                    return host
                }
            }
            if let unmatched { configuration.unmatched = unmatched }
            if let order { configuration.rules = try reordered(configuration.rules, by: order) }
        case let .upsertRule(rule):
            guard rule.responses[rule.active] != nil else {
                throw ApplyError.notFound(MapLocalMessage(.responseNotFound, ["response": rule.active]))
            }
            if let index = configuration.rules.firstIndex(where: { $0.id == rule.id }) {
                configuration.rules[index] = .rule(rule)
            } else {
                configuration.rules.append(.rule(rule))
            }
        case let .deleteRule(id):
            guard let index = configuration.rules.firstIndex(where: { $0.id == id }) else {
                throw ApplyError.notFound(MapLocalMessage(.ruleNotFound, ["rule": id]))
            }
            configuration.rules.remove(at: index)
        case let .setActive(ruleID, response):
            guard let index = configuration.rules.firstIndex(where: { $0.id == ruleID }),
                  case var .rule(rule) = configuration.rules[index]
            else {
                throw ApplyError.notFound(MapLocalMessage(.ruleNotFound, ["rule": ruleID]))
            }
            guard rule.responses[response] != nil else {
                throw ApplyError.notFound(MapLocalMessage(.responseNotFound, ["response": response]))
            }
            rule.active = response
            configuration.rules[index] = .rule(rule)
        case .acknowledgeMockedSession:
            break
        }
        return configuration
    }

    /// Moves only the entries that have an id.
    ///
    /// An unsupported entry without an id cannot be addressed, so it stays where it is.
    static func reordered(_ rules: [RuleEntry], by order: [String]) throws -> [RuleEntry] {
        let ids = rules.compactMap(\.id)
        guard order.count == ids.count, Set(order).count == order.count, Set(order) == Set(ids) else {
            throw ApplyError.invalid(MapLocalMessage(.orderMismatch))
        }
        var next = order.compactMap { id in rules.first { $0.id == id } }.makeIterator()
        return rules.map { $0.id == nil ? $0 : next.next()! }
    }

    /// Records a host in the same canonical form as allowed hosts.
    ///
    /// Otherwise a host with a trailing dot would drop out of the "allowed hosts only"
    /// filter, or be offered as a candidate a second time. A host that cannot be read, such
    /// as an IPv6 address, is recorded as received.
    static func recordedHost(_ host: String) -> String { HostName.normalize(host) ?? host }

    /// Records a request that went to the network, and learns its host.
    public func recordPassthrough(_ request: URLRequest) {
        guard let url = request.url, let raw = url.host()?.lowercased() else { return }
        let host = Self.recordedHost(raw)
        let event = RequestEvent(
            date: Date(),
            method: request.httpMethod ?? "GET",
            host: host,
            path: url.path(),
            query: Self.query(url),
            outcome: .passthrough
        )
        lock.withLock { state in
            if !state.observedHosts.contains(host) {
                state.observedHosts.append(host)
                states.send(state)
            }
        }
        emit(event)
    }

    /// Records a request Map Local answered.
    ///
    /// A response from a rule tagged `auth` may have signed the app in, so the engine
    /// remembers that until the user acknowledges signing out.
    public func recordMocked(_ request: URLRequest, decision: Decision) {
        let host = (request.url?.host()?.lowercased()).map(Self.recordedHost) ?? ""
        let outcome: RequestEvent.Outcome = switch decision.kind {
        case .mock:
            .mocked(
                rule: decision.ruleID ?? "",
                response: decision.responseName ?? "",
                status: decision.response.errorCode == nil ? decision.response.status : nil,
                error: decision.response.errorCode
            )
        case .unmocked:
            .unmocked(
                status: decision.response.errorCode == nil ? decision.response.status : nil,
                error: decision.response.errorCode
            )
        }
        let event = RequestEvent(
            date: Date(),
            method: request.httpMethod ?? "GET",
            host: host,
            path: decision.path,
            query: request.url.map(Self.query) ?? [:],
            outcome: outcome
        )
        lock.withLock { state in
            let isAuthRule = decision.kind == .mock && state.configuration.rules.contains { entry in
                if case let .rule(rule) = entry {
                    rule.id == decision.ruleID && rule.tags.contains("auth")
                } else {
                    false
                }
            }
            if isAuthRule, !state.mayHoldMockedSession {
                store.saveAuthMocked(true)
                state.mayHoldMockedSession = true
                states.send(state)
            }
        }
        emit(event)
    }

    /// The query of a recorded request.
    ///
    /// A repeated key keeps its last value, as in `Matcher`. Values are recorded as is.
    private static func query(_ url: URL) -> [String: String] {
        (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            .reduce(into: [:]) { $0[$1.name] = $1.value ?? "" }
    }

    /// Numbers, keeps and broadcasts an event under one lock, so `seq` order and broadcast
    /// order are the same.
    private func emit(_ event: RequestEvent) {
        log.withLock { log in
            log.seq += 1
            var numbered = event
            numbered.seq = log.seq
            log.recent.append(numbered)
            if log.recent.count > Self.recentCapacity {
                log.recent.removeFirst(log.recent.count - Self.recentCapacity)
            }
            requests.send(numbered)
        }
    }

    /// The most recent request events, newest first, and the last `seq` handed out.
    ///
    /// Lets a panel opened late still show what already happened.
    public func recentRequests(limit: Int) -> (events: [RequestEvent], lastSeq: Int) {
        log.withLock { log in (Array(log.recent.suffix(max(0, limit)).reversed()), log.seq) }
    }

    public func requestEvents() -> AsyncStream<RequestEvent> { requests.stream() }

    /// States as they change. A new subscriber first receives the current state.
    public func stateEvents() -> AsyncStream<EngineState> { states.stream() }
}

/// The one engine in the process, which `MapLocalURLProtocol` reads.
public enum MapLocalRuntime {
    private static let current = OSAllocatedUnfairLock<MapLocalEngine?>(initialState: nil)

    public static var engine: MapLocalEngine? { current.withLock { $0 } }

    /// Installs the engine `make` creates, unless one is already installed.
    ///
    /// The plugin may be created more than once, but there is only ever one engine.
    @discardableResult
    public static func installIfNeeded(_ make: @Sendable () -> MapLocalEngine) -> MapLocalEngine {
        current.withLock { engine in
            if let engine { return engine }
            let new = make()
            engine = new
            return new
        }
    }

    /// For tests only.
    static func replace(_ engine: MapLocalEngine?) { current.withLock { $0 = engine } }
}
#endif
