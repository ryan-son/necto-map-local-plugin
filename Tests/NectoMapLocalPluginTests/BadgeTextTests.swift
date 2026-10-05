//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
@testable import MapLocalCore
import Testing
@testable import NectoMapLocalPlugin

@Suite("BadgeText")
struct BadgeTextTests {
    static let rule = RuleEntry.rule(Rule(
        id: "r",
        match: Match(method: "GET", path: "/a"),
        active: "ok",
        responses: ["ok": ResponseSpec(status: 200)]
    ))

    static func state(
        enabled: Bool = true,
        hosts: [String] = ["a.invalid"],
        rules: [RuleEntry] = [BadgeTextTests.rule],
        auth: Bool = false
    ) -> EngineState {
        EngineState(
            configuration: Configuration(enabled: enabled, allowedHosts: hosts, rules: rules),
            readOnly: false,
            issues: [],
            observedHosts: [],
            mayHoldMockedSession: auth
        )
    }

    @Test("shows 「Map Local」, with a key while a mocked session may remain, the same in every language", arguments: [
        (BadgeTextTests.state(enabled: false), nil as String?),
        (BadgeTextTests.state(enabled: false, auth: true), nil),
        (BadgeTextTests.state(), "Map Local"),
        (BadgeTextTests.state(auth: true), "Map Local 🔑"),
        (BadgeTextTests.state(hosts: [], auth: true), "Map Local 🔑"),
    ])
    func text(state: EngineState, expected: String?) {
        #expect(BadgeText.make(state) == expected)
    }

    @Test("VoiceOver reads the badge as a button that says what it is, in the device's language", arguments: [
        (BadgeTextTests.state(), ["en-US"], "Map Local", "Shows what applies and lets you turn it off"),
        (BadgeTextTests.state(), ["ko-KR"], "Map Local", "적용 중인 내용을 보고 끌 수 있습니다"),
        (BadgeTextTests.state(auth: true), ["en-US"], "Map Local, mocked session", "Shows what applies and lets you turn it off"),
        (BadgeTextTests.state(auth: true), ["ko-KR"], "Map Local, 목업 세션", "적용 중인 내용을 보고 끌 수 있습니다"),
    ])
    func accessibility(state: EngineState, languages: [String], label: String, hint: String) throws {
        let spoken = try #require(BadgeText.accessibility(state, preferredLanguages: languages))
        #expect(spoken.label == label)
        #expect(spoken.hint == hint)
    }

    @Test("shows nothing while Map Local is on but nothing applies", arguments: [
        BadgeTextTests.state(hosts: []),
        BadgeTextTests.state(rules: []),
        BadgeTextTests.state(rules: [
            .rule(Rule(id: "off", enabled: false, match: Match(method: "GET", path: "/a"), active: "ok",
                       responses: ["ok": ResponseSpec(status: 200)])),
        ]),
    ])
    func hiddenWhenNothingApplies(state: EngineState) {
        #expect(BadgeText.make(state) == nil)
        #expect(BadgeText.accessibility(state, preferredLanguages: ["en-US"]) == nil)
    }
}
#endif
