//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

@Suite("MapLocalEngine", .timeLimit(.minutes(1)))
struct EngineTests {
    static let rule = Rule(
        id: "r",
        match: Match(method: "GET", path: "/a"),
        active: "ok",
        responses: ["ok": ResponseSpec(status: 200), "down": ResponseSpec(error: .connectionLost)]
    )

    static let defaultConfiguration = Configuration(
        allowedHosts: ["maplocal.invalid"],
        rules: [.rule(EngineTests.rule)]
    )

    func makeEngine(_ configuration: Configuration = EngineTests.defaultConfiguration) -> MapLocalEngine {
        let store = MemoryConfigurationStore(configuration)
        return MapLocalEngine(store: store, blockedHosts: [])
    }

    func disable() -> ConfigurationChange {
        .patch(enabled: false, allowedHosts: nil, unmatched: nil, order: nil)
    }

    func reorder(_ order: [String]) -> ConfigurationChange {
        .patch(enabled: nil, allowedHosts: nil, unmatched: nil, order: order)
    }

    @Test("each write raises the revision by one and is saved")
    func revision() throws {
        let store = MemoryConfigurationStore(Self.defaultConfiguration)
        let engine = MapLocalEngine(store: store, blockedHosts: [])
        let first = try engine.apply(.setActive(ruleID: "r", response: "down"), baseRevision: 0)
        #expect(first.revision == 1)
        #expect(store.saved.last?.revision == 1)
        let second = try engine.apply(disable(), baseRevision: 1)
        #expect(second.revision == 2)
        #expect(second.enabled == false)
    }

    @Test("a write on a stale revision is refused and does not overwrite the latest configuration")
    func staleRevisionIsRefused() throws {
        let engine = makeEngine()
        _ = try engine.apply(.setActive(ruleID: "r", response: "down"), baseRevision: 0)
        #expect(throws: ApplyError.conflict(current: 1)) {
            try engine.apply(disable(), baseRevision: 0)
        }
        guard case let .rule(rule) = engine.state.configuration.rules.first else {
            Issue.record("no rule")
            return
        }
        #expect(rule.active == "down")
        #expect(engine.state.configuration.enabled == true)
    }

    @Test("refuses switching to a missing rule or response, and an invalid order")
    func invalidChanges() {
        let engine = makeEngine()
        #expect(throws: ApplyError.notFound(MapLocalMessage(.ruleNotFound, ["rule": "x"]))) {
            try engine.apply(.setActive(ruleID: "x", response: "ok"), baseRevision: 0)
        }
        #expect(throws: ApplyError.notFound(MapLocalMessage(.responseNotFound, ["response": "nope"]))) {
            try engine.apply(.setActive(ruleID: "r", response: "nope"), baseRevision: 0)
        }
        #expect(throws: ApplyError.self) {
            try engine.apply(reorder(["zz"]), baseRevision: 0)
        }
    }

    @Test("adds, replaces, deletes and reorders rules")
    func editsRules() throws {
        let engine = makeEngine()
        var second = Self.rule
        second.id = "s"
        _ = try engine.apply(.upsertRule(second), baseRevision: 0)
        _ = try engine.apply(reorder(["s", "r"]), baseRevision: 1)
        #expect(engine.state.configuration.rules.compactMap(\.id) == ["s", "r"])
        _ = try engine.apply(.deleteRule(id: "s"), baseRevision: 2)
        #expect(engine.state.configuration.rules.compactMap(\.id) == ["r"])
    }

    @Test("a configuration from a newer version is read-only and refuses writes")
    func readOnly() {
        let store = MemoryConfigurationStore(Configuration(version: Configuration.currentVersion + 1), readOnly: true)
        let engine = MapLocalEngine(store: store, blockedHosts: [])
        #expect(throws: ApplyError.readOnly) {
            try engine.apply(disable(), baseRevision: 0)
        }
    }

    @Test("the state stream sends the latest state after a change, and a new subscriber gets it at once")
    func stateStream() async throws {
        let engine = makeEngine()
        _ = try engine.apply(.setActive(ruleID: "r", response: "down"), baseRevision: 0)
        var iterator = engine.stateEvents().makeAsyncIterator()
        #expect(await iterator.next()?.configuration.revision == 1)
    }

    @Test("every subscriber receives every request record")
    func broadcastsRecords() async {
        let engine = makeEngine()
        let firstStream = engine.requestEvents(), secondStream = engine.requestEvents()
        engine.recordPassthrough(URLRequest(url: URL(string: "https://other.invalid/p")!))
        var first = firstStream.makeAsyncIterator(), second = secondStream.makeAsyncIterator()
        #expect(await first.next()?.path == "/p")
        #expect(await second.next()?.path == "/p")
        #expect(engine.state.observedHosts == ["other.invalid"])
    }

    /// A trailing dot or different case still names the same single host.
    @Test("records hosts in the same canonical form as allowed hosts")
    func recordsCanonicalHosts() throws {
        let engine = makeEngine()
        engine.recordPassthrough(URLRequest(url: URL(string: "https://API.Example.invalid./x")!))
        engine.recordPassthrough(URLRequest(url: URL(string: "https://api.example.invalid/y")!))
        let mocked = URLRequest(url: URL(string: "https://MAPLOCAL.invalid./a")!)
        engine.recordMocked(mocked, decision: try #require(engine.decide(mocked)))
        #expect(
            engine.recentRequests(limit: 10).events.map(\.host)
                == ["maplocal.invalid", "api.example.invalid", "api.example.invalid"]
        )
        #expect(engine.state.observedHosts == ["api.example.invalid"])
    }

    @Test("records a host with no canonical form, such as IPv6, as received")
    func recordsIPv6HostAsReceived() throws {
        let engine = makeEngine()
        let url = try #require(URL(string: "http://[::1]:8080/x"))
        engine.recordPassthrough(URLRequest(url: url))
        #expect(engine.recentRequests(limit: 1).events.first?.host == url.host()?.lowercased())
    }

    @Test("marks a mocked session when a rule tagged auth answers")
    func marksMockedSession() throws {
        var auth = Self.rule
        auth.tags = ["auth"]
        let engine = makeEngine(Configuration(allowedHosts: ["maplocal.invalid"], rules: [.rule(auth)]))
        let request = URLRequest(url: URL(string: "https://maplocal.invalid/a")!)
        let decision = try #require(engine.decide(request))
        engine.recordMocked(request, decision: decision)
        #expect(engine.state.mayHoldMockedSession)
    }

    @Test("reordering leaves an unsupported entry without an id in place")
    func reorderKeepsEntryWithoutID() throws {
        var ruleB = Self.rule
        ruleB.id = "b"
        let orphan = RuleEntry.unsupported(raw: .object(["future": .number(1)]), reason: MapLocalMessage(.required, ["key": "id"]))
        let engine = makeEngine(Configuration(
            allowedHosts: ["maplocal.invalid"],
            rules: [orphan, .rule(Self.rule), .rule(ruleB)]
        ))
        _ = try engine.apply(reorder(["b", "r"]), baseRevision: 0)
        #expect(engine.state.configuration.rules == [orphan, .rule(ruleB), .rule(Self.rule)])
    }

    @Test("refuses an order with the same id twice")
    func reorderRefusesDuplicates() {
        var ruleB = Self.rule
        ruleB.id = "b"
        let engine = makeEngine(Configuration(
            allowedHosts: ["maplocal.invalid"],
            rules: [.rule(Self.rule), .rule(ruleB)]
        ))
        #expect(throws: ApplyError.self) {
            try engine.apply(reorder(["b", "b", "r"]), baseRevision: 0)
        }
        #expect(engine.state.configuration.rules.count == 2)
    }

    @Test("does not replace the configuration with one from a newer version than the plugin")
    func refusesNewerReplacement() {
        let engine = makeEngine()
        #expect(throws: ApplyError.self) {
            try engine.apply(.replace(Configuration(version: Configuration.currentVersion + 1)), baseRevision: 0)
        }
        #expect(engine.state.configuration.revision == 0)
    }

    @Test("leaves the state in memory unchanged when saving fails")
    func saveFailure() {
        let store = MemoryConfigurationStore(Configuration(allowedHosts: ["maplocal.invalid"]))
        let engine = MapLocalEngine(store: store, blockedHosts: [])
        store.failSaving()
        #expect(throws: (any Error).self) {
            try engine.apply(disable(), baseRevision: 0)
        }
        #expect(engine.state.configuration.enabled == true)
        #expect(engine.state.configuration.revision == 0)
    }

    @Test("an untagged rule or an unmatched block does not mark a mocked session")
    func doesNotMarkMockedSession() throws {
        let engine = makeEngine(Configuration(
            allowedHosts: ["maplocal.invalid"],
            unmatched: .block(status: 421),
            rules: [.rule(Self.rule)]
        ))
        let mocked = URLRequest(url: URL(string: "https://maplocal.invalid/a")!)
        engine.recordMocked(mocked, decision: try #require(engine.decide(mocked)))
        let blocked = URLRequest(url: URL(string: "https://maplocal.invalid/zzz")!)
        engine.recordMocked(blocked, decision: try #require(engine.decide(blocked)))
        #expect(engine.state.mayHoldMockedSession == false)
    }

    @Test("the mocked session mark survives a relaunch of the app")
    func mockedSessionSurvivesRelaunch() throws {
        var auth = Self.rule
        auth.tags = ["auth"]
        let store = MemoryConfigurationStore(Configuration(allowedHosts: ["maplocal.invalid"], rules: [.rule(auth)]))
        let first = MapLocalEngine(store: store, blockedHosts: [])
        let request = URLRequest(url: URL(string: "https://maplocal.invalid/a")!)
        first.recordMocked(request, decision: try #require(first.decide(request)))
        #expect(MapLocalEngine(store: store, blockedHosts: []).state.mayHoldMockedSession)
    }

    @Test(
        "never mocks a blocked host, whatever its scheme, port, trailing dot or case",
        arguments: ["prod.invalid:443", "HTTPS://Prod.invalid", "prod.invalid."]
    )
    func normalizesBlockedHosts(blocked: String) {
        let engine = MapLocalEngine(
            store: MemoryConfigurationStore(Configuration(
                allowedHosts: ["prod.invalid"],
                unmatched: .block(status: 421),
                rules: [.rule(Self.rule)]
            )),
            blockedHosts: [blocked]
        )
        for url in ["https://prod.invalid/a", "https://PROD.invalid:443/a", "https://prod.invalid./a"] {
            #expect(engine.decide(URLRequest(url: URL(string: url)!)) == nil, "\(url)")
        }
        #expect(engine.state.blockedHosts == ["prod.invalid"])
    }

    /// It must be the same value Necto records, or the two cannot be paired.
    @Test("records the path as is, JWT segments included")
    func recordsRawPath() async {
        let engine = makeEngine()
        var events = engine.requestEvents().makeAsyncIterator()
        engine.recordPassthrough(URLRequest(
            url: URL(string: "https://other.invalid/verify/eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2ln/done")!
        ))
        #expect(await events.next()?.path == "/verify/eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2ln/done")
    }

    /// A repeated query key keeps its last value, as in `Matcher`.
    @Test("records a seq rising from 1 within a launch and the original query values")
    func recordsSeqAndQuery() {
        let engine = makeEngine()
        engine.recordPassthrough(URLRequest(
            url: URL(string: "https://maplocal.invalid/a?page=1&page=2&access_token=abc")!
        ))
        engine.recordPassthrough(URLRequest(url: URL(string: "https://maplocal.invalid/b")!))
        let recent = engine.recentRequests(limit: 10)
        #expect(recent.lastSeq == 2)
        #expect(recent.events.map(\.seq) == [2, 1])
        #expect(recent.events[1].query == ["page": "2", "access_token": "abc"])
        #expect(recent.events[0].query == [:])
    }

    @Test("keeps only the latest 500 records while lastSeq keeps rising")
    func capsRecentRecords() {
        let engine = makeEngine()
        for index in 0..<510 {
            engine.recordPassthrough(URLRequest(url: URL(string: "https://maplocal.invalid/\(index)")!))
        }
        let recent = engine.recentRequests(limit: 1000)
        #expect(recent.events.count == MapLocalEngine.recentCapacity)
        #expect(recent.lastSeq == 510)
        #expect(recent.events.first?.path == "/509")
    }
}
#endif
