//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

@Suite("ConfigurationCodec")
struct ConfigurationCodecTests {
    static func json(_ text: String) -> JSONValue {
        try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    static let sample = json(#"""
    {"version":1,"revision":3,"enabled":true,"allowedHosts":["dev.example.com"],
     "unmatched":{"mode":"block","status":421},
     "rules":[{"id":"apt","enabled":true,"tags":["auth"],
       "match":{"method":"get","host":"DEV.example.com","path":"/a/{id}","query":{"page":"1"}},
       "active":"ok",
       "responses":{"ok":{"status":200,"headers":{"X-A":"b"},"json":{"data":[]}},
                    "down":{"error":"notConnectedToInternet","delayMs":10},
                    "text":{"status":500,"body":"boom"}}}]}
    """#)

    @Test("reads a configuration and writes it back unchanged")
    func roundTrips() throws {
        let configuration = try ConfigurationCodec.decode(Self.sample)
        #expect(configuration.revision == 3)
        #expect(configuration.unmatched == .block(status: 421))
        guard case let .rule(rule) = configuration.rules.first else {
            Issue.record("not a rule")
            return
        }
        #expect(rule.match.method == "GET")
        #expect(rule.match.host == "dev.example.com")
        #expect(rule.responses["down"]?.error == .notConnectedToInternet)
        #expect(rule.responses["text"]?.body == .text("boom"))
        #expect(try ConfigurationCodec.decode(ConfigurationCodec.encode(configuration)) == configuration)
    }

    @Test("does not apply a rule with an unsupported key, but keeps it as written", arguments: [
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a","bodyPatterns":[]},"active":"a","responses":{"a":{"status":200}}}"#, "Unsupported key in match: bodyPatterns"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a"},"active":"a","responses":{"a":{"status":200,"transformers":[]}}}"#, "Unsupported key in responses.a: transformers"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a"},"active":"missing","responses":{"a":{"status":200}}}"#, "active must name one of the responses"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"a"},"active":"a","responses":{"a":{"status":200}}}"#, "match.path must start with /"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a"},"active":"a","responses":{"a":{"error":"dns"}}}"#, "responses.a.error must be one of: notConnectedToInternet, connectionLost, timedOut"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a"},"active":"a","responses":{"a":{}}}"#, "responses.a needs a status or an error"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a","query":"page=2"},"active":"a","responses":{"a":{"status":200}}}"#, "match.query must be an object"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a","query":null},"active":"a","responses":{"a":{"status":200}}}"#, "match.query must be an object"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a"},"active":"a","responses":{"a":{"status":200,"headers":null}}}"#, "responses.a.headers must be an object"),
        (#"{"id":"x","enabled":true,"match":{"method":"GET","path":"/a"},"active":"a","responses":{"a":{"status":200,"headers":["x"]}}}"#, "responses.a.headers must be an object"),
    ])
    func keepsUnsupportedRuleAsWritten(ruleText: String, message: String) throws {
        let raw = Self.json(ruleText)
        let document = JSONValue.object([
            "version": .number(1),
            "revision": .number(0),
            "enabled": .bool(true),
            "allowedHosts": .array([]),
            "unmatched": .object(["mode": .string("passthrough")]),
            "rules": .array([raw]),
        ])
        let configuration = try ConfigurationCodec.decode(document)
        guard case let .unsupported(kept, reason) = configuration.rules.first else {
            Issue.record("must not be applied")
            return
        }
        #expect(kept == raw)
        #expect(reason.text == message)
        #expect(ConfigurationCodec.encode(configuration)["rules"]?.arrayValue?.first == raw)
    }

    @Test("does not check keys inside json and headers values")
    func bodyKeysAreFree() throws {
        let configuration = try ConfigurationCodec.decode(Self.sample)
        guard case let .rule(rule) = configuration.rules.first else {
            Issue.record("not a rule")
            return
        }
        #expect(rule.responses["ok"]?.body == .json(.object(["data": .array([])])))
    }

    @Test("fails on a malformed top level")
    func topLevelErrors() {
        #expect(throws: MapLocalMessage.self) { try ConfigurationCodec.decode(.array([])) }
        #expect(throws: MapLocalMessage.self) { try ConfigurationCodec.decode(Self.json(#"{"version":1,"rules":"x"}"#)) }
    }

    static func doc(rules: String = "[]", extra: String = "") -> JSONValue {
        json(#"{"version":1,"rules":\#(rules)\#(extra)}"#)
    }

    @Test("does not apply a second rule with the same id, but keeps it as written")
    func duplicateID() throws {
        let first = #"{"id":"a","match":{"method":"GET","path":"/x"},"active":"o","responses":{"o":{"status":200}}}"#
        let second = #"{"id":"a","match":{"method":"POST","path":"/y"},"active":"o","responses":{"o":{"status":201}}}"#
        let configuration = try ConfigurationCodec.decode(Self.doc(rules: "[\(first),\(second)]"))
        guard case .rule = configuration.rules[0], case let .unsupported(raw, reason) = configuration.rules[1] else {
            Issue.record("the duplicate was applied")
            return
        }
        #expect(reason == MapLocalMessage(.duplicateID, ["id": "a"]))
        #expect(reason.text == "Duplicate id: a")
        #expect(raw["match"]?["method"] == .string("POST"))
    }

    /// Whether it opens read-only is the store's decision.
    @Test("reads a file from a newer version even with unknown top-level keys")
    func newerVersionWithUnknownKeys() throws {
        let configuration = try ConfigurationCodec.decode(
            Self.json(#"{"version":2,"revision":7,"profiles":[],"rules":[]}"#)
        )
        #expect(configuration.version == 2)
        #expect(configuration.revision == 7)
    }

    @Test("fails on a top-level type error in a file of the current version", arguments: [
        #"{"version":1,"enabled":"false"}"#,
        #"{"version":-3}"#,
        #"{"version":1,"allowedHosts":[5]}"#,
        #"{"version":1,"allowedHosts":"a.invalid"}"#,
        #"{"version":1,"unmatched":{"mode":"block","stauts":500}}"#,
        #"{"version":1,"unmatched":{"mode":"block","status":42}}"#,
        #"{"version":1,"unmatched":{"mode":"block","error":"timedOut"}}"#,
        #"{"version":1,"unmatched":{"mode":"fail","error":"offline"}}"#,
        #"{"version":1,"unmatched":{"mode":"fail","status":421}}"#,
        #"{"version":1,"revision":-1}"#,
        #"{"version":1,"profiles":[]}"#,
    ])
    func topLevelTypeErrors(text: String) {
        #expect(throws: MapLocalMessage.self) { try ConfigurationCodec.decode(Self.json(text)) }
    }

    @Test("a type error in a rule field makes only that rule unsupported", arguments: [
        #"{"id":"t","enabled":"false","match":{"method":"GET","path":"/t"},"active":"a","responses":{"a":{"status":200}}}"#,
        #"{"id":"t","tags":"auth","match":{"method":"GET","path":"/t"},"active":"a","responses":{"a":{"status":200}}}"#,
        #"{"id":"t","match":{"method":"GET","host":1,"path":"/t"},"active":"a","responses":{"a":{"status":200}}}"#,
        #"{"id":"t","match":{"method":"GET","path":"/t?x=1"},"active":"a","responses":{"a":{"status":200}}}"#,
        #"{"id":"t","match":{"method":"GET","path":"/t"},"active":"a","responses":{"a":{"status":700}}}"#,
        #"{"id":"t","match":{"method":"GET","path":"/t"},"active":"a","responses":{"a":{"status":200,"delayMs":60001}}}"#,
    ])
    func ruleTypeErrors(rule: String) {
        guard case .unsupported = ConfigurationCodec.decodeRule(Self.json(rule)) else {
            Issue.record("must not be applied")
            return
        }
    }

    @Test("an omitted block status is 421")
    func defaultBlockStatus() throws {
        #expect(try ConfigurationCodec.decodeUnmatched(Self.json(#"{"mode":"block"}"#)) == .block(status: 421))
    }

    @Test("passthrough ignores a status left over from blocking, as it always has")
    func passthroughKeepsStatus() throws {
        #expect(try ConfigurationCodec.decodeUnmatched(Self.json(#"{"mode":"passthrough","status":421}"#)) == .passthrough)
    }

    @Test("an omitted fail error is no internet connection")
    func defaultFailError() throws {
        #expect(try ConfigurationCodec.decodeUnmatched(Self.json(#"{"mode":"fail"}"#)) == .fail(.notConnectedToInternet))
    }

    @Test("failing requests without a rule reads and writes each error", arguments: MockError.allCases)
    func failRoundTrip(error: MockError) throws {
        let unmatched = try ConfigurationCodec.decodeUnmatched(Self.json(#"{"mode":"fail","error":"\#(error.rawValue)"}"#))
        #expect(unmatched == .fail(error))
        let written = ConfigurationCodec.encode(Configuration(unmatched: unmatched))
        #expect(written["unmatched"] == .object(["mode": .string("fail"), "error": .string(error.rawValue)]))
    }

    @Test("keeps tags as read and the rule host in canonical form")
    func tagsAndHost() throws {
        let ruleText = #"""
        {"id":"t","tags":["auth"],"match":{"method":"GET","host":"API.Example.invalid:443","path":"/t"},\#
        "active":"a","responses":{"a":{"status":200}}}
        """#
        guard case let .rule(rule) = ConfigurationCodec.decodeRule(Self.json(ruleText)) else {
            Issue.record("became unsupported")
            return
        }
        #expect(rule.tags == ["auth"])
        #expect(rule.match.host == "api.example.invalid")
    }

    @Test("normalizes hosts", arguments: [
        ("prod.invalid", "prod.invalid"),
        ("PROD.invalid", "prod.invalid"),
        ("https://prod.invalid:443/", "prod.invalid"),
        ("prod.invalid.", "prod.invalid"),
        ("prod.invalid:8443", "prod.invalid"),
        ("", nil),
        ("a b", nil),
        ("https://", nil),
    ] as [(String, String?)])
    func normalizesHosts(raw: String, expected: String?) {
        #expect(HostName.normalize(raw) == expected)
    }
}
#endif
