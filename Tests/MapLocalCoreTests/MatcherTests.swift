//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

@Suite("Matcher")
struct MatcherTests {
    static func rule(
        _ id: String,
        method: String = "GET",
        host: String? = nil,
        path: String,
        query: [String: String] = [:],
        enabled: Bool = true,
        status: Int = 200
    ) -> RuleEntry {
        .rule(Rule(
            id: id,
            enabled: enabled,
            match: Match(method: method, host: host, path: path, query: query),
            active: "a",
            responses: ["a": ResponseSpec(status: status, body: .text(id))]
        ))
    }

    static func config(
        _ rules: [RuleEntry],
        hosts: [String] = ["maplocal.invalid"],
        unmatched: Unmatched = .passthrough,
        enabled: Bool = true
    ) -> Configuration {
        Configuration(revision: 7, enabled: enabled, allowedHosts: hosts, unmatched: unmatched, rules: rules)
    }

    static func request(_ url: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: URL(string: url)!)
        request.httpMethod = method
        return request
    }

    @Test("matches path templates", arguments: [
        ("/a/{id}", "/a/1", true), ("/a/{id}", "/a/", false), ("/a/{id}", "/a/1/b", false),
        ("/a/%EA%B0%80", "/a/%EA%B0%80", true), ("/a/b", "/a/b", true), ("/a/b", "/a/c", false),
    ])
    func pathTemplate(template: String, path: String, expected: Bool) {
        #expect(PathTemplate.matches(template: template, path: path) == expected)
    }

    @Test("mocks nothing when there are no allowed hosts")
    func noAllowedHosts() {
        let configuration = Self.config([Self.rule("r", path: "/a")], hosts: [])
        let decision = Matcher.decide(
            Self.request("https://maplocal.invalid/a"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(decision == nil)
    }

    /// Not even the unmatched block applies to it.
    @Test("never matches a blocked host, even when it is also allowed")
    func blockedHost() {
        let configuration = Self.config(
            [Self.rule("r", path: "/a")],
            hosts: ["maplocal.invalid"],
            unmatched: .block(status: 421)
        )
        let decision = Matcher.decide(
            Self.request("https://maplocal.invalid/a"),
            configuration: configuration,
            blockedHosts: ["maplocal.invalid"]
        )
        #expect(decision == nil)
    }

    @Test("the higher rule wins, and disabled or unsupported rules are skipped")
    func order() {
        let configuration = Self.config([
            Self.rule("off", path: "/a", enabled: false),
            .unsupported(raw: .object(["id": .string("u")]), reason: MapLocalMessage(.required, ["key": "id"])),
            Self.rule("first", path: "/a"),
            Self.rule("second", path: "/a"),
        ])
        let decision = Matcher.decide(
            Self.request("https://maplocal.invalid/a"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(decision?.ruleID == "first")
        #expect(decision?.revision == 7)
        #expect(decision?.response.headers["X-Map-Local"] == "first/a")
    }

    @Test("requires the method, host and query to match")
    func conditions() {
        let configuration = Self.config([
            Self.rule("r", method: "POST", host: "maplocal.invalid", path: "/a", query: ["p": "1"]),
        ])
        let matching = Matcher.decide(
            Self.request("https://maplocal.invalid/a?p=1", method: "POST"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(matching?.ruleID == "r")
        let otherMethod = Matcher.decide(
            Self.request("https://maplocal.invalid/a?p=1"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(otherMethod == nil)
        let otherQuery = Matcher.decide(
            Self.request("https://maplocal.invalid/a?p=2", method: "POST"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(otherQuery == nil)
    }

    @Test("blocks unmatched requests with the configured status and body")
    func blockUnmatched() throws {
        let configuration = Self.config([], unmatched: .block(status: 421))
        let decision = try #require(Matcher.decide(
            Self.request("https://maplocal.invalid/x/y"),
            configuration: configuration,
            blockedHosts: []
        ))
        #expect(decision.kind == .unmocked)
        #expect(decision.response.status == 421)
        #expect(
            String(decoding: decision.response.body, as: UTF8.self)
                == #"{"code":"MAP_LOCAL_UNMOCKED","message":"unmocked: /x/y"}"#
        )
    }

    @Test("fails unmatched requests with the configured error instead of answering them")
    func failUnmatched() throws {
        let configuration = Self.config([], unmatched: .fail(.timedOut))
        let decision = try #require(Matcher.decide(
            Self.request("https://maplocal.invalid/x/y"),
            configuration: configuration,
            blockedHosts: []
        ))
        #expect(decision.kind == .unmocked)
        #expect(decision.response.errorCode == URLError.Code.timedOut.rawValue)
        #expect(decision.path == "/x/y")
    }

    @Test("does nothing when Map Local is turned off")
    func turnedOff() {
        let configuration = Self.config([Self.rule("r", path: "/a")], unmatched: .block(status: 421), enabled: false)
        let decision = Matcher.decide(
            Self.request("https://maplocal.invalid/a"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(decision == nil)
    }

    @Test("adds a Content-Type to a JSON body, and an error response carries only its code")
    func buildsResponses() throws {
        let rule = RuleEntry.rule(Rule(
            id: "r",
            match: Match(method: "GET", path: "/a"),
            active: "j",
            responses: [
                "j": ResponseSpec(status: 200, body: .json(.object(["k": .number(1)]))),
                "e": ResponseSpec(error: .timedOut),
            ]
        ))
        let json = try #require(Matcher.decide(
            Self.request("https://maplocal.invalid/a"),
            configuration: Self.config([rule]),
            blockedHosts: []
        ))
        #expect(json.response.headers["Content-Type"] == "application/json")
        guard case var .rule(errorRule) = rule else { return }
        errorRule.active = "e"
        let error = try #require(Matcher.decide(
            Self.request("https://maplocal.invalid/a"),
            configuration: Self.config([.rule(errorRule)]),
            blockedHosts: []
        ))
        #expect(error.response.errorCode == URLError.Code.timedOut.rawValue)
    }

    @Test("a rule with a host does not apply to other allowed hosts")
    func ruleHost() {
        let configuration = Self.config(
            [Self.rule("r", host: "a.invalid", path: "/x")],
            hosts: ["a.invalid", "b.invalid"]
        )
        let sameHost = Matcher.decide(
            Self.request("https://a.invalid/x"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(sameHost?.ruleID == "r")
        let otherHost = Matcher.decide(
            Self.request("https://b.invalid/x"),
            configuration: configuration,
            blockedHosts: []
        )
        #expect(otherHost == nil)
    }
}
#endif
