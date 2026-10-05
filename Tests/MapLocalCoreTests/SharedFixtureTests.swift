//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

/// The panel reads the same files (`Panel/tests/traffic/fixtures.test.ts`), so changing one
/// side alone breaks the other.
enum SharedFixture {
    static func load(_ name: String) throws -> JSONValue {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "Fixtures/\(name)")
        return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    }
}

@Suite("Shared fixtures")
struct SharedFixtureTests {
    @Test("the engine picks the rule the shared table expects")
    func matcher() throws {
        let cases = try #require(SharedFixture.load("matcher-cases.json")["cases"]?.arrayValue)
        for testCase in cases {
            let name = testCase["name"]?.stringValue ?? "?"
            let urlString = try #require(testCase["request"]?["url"]?.stringValue)
            let url = try #require(URL(string: urlString))
            var request = URLRequest(url: url)
            request.httpMethod = testCase["request"]?["method"]?.stringValue
            let host = try #require(url.host())
            let rules = try #require(testCase["rules"])
            let config = try ConfigurationCodec.decode(.object([
                "version": .number(1), "revision": .number(0), "enabled": .bool(true),
                "allowedHosts": .array([.string(host)]), "unmatched": .object(["mode": .string("passthrough")]),
                "rules": rules,
            ]))
            let decision = Matcher.decide(request, configuration: config, blockedHosts: [])
            let picked = decision?.kind == .mock ? decision?.ruleID : nil
            #expect(picked == testCase["expect"]?.stringValue, "\(name)")
        }
    }

    @Test("the engine accepts exactly the rule paths the shared table accepts")
    func paths() throws {
        let cases = try #require(SharedFixture.load("path-cases.json")["cases"]?.arrayValue)
        for testCase in cases {
            let path = try #require(testCase["path"]?.stringValue)
            let valid = try #require(testCase["valid"]?.boolValue)
            let rule = ConfigurationCodec.decodeRule(.object([
                "id": .string("r"),
                "match": .object(["method": .string("GET"), "path": .string(path)]),
                "active": .string("ok"),
                "responses": .object(["ok": .object(["status": .number(200)])]),
            ]))
            switch rule {
            case .rule:
                #expect(valid, "\(testCase["name"]?.stringValue ?? path)")
            case let .unsupported(_, reason):
                #expect(!valid, "\(testCase["name"]?.stringValue ?? path): \(reason.text)")
                #expect(reason == MapLocalMessage(.pathNotEncoded, ["value": path]), "\(path)")
            }
        }
    }

    @Test("the engine normalizes hosts as the shared table expects")
    func hosts() throws {
        let cases = try #require(SharedFixture.load("host-cases.json")["cases"]?.arrayValue)
        for testCase in cases {
            let raw = try #require(testCase["raw"]?.stringValue)
            let got = HostName.normalize(raw)
            // Swift's `==` compares canonical equivalence. Comparing scalars checks for the
            // same code points the panel's `===` compares.
            let scalars = got.map { $0.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: " ") }
            let expected = testCase["expect"]?.stringValue
            #expect(
                got.map { Array($0.unicodeScalars) } == expected.map { Array($0.unicodeScalars) },
                "\(testCase["name"]?.stringValue ?? raw): \(scalars ?? "nil")"
            )
        }
    }

    /// The panel translates by code and keys its dictionary by the same English template,
    /// so the CLI's text and the English panel's text cannot drift apart.
    @Test("every message code has the English template the shared table lists")
    func messageCodes() throws {
        let table = try #require(SharedFixture.load("message-codes.json")["codes"]?.objectValue)
        let expected = table.compactMapValues(\.stringValue)
        let actual = Dictionary(uniqueKeysWithValues: MessageCode.allCases.map { ($0.rawValue, $0.template) })
        #expect(actual == expected)
    }

    @Test("a message fills its template, and nests the message that caused it")
    func messageText() {
        let cause = MapLocalMessage(.duplicateID, ["id": "a"])
        let message = MapLocalMessage(.ruleUnsupported, ["rule": "a"], cause: cause)
        #expect(cause.text == "Duplicate id: a")
        #expect(message.text == "Rule a: Duplicate id: a")
        #expect(message.json == .object([
            "code": .string("ruleUnsupported"),
            "params": .object(["rule": .string("a")]),
            "message": .string("Rule a: Duplicate id: a"),
            "cause": .object([
                "code": .string("duplicateID"),
                "params": .object(["id": .string("a")]),
                "message": .string("Duplicate id: a"),
            ]),
        ]))
    }
}
#endif
