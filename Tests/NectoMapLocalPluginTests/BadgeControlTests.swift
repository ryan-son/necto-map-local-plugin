//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
@testable import MapLocalCore
import Testing
@testable import NectoMapLocalPlugin

@Suite("BadgeControl", .timeLimit(.minutes(1)))
struct BadgeControlTests {
    static func rule(_ id: String = "r", host: String? = nil, auth: Bool = false) -> RuleEntry {
        .rule(Rule(
            id: id,
            tags: auth ? ["auth"] : [],
            match: Match(method: "GET", host: host, path: "/\(id)"),
            active: "ok",
            responses: ["ok": ResponseSpec(status: 200)]
        ))
    }

    static func engine(
        _ configuration: Configuration,
        authMocked: Bool = false,
        readOnly: Bool = false,
        blocked: Set<String> = []
    ) -> MapLocalEngine {
        MapLocalEngine(
            store: MemoryConfigurationStore(configuration, readOnly: readOnly, authMocked: authMocked),
            blockedHosts: blocked
        )
    }

    static func effects(rules count: Int, block: Bool = false, fail: MockError? = nil) -> Effects {
        let rules = (0..<count).map { index -> Rule in
            Rule(
                id: "r\(index)",
                match: Match(method: index == 0 ? "POST" : "GET", path: "/items/\(index)",
                             query: index == 1 ? ["page": "2", "a": "b"] : [:]),
                active: "ok",
                responses: ["ok": ResponseSpec(status: 200)]
            )
        }
        return Effects(
            rules: rules,
            hosts: ["a.invalid"],
            unmatched: block ? .block(status: 421) : fail.map(Unmatched.fail),
            mayHoldMockedSession: false,
            sessionAtRisk: false
        )
    }

    @Test("the message names what applies: a count, up to three rules as the panel labels them, the rest as a count, and blocking", arguments: [
        (BadgeControlTests.effects(rules: 0, block: true), ["en-US"], "Blocked: requests without a rule"),
        (BadgeControlTests.effects(rules: 0, block: true), ["ko-KR"], "차단: 규칙 없는 요청"),
        (BadgeControlTests.effects(rules: 0, fail: .notConnectedToInternet), ["en-US"], "No internet connection: requests without a rule"),
        (BadgeControlTests.effects(rules: 0, fail: .notConnectedToInternet), ["ko-KR"], "인터넷 연결 없음: 규칙 없는 요청"),
        (BadgeControlTests.effects(rules: 0, fail: .connectionLost), ["en-US"], "Connection lost: requests without a rule"),
        (BadgeControlTests.effects(rules: 0, fail: .connectionLost), ["ko-KR"], "연결 끊김: 규칙 없는 요청"),
        (BadgeControlTests.effects(rules: 0, fail: .timedOut), ["en-US"], "Timed out: requests without a rule"),
        (BadgeControlTests.effects(rules: 0, fail: .timedOut), ["ko-KR"], "시간 초과: 규칙 없는 요청"),
        (BadgeControlTests.effects(rules: 1), ["en-US"], """
        Mock rules applying: 1
        POST /items/0
        """),
        (BadgeControlTests.effects(rules: 1), ["ko-KR"], """
        목업 규칙 1개가 적용 중입니다
        POST /items/0
        """),
        (BadgeControlTests.effects(rules: 3, block: true), ["en-US"], """
        Mock rules applying: 3
        POST /items/0
        GET /items/1 ?a=b&page=2
        GET /items/2
        Blocked: requests without a rule
        """),
        (BadgeControlTests.effects(rules: 3, block: true), ["ko-KR"], """
        목업 규칙 3개가 적용 중입니다
        POST /items/0
        GET /items/1 ?a=b&page=2
        GET /items/2
        차단: 규칙 없는 요청
        """),
        (BadgeControlTests.effects(rules: 5), ["en-US"], """
        Mock rules applying: 5
        POST /items/0
        GET /items/1 ?a=b&page=2
        GET /items/2
        and 2 more
        """),
        (BadgeControlTests.effects(rules: 5), ["ko-KR"], """
        목업 규칙 5개가 적용 중입니다
        POST /items/0
        GET /items/1 ?a=b&page=2
        GET /items/2
        외 2개
        """),
    ])
    func message(effects: Effects, languages: [String], expected: String) {
        #expect(BadgeSheet.message(effects, preferredLanguages: languages) == expected)
    }

    @Test("the sheet offers only turning off and cancel, in the device's language")
    func sheetText() throws {
        let engine = Self.engine(
            Configuration(
                allowedHosts: ["a.invalid", "prod.invalid"],
                unmatched: .block(status: 421),
                rules: [Self.rule("x"), Self.rule("y", host: "prod.invalid")]
            ),
            blocked: ["prod.invalid"]
        )
        let en = try #require(BadgeSheet.make(engine.state, preferredLanguages: ["en-US"]))
        #expect(en.title == "Map Local")
        #expect(en.message == "Mock rules applying: 1\nGET /x\nBlocked: requests without a rule")
        #expect(en.turnOff == "Turn off Map Local")
        #expect(en.cancel == "Cancel")

        let ko = try #require(BadgeSheet.make(engine.state, preferredLanguages: ["ko-KR"]))
        #expect(ko.title == "Map Local")
        #expect(ko.message == "목업 규칙 1개가 적용 중입니다\nGET /x\n차단: 규칙 없는 요청")
        #expect(ko.turnOff == "Map Local 끄기")
        #expect(ko.cancel == "취소")
    }

    @Test("with a mocked session at risk, the sheet leads with the panel's sign-out guidance")
    func sheetGuidance() throws {
        let engine = Self.engine(
            Configuration(allowedHosts: ["a.invalid"], rules: [Self.rule("login", auth: true)]),
            authMocked: true
        )
        let en = try #require(BadgeSheet.make(engine.state, preferredLanguages: ["en-US"]))
        #expect(en.message == """
        Log out in the app before you turn off Map Local. If a mocked token reaches the real server, a 401 can force a logout.

        Mock rules applying: 1
        GET /login
        The app may hold a mocked session.
        """)
        let ko = try #require(BadgeSheet.make(engine.state, preferredLanguages: ["ko-KR"]))
        #expect(ko.message == """
        Map Local을 끄기 전에 앱에서 로그아웃하세요. 목업 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다.

        목업 규칙 1개가 적용 중입니다
        GET /login
        앱에 목업 세션이 남아 있을 수 있습니다.
        """)
    }

    @Test("a mocked session with no rule left says only that, without the guidance")
    func sheetSessionOnly() throws {
        let engine = Self.engine(Configuration(allowedHosts: []), authMocked: true)
        let sheet = try #require(BadgeSheet.make(engine.state, preferredLanguages: ["en-US"]))
        #expect(sheet.message == "The app may hold a mocked session.")
    }

    @Test("there is no sheet when nothing applies")
    func noSheet() {
        let engine = Self.engine(Configuration(allowedHosts: ["a.invalid"]))
        #expect(BadgeSheet.make(engine.state, preferredLanguages: ["en-US"]) == nil)
    }

    @Test("turning off writes enabled = false through the engine, raises the revision once and hides the badge")
    func turnOff() throws {
        let engine = Self.engine(Configuration(revision: 7, allowedHosts: ["a.invalid"], rules: [Self.rule()]))
        let sheet = try #require(BadgeSheet.make(engine.state))
        #expect(sheet.baseRevision == 7)
        #expect(BadgeControl.turnOff(engine, baseRevision: sheet.baseRevision) == .turnedOff)
        #expect(!engine.state.configuration.enabled)
        #expect(engine.state.configuration.revision == 8)
        #expect(engine.state.configuration.rules == [Self.rule()])
        #expect(engine.state.effects == nil)
        #expect(BadgeText.make(engine.state) == nil)
    }

    @Test("the panel sees the change through its normal state stream")
    func echo() async throws {
        let engine = Self.engine(Configuration(allowedHosts: ["a.invalid"], rules: [Self.rule()]))
        var states = engine.stateEvents().makeAsyncIterator()
        #expect(await states.next()?.configuration.enabled == true)
        #expect(BadgeControl.turnOff(engine, baseRevision: 0) == .turnedOff)
        let echoed = try #require(await states.next())
        #expect(!echoed.configuration.enabled)
        #expect(echoed.configuration.revision == 1)
    }

    @Test("a change made after the sheet opened is a conflict, and nothing is written")
    func conflict() throws {
        let engine = Self.engine(Configuration(allowedHosts: ["a.invalid"], rules: [Self.rule()]))
        let sheet = try #require(BadgeSheet.make(engine.state))
        try engine.apply(.patch(enabled: nil, allowedHosts: ["a.invalid", "b.invalid"], unmatched: nil, order: nil),
                         baseRevision: 0)
        #expect(BadgeControl.turnOff(engine, baseRevision: sheet.baseRevision) == .conflict)
        #expect(engine.state.configuration.enabled)
        #expect(engine.state.configuration.revision == 1)
        #expect(BadgeText.make(engine.state) != nil)
    }

    @Test("a mocked session recorded while the sheet was open asks again with the sign-out guidance, without writing")
    func sessionAtRiskWhileOpen() throws {
        let engine = Self.engine(Configuration(allowedHosts: ["a.invalid"], rules: [Self.rule("login", auth: true)]))
        let shown = try #require(BadgeSheet.make(engine.state, preferredLanguages: ["en-US"]))
        #expect(!shown.sessionAtRisk)

        // The app signs in through the mocked auth rule while the sheet is open. Recording it
        // does not raise the revision, so the revision check alone would let the write through.
        var request = URLRequest(url: try #require(URL(string: "https://a.invalid/login")))
        request.httpMethod = "GET"
        engine.recordMocked(request, decision: try #require(engine.decide(request)))
        #expect(engine.state.configuration.revision == shown.baseRevision)

        let now = try #require(BadgeSheet.make(engine.state, preferredLanguages: ["en-US"]))
        #expect(now.sessionAtRisk)
        #expect(now.message.hasPrefix("Log out in the app before you turn off Map Local."))
        #expect(BadgeControl.confirm(shown, now: BadgeSheet.make(engine.state)) == .askAgain)
        #expect(engine.state.configuration.enabled)

        // The sheet shown again already says it, so turning off goes ahead.
        #expect(BadgeControl.confirm(now, now: BadgeSheet.make(engine.state)) == .turnOff(baseRevision: now.baseRevision))
    }

    @Test("turning off goes ahead when the risk is unchanged or went away, or nothing applies any more", arguments: [
        (false, false), (true, true), (true, false),
    ])
    func confirmProceeds(shownAtRisk: Bool, nowAtRisk: Bool) throws {
        let configuration = Configuration(revision: 4, allowedHosts: ["a.invalid"], rules: [Self.rule("login", auth: true)])
        let shown = try #require(BadgeSheet.make(Self.engine(configuration, authMocked: shownAtRisk).state))
        let now = try #require(BadgeSheet.make(Self.engine(configuration, authMocked: nowAtRisk).state))
        #expect(shown.sessionAtRisk == shownAtRisk)
        #expect(now.sessionAtRisk == nowAtRisk)
        #expect(BadgeControl.confirm(shown, now: now) == .turnOff(baseRevision: 4))
        #expect(BadgeControl.confirm(shown, now: nil) == .turnOff(baseRevision: 4))
    }

    @Test("a read-only configuration is not turned off, and the sheet has words for that")
    func readOnly() throws {
        let engine = Self.engine(Configuration(allowedHosts: ["a.invalid"], rules: [Self.rule()]), readOnly: true)
        #expect(BadgeControl.turnOff(engine, baseRevision: 0) == .failed)
        #expect(engine.state.configuration.enabled)
        #expect(try #require(BadgeSheet.make(engine.state, preferredLanguages: ["en-US"])).failure
            == "Couldn't turn off Map Local: its configuration can't be saved.")
        #expect(try #require(BadgeSheet.make(engine.state, preferredLanguages: ["ko-KR"])).failure
            == "Map Local을 끄지 못했습니다. 설정을 저장할 수 없습니다.")
    }

    @Test("turning off keeps the mocked session mark, so the panel still asks to sign out")
    func keepsSessionMark() {
        let engine = Self.engine(
            Configuration(allowedHosts: ["a.invalid"], rules: [Self.rule("login", auth: true)]),
            authMocked: true
        )
        #expect(BadgeControl.turnOff(engine, baseRevision: 0) == .turnedOff)
        #expect(engine.state.mayHoldMockedSession)
        #expect(BadgeText.make(engine.state) == nil)
    }
}
#endif
