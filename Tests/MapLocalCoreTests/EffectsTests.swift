//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

@Suite("Effects")
struct EffectsTests {
    static func rule(
        _ id: String = "r",
        enabled: Bool = true,
        host: String? = nil,
        auth: Bool = false,
        active: String = "ok"
    ) -> RuleEntry {
        .rule(Rule(
            id: id,
            enabled: enabled,
            tags: auth ? ["auth"] : [],
            match: Match(method: "GET", host: host, path: "/a"),
            active: active,
            responses: ["ok": ResponseSpec(status: 200)]
        ))
    }

    static func state(
        enabled: Bool = true,
        hosts: [String] = ["a.invalid"],
        unmatched: Unmatched = .passthrough,
        rules: [RuleEntry] = [],
        blocked: [String] = [],
        session: Bool = false
    ) -> EngineState {
        EngineState(
            configuration: Configuration(enabled: enabled, allowedHosts: hosts, unmatched: unmatched, rules: rules),
            readOnly: false,
            issues: [],
            observedHosts: [],
            mayHoldMockedSession: session,
            blockedHosts: blocked
        )
    }

    @Test("nothing applies, so there are no effects", arguments: [
        EffectsTests.state(enabled: false, rules: [EffectsTests.rule()]),
        EffectsTests.state(enabled: false, unmatched: .block(status: 421), session: true),
        EffectsTests.state(),
        EffectsTests.state(hosts: [], rules: [EffectsTests.rule()]),
        EffectsTests.state(hosts: [], unmatched: .block(status: 421)),
        EffectsTests.state(rules: [EffectsTests.rule(enabled: false)]),
        EffectsTests.state(rules: [EffectsTests.rule(host: "other.invalid")]),
        EffectsTests.state(rules: [EffectsTests.rule(active: "missing")]),
        EffectsTests.state(rules: [EffectsTests.rule()], blocked: ["a.invalid"]),
        EffectsTests.state(unmatched: .block(status: 421), blocked: ["a.invalid"]),
        EffectsTests.state(
            rules: [.unsupported(raw: .object(["id": .string("u")]), reason: MapLocalMessage(.ruleUnsupported))]
        ),
    ])
    func none(state: EngineState) {
        #expect(state.effects == nil)
    }

    @Test("an enabled rule on an allowed host applies; one for any host counts once per rule")
    func mocking() throws {
        let state = Self.state(
            hosts: ["a.invalid", "b.invalid", "blocked.invalid"],
            rules: [
                Self.rule("any"),
                // Another path, so the rule for any host does not shadow it.
                Self.on("b", "GET", "/b", host: "b.invalid"),
                Self.rule("off", enabled: false),
                Self.rule("elsewhere", host: "c.invalid"),
                Self.rule("blocked", host: "blocked.invalid"),
            ],
            blocked: ["blocked.invalid"]
        )
        let effects = try #require(state.effects)
        #expect(effects.mockingRules == 2)
        #expect(effects.rules.map(\.id) == ["any", "b"])
        #expect(effects.hosts == ["a.invalid", "b.invalid"])
        #expect(effects.unmatched == nil)
        #expect(!effects.mayHoldMockedSession)
        #expect(!effects.sessionAtRisk)
    }

    @Test("blocking requests without a rule applies with an allowed host, even with no rule")
    func blocking() throws {
        let effects = try #require(Self.state(unmatched: .block(status: 421)).effects)
        #expect(effects.mockingRules == 0)
        #expect(effects.unmatched == .block(status: 421))
    }

    @Test("failing requests without a rule applies with an allowed host, even with no rule")
    func failing() throws {
        let effects = try #require(Self.state(unmatched: .fail(.notConnectedToInternet)).effects)
        #expect(effects.mockingRules == 0)
        #expect(effects.unmatched == .fail(.notConnectedToInternet))
        #expect(Self.state(hosts: [], unmatched: .fail(.timedOut)).effects == nil)
    }

    @Test("a mocked session that may remain applies while Map Local is on, even with no rule")
    func session() throws {
        let effects = try #require(Self.state(hosts: [], session: true).effects)
        #expect(effects.mockingRules == 0)
        #expect(effects.unmatched == nil)
        #expect(effects.mayHoldMockedSession)
        #expect(!effects.sessionAtRisk)
    }

    static func on(
        _ id: String,
        _ method: String = "GET",
        _ path: String = "/a",
        host: String? = nil,
        query: [String: String] = [:],
        enabled: Bool = true,
        active: String = "ok"
    ) -> RuleEntry {
        .rule(Rule(
            id: id,
            enabled: enabled,
            match: Match(method: method, host: host, path: path, query: query),
            active: active,
            responses: ["ok": ResponseSpec(status: 200)]
        ))
    }

    @Test("a rule an earlier rule always wins over cannot answer, so it is not counted", arguments: [
        // An identical earlier rule.
        ([EffectsTests.on("first"), EffectsTests.on("second")], ["a.invalid"], ["first"]),
        // A template earlier rule takes every path the literal one matches.
        ([EffectsTests.on("t", "GET", "/a/{id}"), EffectsTests.on("one", "GET", "/a/1")], ["a.invalid"], ["t"]),
        // A rule for any host takes the requests of a rule for one of them.
        ([EffectsTests.on("any"), EffectsTests.on("a", host: "a.invalid")], ["a.invalid", "b.invalid"], ["any"]),
        // With a single allowed host, a rule for it takes every request a rule for any host gets.
        ([EffectsTests.on("a", host: "a.invalid"), EffectsTests.on("any")], ["a.invalid"], ["a"]),
        // The same query conditions, in either order.
        (
            [EffectsTests.on("p", query: ["page": "2", "q": "x"]), EffectsTests.on("p2", query: ["q": "x", "page": "2"])],
            ["a.invalid"], ["p"]
        ),
    ])
    func shadowed(rules: [RuleEntry], hosts: [String], expected: [String]) throws {
        let effects = try #require(Self.state(hosts: hosts, rules: rules).effects)
        #expect(effects.rules.map(\.id) == expected)
        #expect(effects.mockingRules == expected.count)
    }

    @Test("a rule that wins some request is counted", arguments: [
        // A literal earlier rule leaves the template rule every other segment.
        [EffectsTests.on("one", "GET", "/a/1"), EffectsTests.on("t", "GET", "/a/{id}")],
        // A template never matches an empty segment.
        [EffectsTests.on("t", "GET", "/a/{id}"), EffectsTests.on("empty", "GET", "/a/")],
        // The later rule has more query conditions, so it wins where they hold.
        [EffectsTests.on("general"), EffectsTests.on("page", query: ["page": "2"])],
        // The earlier rule has more conditions, so the later one wins where they do not hold.
        [EffectsTests.on("page", query: ["page": "2"]), EffectsTests.on("general")],
        // Different values, methods or paths.
        [EffectsTests.on("p2", query: ["page": "2"]), EffectsTests.on("p3", query: ["page": "3"])],
        [EffectsTests.on("get"), EffectsTests.on("post", "POST")],
        [EffectsTests.on("a"), EffectsTests.on("b", "GET", "/b")],
        // A rule for one host leaves a rule for any host the other allowed hosts.
        [EffectsTests.on("a", host: "a.invalid"), EffectsTests.on("any")],
    ])
    func notShadowed(rules: [RuleEntry]) throws {
        let effects = try #require(Self.state(hosts: ["a.invalid", "b.invalid"], rules: rules).effects)
        #expect(effects.rules.map(\.id) == rules.compactMap(\.id))
    }

    @Test("an earlier rule that is off or has no active response does not shadow a later one", arguments: [
        EffectsTests.on("off", enabled: false),
        EffectsTests.on("broken", active: "missing"),
    ])
    func idleDoesNotShadow(earlier: RuleEntry) throws {
        let effects = try #require(Self.state(rules: [earlier, Self.on("live")]).effects)
        #expect(effects.rules.map(\.id) == ["live"])
    }

    @Test("the session is at risk only when an enabled auth rule answers an allowed host", arguments: [
        ([EffectsTests.rule(auth: true)], true, true),
        ([EffectsTests.rule(auth: true, active: "missing")], true, true),
        ([EffectsTests.rule(auth: true)], false, false),
        ([EffectsTests.rule(enabled: false, auth: true), EffectsTests.rule()], true, false),
        ([EffectsTests.rule(host: "a.invalid", auth: true)], true, true),
        ([EffectsTests.rule(host: "other.invalid", auth: true), EffectsTests.rule()], true, false),
        ([EffectsTests.rule()], true, false),
    ])
    func risk(rules: [RuleEntry], session: Bool, expected: Bool) {
        #expect(Self.state(rules: rules, session: session).effects?.sessionAtRisk == expected)
    }
}
#endif
