//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import MapLocalCore
import NectoModel
import NectoSDK

/// Answers an app's requests with responses defined in the Map Local panel.
///
/// Register it like any other Necto plugin. Creating it installs one engine for the
/// process and puts its `URLProtocol` in front of `URLSession.shared` and of every
/// configuration made afterwards, so the app makes no other changes. A configuration that
/// replaces its `protocolClasses` needs `protocolClass` added back.
///
/// ```swift
/// NectoSDK.register(NectoMapLocalPlugin(blockedHosts: ["api.example.com"]))
/// NectoSDK.start()
/// ```
///
/// Only two outcomes of a write are answered as data, `ok: false` with `reason` `conflict`
/// or `readOnly`, because the panel acts on them. Every other failure throws a
/// `NectoBridgeError` with an English message, so Necto fails the call and the CLI exits
/// nonzero. Both carry a `code` from `MessageCode`, its `params`, an English `message` and
/// the current `revision`; a thrown error carries them, with its `reason`, in `details`.
public struct NectoMapLocalPlugin: NectoPlugin {
    static let pluginID = "io.github.ryan-son.maplocal"
    public let id = NectoMapLocalPlugin.pluginID

    /// - Parameters:
    ///   - blockedHosts: Hosts that are never mocked, such as production servers. The panel
    ///     cannot change them.
    ///   - store: Where the configuration is kept. Defaults to a file in the app's container.
    public init(blockedHosts: [String] = [], store: ConfigurationStore? = nil) {
        MapLocalRuntime.installIfNeeded {
            MapLocalEngine(store: store ?? FileConfigurationStore.standard(), blockedHosts: Set(blockedHosts))
        }
        MapLocalInstaller.installIfNeeded()
        #if canImport(UIKit) && !os(macOS) && !targetEnvironment(macCatalyst)
        MapLocalBadge.startIfNeeded()
        #endif
    }

    /// For apps that build their own `URLSessionConfiguration`.
    ///
    /// A configuration whose `protocolClasses` is replaced outright, as some SDKs do, loses
    /// Map Local. Put this class back in front, inside `#if DEBUG`:
    ///
    /// ```swift
    /// #if DEBUG
    /// configuration.protocolClasses = [NectoMapLocalPlugin.protocolClass] + (configuration.protocolClasses ?? [])
    /// #endif
    /// ```
    ///
    /// The class reads the engine at request time, so a configuration may list it before
    /// the plugin is created.
    public static var protocolClass: AnyClass { MapLocalURLProtocol.self }

    /// Discards the cookies Map Local's mocks wrote and brings the real ones back.
    ///
    /// The same as `maplocal.cookies.restore`. Call it inside `#if DEBUG`.
    @discardableResult
    public static func restoreMockedCookies(scope: CookieScope = .all) throws -> CookieChange {
        guard let engine = MapLocalRuntime.engine else { throw MapLocalMessage(.engineMissing) }
        return try engine.restoreMockedCookies(scope: scope)
    }

    public var panel: NectoPluginPanel? { PanelWriter.write().map(NectoPluginPanel.init(root:)) }

    public func register(_ necto: NectoRegistrar) {
        for operation in MapLocalOperation.allCases {
            switch operation.kind {
            case .stream:
                necto.handle(operation.rawValue) { _, out in
                    guard let engine = MapLocalRuntime.engine,
                          let stream = Self.stream(operation, engine: engine)
                    else {
                        return
                    }
                    for await value in stream {
                        await out.send(value)
                    }
                }
            case .once:
                necto.handle(operation.rawValue) { input in
                    try await Self.perform(operation, input: input, engine: MapLocalRuntime.engine)
                }
            }
        }
    }

    static func stream(_ operation: MapLocalOperation, engine: MapLocalEngine) -> AsyncStream<NectoJSONValue>? {
        switch operation {
        case .stateObserve:
            AsyncStream { continuation in
                let task = Task {
                    for await state in engine.stateEvents() {
                        continuation.yield(encode(state))
                    }
                    continuation.finish()
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        case .requestsObserve:
            AsyncStream { continuation in
                let task = Task {
                    for await event in engine.requestEvents() {
                        continuation.yield(Self.encode(event))
                    }
                    continuation.finish()
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        default:
            nil
        }
    }

    static func perform(
        _ operation: MapLocalOperation,
        input: NectoJSONValue,
        engine: MapLocalEngine?
    ) async throws -> NectoJSONValue {
        guard let engine else {
            throw rejection(.operationUnavailable, "unavailable", MapLocalMessage(.engineMissing), revision: 0)
        }
        let revision = { engine.state.configuration.revision }
        let json = try input.decode(JSONValue.self)
        do {
            try checkInput(operation, json)
        } catch let message as MapLocalMessage {
            throw rejection(.invalidInput, "invalid", message, revision: revision())
        }
        switch operation {
        case .state:
            return encode(engine.state)
        case .configurationExport:
            let configuration = ConfigurationCodec.encode(engine.state.configuration)
            return (try? NectoJSONValue(encoding: JSONValue.object(["configuration": configuration]))) ?? .null
        case .requestsList:
            let recent = engine.recentRequests(limit: json["limit"]?.intValue ?? MapLocalEngine.recentCapacity)
            return .object([
                "events": .array(recent.events.map(encode)),
                "lastSeq": .number(Double(recent.lastSeq)),
            ])
        case .cookiesList:
            return encode(engine.mockedCookieListing())
        case .cookiesRestore:
            let scope = json["scope"]?.stringValue.flatMap(CookieScope.init(rawValue:)) ?? .all
            do {
                return encode(try engine.restoreMockedCookies(scope: scope), state: engine.state)
            } catch let message as MapLocalMessage {
                throw rejection(.operationUnavailable, "unavailable", message, revision: revision())
            } catch let failure as CookieSaveFailure {
                let message = MapLocalMessage(.cookieJournalSaveFailed, ["error": failure.error])
                guard case var .object(object) = message.json else { throw failure }
                object["reason"] = .string("storage")
                object["revision"] = .number(Double(revision()))
                for action in [CookieEntryResult.Action.deleted, .restored, .skipped] {
                    object[action.rawValue] = .number(Double(failure.change.count(action)))
                }
                throw NectoBridgeError(
                    code: .providerFailed,
                    message: message.text,
                    details: (try? NectoJSONValue(encoding: JSONValue.object(object))) ?? .null
                )
            }
        default:
            break
        }
        do {
            let change = try change(for: operation, json)
            let configuration: Configuration
            if operation == .configurationReplace, json["force"] == .bool(true) {
                configuration = try engine.applyForcing(change)
            } else {
                guard let base = json["baseRevision"]?.intValue else {
                    throw ApplyError.invalid(MapLocalMessage(.required, ["key": "baseRevision"]))
                }
                configuration = try engine.apply(change, baseRevision: base)
            }
            return .object(["ok": .bool(true), "revision": .number(Double(configuration.revision))])
        } catch let error as ApplyError {
            switch error {
            case .conflict:
                return failure("conflict", MapLocalMessage(.conflict), revision: revision())
            case .readOnly:
                return failure("readOnly", MapLocalMessage(.readOnly), revision: revision())
            case let .notFound(message):
                throw rejection(.operationUnavailable, "notFound", message, revision: revision())
            case let .invalid(message):
                throw rejection(.invalidInput, "invalid", message, revision: revision())
            }
        } catch let message as MapLocalMessage {
            throw rejection(.invalidInput, "invalid", message, revision: revision())
        } catch {
            throw rejection(
                .providerFailed,
                "storage",
                MapLocalMessage(.saveFailed, ["error": error.localizedDescription]),
                revision: revision()
            )
        }
    }

    /// The checks `inputSchema` makes in the manifest, repeated for callers that skip Necto
    /// and kept equal to it by `ContractTests`.
    static func checkInput(_ operation: MapLocalOperation, _ json: JSONValue) throws {
        guard let object = json.objectValue else { throw MapLocalMessage(.mustBeObject, ["key": "input"]) }
        if let unknown = Set(object.keys).subtracting(operation.inputKeys).sorted().first {
            throw MapLocalMessage(.unsupportedKey, ["place": "input", "key": unknown])
        }
        if let missing = operation.requiredKeys.subtracting(object.keys).sorted().first {
            throw MapLocalMessage(.required, ["key": missing])
        }
        if let base = object["baseRevision"], (base.intValue ?? -1) < 0 {
            throw MapLocalMessage(.mustBeIntegerAtLeast, ["key": "baseRevision", "min": "0"])
        }
        if let limit = object["limit"] {
            let range = 1...MapLocalEngine.recentCapacity
            guard let value = limit.intValue, range.contains(value) else {
                throw MapLocalMessage(.outOfRange, ["key": "limit", "min": "1", "max": String(range.upperBound)])
            }
        }
        if let scope = object["scope"], scope.stringValue.flatMap(CookieScope.init(rawValue:)) == nil {
            throw MapLocalMessage(.mustBeOneOf, ["key": "scope", "choices": "all, earlierLaunches"])
        }
        for key in ["id", "response"] {
            if let value = object[key], value.stringValue == nil {
                throw MapLocalMessage(.mustBeString, ["key": key])
            }
        }
    }

    /// Reads the input of a write operation into the change it asks for.
    static func change(for operation: MapLocalOperation, _ json: JSONValue) throws -> ConfigurationChange {
        switch operation {
        case .configurationReplace:
            guard let document = json["configuration"] else {
                throw ApplyError.invalid(MapLocalMessage(.required, ["key": "configuration"]))
            }
            if let force = json["force"], force.boolValue == nil {
                throw ApplyError.invalid(MapLocalMessage(.mustBeBoolean, ["key": "force"]))
            }
            return .replace(try ConfigurationCodec.decode(document))
        case .configurationPatch:
            if let acknowledgement = json["authMocked"] {
                guard acknowledgement == .bool(false) else {
                    throw ApplyError.invalid(MapLocalMessage(.authMockedOnlyFalse))
                }
                guard json.objectValue?.keys.allSatisfy({ $0 == "authMocked" || $0 == "baseRevision" }) == true else {
                    throw ApplyError.invalid(MapLocalMessage(.authMockedAlone))
                }
                return .acknowledgeMockedSession
            }
            let order = try json["order"].map { value -> [String] in
                guard let items = value.arrayValue, items.allSatisfy({ $0.stringValue != nil }) else {
                    throw ApplyError.invalid(MapLocalMessage(.mustBeStringArray, ["key": "order"]))
                }
                return items.compactMap(\.stringValue)
            }
            return .patch(
                enabled: try ConfigurationCodec.decodeBool(json["enabled"], at: "enabled"),
                allowedHosts: try json["allowedHosts"].map { try ConfigurationCodec.decodeHosts($0) },
                unmatched: try json["unmatched"].map(ConfigurationCodec.decodeUnmatched),
                order: order
            )
        case .ruleUpsert:
            guard let ruleJSON = json["rule"] else { throw ApplyError.invalid(MapLocalMessage(.required, ["key": "rule"])) }
            switch ConfigurationCodec.decodeRule(ruleJSON) {
            case let .rule(rule): return .upsertRule(rule)
            case let .unsupported(_, reason): throw ApplyError.invalid(reason)
            }
        case .ruleDelete:
            guard let id = json["id"]?.stringValue else { throw ApplyError.invalid(MapLocalMessage(.required, ["key": "id"])) }
            return .deleteRule(id: id)
        case .ruleSetActive:
            guard let id = json["id"]?.stringValue, let response = json["response"]?.stringValue else {
                throw ApplyError.invalid(MapLocalMessage(.required, ["key": "id"]))
            }
            return .setActive(ruleID: id, response: response)
        case .state, .stateObserve, .requestsObserve, .requestsList, .configurationExport, .cookiesRestore, .cookiesList:
            throw ApplyError.invalid(MapLocalMessage(.notWriteOperation))
        }
    }

    /// The full state, for editing. It goes over the loopback only to the Necto Mac app.
    static func encode(_ state: EngineState) -> NectoJSONValue {
        var object: [String: JSONValue] = [
            "revision": .number(Double(state.configuration.revision)),
            "configuration": ConfigurationCodec.encode(state.configuration),
            "readOnly": .bool(state.readOnly),
            "issues": .array(state.issues.map { .string($0.text) }),
            // The same issues with their codes, for the panel to translate. `issues` stays
            // plain English text for the CLI and older panels.
            "issueDetails": .array(state.issues.map(\.json)),
            "observedHosts": .array(state.observedHosts.map(JSONValue.string)),
            "blockedHosts": .array(state.blockedHosts.map(JSONValue.string)),
            "authMocked": .bool(state.mayHoldMockedSession),
            "launchID": .string(state.launchID),
        ]
        object["mockedCookies"] = .number(Double(state.mockedCookies))
        object["setAsideCookies"] = .number(Double(state.setAsideCookies))
        if let change = state.lastCookieChange { object["lastCookieChange"] = encodeSummary(change) }
        return (try? NectoJSONValue(encoding: JSONValue.object(object))) ?? .null
    }

    static func encodeSummary(_ change: CookieChange) -> JSONValue {
        var object: [String: JSONValue] = [
            "trigger": .string(change.trigger.rawValue),
            "date": .number((change.date.timeIntervalSince1970 * 1000).rounded()),
        ]
        for action in [CookieEntryResult.Action.deleted, .restored, .skipped, .reapplied, .dropped] {
            object[action.rawValue] = .number(Double(change.count(action)))
        }
        return .object(object)
    }

    /// The answer to `maplocal.cookies.restore`. Keys only, never values.
    static func encode(_ change: CookieChange, state: EngineState) -> NectoJSONValue {
        let json: JSONValue = .object([
            "ok": .bool(true),
            "revision": .number(Double(state.configuration.revision)),
            "mockedCookies": .number(Double(state.mockedCookies)),
            "setAsideCookies": .number(Double(state.setAsideCookies)),
            "deleted": .number(Double(change.count(.deleted))),
            "restored": .number(Double(change.count(.restored))),
            "skipped": .number(Double(change.count(.skipped))),
            "entries": .array(change.results.map { result in
                .object([
                    "domain": .string(result.key.domain),
                    "path": .string(result.key.path),
                    "name": .string(result.key.name),
                    "action": .string(result.action.rawValue),
                ])
            }),
        ])
        return (try? NectoJSONValue(encoding: json)) ?? .null
    }

    /// The answer to `maplocal.cookies.list`. Keys only, never values.
    static func encode(_ listing: [CookieListing]) -> NectoJSONValue {
        let json: JSONValue = .object(["entries": .array(listing.map { item in
            .object([
                "domain": .string(item.key.domain),
                "path": .string(item.key.path),
                "name": .string(item.key.name),
                "layer": .string(item.layer.rawValue),
                "launch": .string(item.isCurrentLaunch ? "current" : "earlier"),
            ])
        })])
        return (try? NectoJSONValue(encoding: json)) ?? .null
    }

    /// Sends dates as milliseconds since 1970, which JavaScript reads directly with
    /// `new Date(date)`. Foundation's default is seconds since 2001.
    static func encode(_ event: RequestEvent) -> NectoJSONValue {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        guard let data = try? encoder.encode(event) else { return .null }
        return (try? JSONDecoder().decode(NectoJSONValue.self, from: data)) ?? .null
    }

    /// `{ok: false, reason, code, params, message, cause?, revision}`, for `conflict` and
    /// `readOnly` only.
    static func failure(_ reason: String, _ message: MapLocalMessage, revision: Int) -> NectoJSONValue {
        guard case var .object(object) = details(reason, message, revision: revision) else { return .null }
        object["ok"] = .bool(false)
        return .object(object)
    }

    /// A failure Necto reports as an error. `details` holds what `failure` would answer,
    /// without `ok`, so the panel can translate it by its code.
    static func rejection(
        _ code: NectoBridgeErrorCode,
        _ reason: String,
        _ message: MapLocalMessage,
        revision: Int
    ) -> NectoBridgeError {
        NectoBridgeError(code: code, message: message.text, details: details(reason, message, revision: revision))
    }

    static func details(_ reason: String, _ message: MapLocalMessage, revision: Int) -> NectoJSONValue {
        guard case var .object(object) = message.json else { return .null }
        object["reason"] = .string(reason)
        object["revision"] = .number(Double(revision))
        return (try? NectoJSONValue(encoding: JSONValue.object(object))) ?? .null
    }
}
#endif
