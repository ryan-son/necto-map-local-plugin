//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
@testable import MapLocalCore
import NectoModel
import Testing
@testable import NectoMapLocalPlugin

/// Replaces the global engine, so it runs under `RuntimeSuites`, serially with the other
/// runtime suites.
extension RuntimeSuites {
@Suite("Plugin operations")
struct PluginOperationTests {
    func makeEngine() -> MapLocalEngine {
        let rule = Rule(
            id: "r",
            match: Match(method: "GET", path: "/a"),
            active: "ok",
            responses: ["ok": ResponseSpec(status: 200), "down": ResponseSpec(error: .connectionLost)]
        )
        return MapLocalEngine(
            store: MemoryConfigurationStore(Configuration(allowedHosts: ["maplocal.invalid"], rules: [.rule(rule)])),
            blockedHosts: []
        )
    }

    static func send(
        _ operation: MapLocalOperation,
        _ input: String,
        to engine: MapLocalEngine
    ) async throws -> [String: NectoJSONValue] {
        let json = try JSONDecoder().decode(NectoJSONValue.self, from: Data(input.utf8))
        let output = try await NectoMapLocalPlugin.perform(operation, input: json, engine: engine)
        guard case let .object(object) = output else {
            Issue.record("the output is not an object: \(output)")
            return [:]
        }
        return object
    }

    /// The error a malformed or impossible call throws, so that Necto fails the call and the
    /// CLI exits nonzero instead of printing `ok:false` as a success.
    static func rejection(
        _ operation: MapLocalOperation,
        _ input: String,
        to engine: MapLocalEngine
    ) async throws -> NectoBridgeError {
        do {
            let output = try await send(operation, input, to: engine)
            Issue.record("answered instead of throwing: \(output)")
        } catch let error as NectoBridgeError {
            return error
        }
        return NectoBridgeError(code: .cancelled, message: "")
    }

    @Test("requests.list returns recent records newest first, with the last seq")
    func listsRecords() async throws {
        let engine = makeEngine()
        engine.recordPassthrough(URLRequest(url: URL(string: "https://maplocal.invalid/a")!))
        engine.recordPassthrough(URLRequest(url: URL(string: "https://maplocal.invalid/b")!))
        let output = try await Self.send(.requestsList, #"{"limit":1}"#, to: engine)
        #expect(output["lastSeq"] == .number(2))
        guard case let .array(events)? = output["events"] else {
            Issue.record("events is not an array")
            return
        }
        #expect(events.count == 1)
        guard case let .object(first)? = events.first else {
            Issue.record("the event is not an object")
            return
        }
        #expect(first["path"] == .string("/b"))
    }

    @Test("requests.list refuses an unknown input key")
    func listRefusesUnknownKey() async throws {
        let error = try await Self.rejection(.requestsList, #"{"limt":1}"#, to: makeEngine())
        #expect(error.code == .invalidInput)
        #expect(error.message == "Unsupported key in input: limt")
    }

    @Test("requests.list refuses a limit outside 1 to 500, as its schema does", arguments: ["0", "501", "1.5", #""5""#])
    func listRefusesLimit(limit: String) async throws {
        let error = try await Self.rejection(.requestsList, #"{"limit":\#(limit)}"#, to: makeEngine())
        #expect(error.code == .invalidInput)
        #expect(error.message == "limit must be an integer from 1 to 500")
    }

    @Test("requests.list uses the default limit for empty input")
    func listUsesDefaultLimit() async throws {
        let engine = makeEngine()
        engine.recordPassthrough(URLRequest(url: URL(string: "https://maplocal.invalid/a")!))
        let output = try await Self.send(.requestsList, "{}", to: engine)
        guard case let .array(events)? = output["events"] else {
            Issue.record("events is not an array")
            return
        }
        #expect(events.count == 1)
    }

    static let secretJWT = "eyJhbGciOiJub25lIn0.eyJhdXRob3JpdHkiOiJ4In0.x"

    /// The state is the original for editing, so writing it back must not change a token.
    @Test("state does not mask mocked tokens, and writing it back leaves them unchanged")
    func stateIsTheOriginal() async throws {
        let engine = makeEngine()
        let rule = #"""
        {"id":"login","tags":["auth"],"match":{"method":"POST","path":"/login"},"active":"ok",\#
        "responses":{"ok":{"status":200,"headers":{"Set-Cookie":"sid=S"},\#
        "json":{"accessToken":"\#(Self.secretJWT)"}}}}
        """#
        _ = try await Self.send(.ruleUpsert, #"{"baseRevision":0,"rule":\#(rule)}"#, to: engine)
        let state = try await Self.send(.state, "{}", to: engine)
        let text = String(decoding: try JSONEncoder().encode(state), as: UTF8.self)
        #expect(text.contains(Self.secretJWT))
        #expect(text.contains("sid=S"))

        let configuration = try #require(state["configuration"])
        let document = String(decoding: try JSONEncoder().encode(configuration), as: UTF8.self)
        let output = try await Self.send(
            .configurationReplace,
            #"{"baseRevision":1,"configuration":\#(document)}"#,
            to: engine
        )
        #expect(output["ok"] == .bool(true))
        guard case let .rule(login)? = engine.state.configuration.rules.first(where: { $0.id == "login" }) else {
            Issue.record("no rule")
            return
        }
        #expect(login.responses["ok"]?.body == .json(.object(["accessToken": .string(Self.secretJWT)])))
    }

    /// Necto and the engine carry JSON objects in dictionaries, so only a string keeps key
    /// order. The panel sends a JSON body as text for this reason.
    @Test("a JSON body sent as text keeps its exact text through upsert, the state echo, export and the served response")
    func textBodyKeepsKeyOrder() async throws {
        let engine = makeEngine()
        let body = "{\n  \"zone\": 1,\n  \"alpha\": {\"y\": 2, \"b\": 3},\n  \"middle\": [3, 1]\n}"
        let encoded = String(decoding: try JSONEncoder().encode(body), as: UTF8.self)
        let rule = #"""
        {"id":"o","match":{"method":"GET","path":"/o"},"active":"ok",\#
        "responses":{"ok":{"status":200,"headers":{"Content-Type":"application/json"},"body":\#(encoded)}}}
        """#
        _ = try await Self.send(.ruleUpsert, #"{"baseRevision":0,"rule":\#(rule)}"#, to: engine)

        for operation in [MapLocalOperation.state, .configurationExport] {
            let output = try await Self.send(operation, "{}", to: engine)
            guard case let .array(rules)? = output["configuration"]?["rules"] else {
                Issue.record("no rules in \(operation)")
                continue
            }
            let echoed = rules.first { $0["id"] == .string("o") }?["responses"]?["ok"]?["body"]
            #expect(echoed == .string(body), "\(operation)")
        }
        guard case let .rule(saved)? = engine.state.configuration.rules.first(where: { $0.id == "o" }),
              let spec = saved.responses["ok"]
        else {
            Issue.record("no rule")
            return
        }
        let served = Matcher.resolve(spec, tag: "o/ok")
        #expect(String(decoding: served.body, as: UTF8.self) == body)
        #expect(served.headers["Content-Type"] == "application/json")
        #expect(try ConfigurationCodec.decode(ConfigurationCodec.encode(engine.state.configuration)) == engine.state.configuration)
    }

    @Test("state sends each issue as English text, and with its code for the panel to translate")
    func stateSendsIssueCodes() async throws {
        let engine = makeEngine()
        let rule = #"{"id":"a","match":{"method":"GET","path":"/x"},"active":"o","responses":{"o":{"status":200}}}"#
        _ = try await Self.send(
            .configurationReplace,
            #"{"baseRevision":0,"configuration":{"version":1,"rules":[\#(rule),\#(rule)]}}"#,
            to: engine
        )
        let state = try await Self.send(.state, "{}", to: engine)
        #expect(state["issues"] == .array([.string("Rule a: Duplicate id: a")]))
        #expect(state["issueDetails"] == .array([.object([
            "code": .string("ruleUnsupported"),
            "params": .object(["rule": .string("a")]),
            "message": .string("Rule a: Duplicate id: a"),
            "cause": .object([
                "code": .string("duplicateID"),
                "params": .object(["id": .string("a")]),
                "message": .string("Duplicate id: a"),
            ]),
        ])]))
    }

    @Test("state shows the blocked hosts the app passed, normalized")
    func stateShowsBlockedHosts() async throws {
        let engine = MapLocalEngine(store: MemoryConfigurationStore(), blockedHosts: ["HTTPS://Prod.invalid:443/"])
        let state = try await Self.send(.state, "{}", to: engine)
        #expect(state["blockedHosts"] == .array([.string("prod.invalid")]))
    }

    /// That is how the panel notices the app was relaunched.
    @Test("state carries a different launchID for every engine created")
    func stateCarriesLaunchID() async throws {
        let firstEngine = MapLocalEngine(store: MemoryConfigurationStore(), blockedHosts: [])
        let secondEngine = MapLocalEngine(store: MemoryConfigurationStore(), blockedHosts: [])
        let first = try await Self.send(.state, "{}", to: firstEngine)
        let second = try await Self.send(.state, "{}", to: secondEngine)
        guard case let .string(firstID)? = first["launchID"], case let .string(secondID)? = second["launchID"] else {
            Issue.record("no launchID")
            return
        }
        #expect(!firstID.isEmpty)
        #expect(firstID != secondID)
        #expect(firstEngine.state.launchID == firstID)
    }

    @Test("throws invalidInput for a typo or a wrong type, with English text and the code in details, and changes nothing", arguments: [
        (MapLocalOperation.configurationPatch, #"{"baseRevision":0,"enable":false}"#, "Unsupported key in input: enable"),
        (.configurationPatch, #"{"baseRevision":0,"enabled":"false"}"#, "enabled must be true or false"),
        (.configurationPatch, #"{"baseRevision":0,"allowedHosts":["ok.invalid",5]}"#, "allowedHosts must be an array of strings"),
        (.configurationPatch, #"{"baseRevision":0,"unmatched":{"mode":"block","stauts":500}}"#, "Unsupported key in unmatched: stauts"),
        (.configurationPatch, #"{"baseRevision":0,"order":"r"}"#, "order must be an array of strings"),
        (.configurationPatch, #"{"baseRevision":0,"authMocked":true}"#, "authMocked can only be false, which clears the mocked session"),
        (
            .ruleUpsert,
            #"{"baseRevision":0,"rule":{"id":"t","tags":"auth","match":{"method":"GET","path":"/t"},"active":"a","responses":{"a":{"status":200}}}}"#,
            "tags must be an array of strings"
        ),
        (
            .ruleUpsert,
            #"{"baseRevision":0,"rule":{"id":"t","enabled":"false","match":{"method":"GET","path":"/t"},"active":"a","responses":{"a":{"status":200}}}}"#,
            "enabled must be true or false"
        ),
        (
            .ruleUpsert,
            #"{"baseRevision":0,"rule":{"id":"t","match":{"method":"GET","path":"/t?x=1"},"active":"a","responses":{"a":{"status":200}}}}"#,
            "match.path can't contain a query or a fragment; use match.query"
        ),
        (
            .ruleUpsert,
            #"{"baseRevision":0,"rule":{"id":"t","match":{"method":"GET","host":1,"path":"/t"},"active":"a","responses":{"a":{"status":200}}}}"#,
            "match.host must be a string"
        ),
        (
            .configurationReplace,
            #"{"baseRevision":0,"configuration":{"version":99,"rules":[]}}"#,
            "Configuration version 99 is newer than this plugin supports (1)"
        ),
        (.configurationReplace, #"{"configuration":{"version":1,"rules":[]}}"#, "baseRevision is required"),
        (.configurationPatch, #"{"enabled":false}"#, "baseRevision is required"),
    ])
    func validatesInput(operation: MapLocalOperation, input: String, message: String) async throws {
        let engine = makeEngine()
        let error = try await Self.rejection(operation, input, to: engine)
        #expect(error.code == .invalidInput)
        #expect(error.message == message)
        #expect(error.details?["reason"] == .string("invalid"))
        #expect(error.details?["code"]?.stringValue != nil)
        #expect(error.details?["message"] == .string(message))
        #expect(error.details?["revision"] == .number(0))
        #expect(engine.state.configuration.revision == 0)
    }

    @Test("importing a shared file replaces with force, without knowing the device's revision")
    func forcedReplace() async throws {
        let engine = makeEngine()
        _ = try await Self.send(.configurationPatch, #"{"baseRevision":0,"enabled":false}"#, to: engine)
        let output = try await Self.send(
            .configurationReplace,
            #"{"force":true,"configuration":{"version":1,"allowedHosts":["maplocal.invalid"],"rules":[]}}"#,
            to: engine
        )
        #expect(output == ["ok": NectoJSONValue.bool(true), "revision": .number(2)])
        #expect(engine.state.configuration.rules.isEmpty)
    }

    @Test("answers read-only as data, throws for a missing rule and a failed save, and changes nothing")
    func failureReasons() async throws {
        let readOnly = MapLocalEngine(store: MemoryConfigurationStore(readOnly: true), blockedHosts: [])
        let readOnlyOutput = try await Self.send(
            MapLocalOperation.configurationPatch,
            #"{"baseRevision":0,"enabled":false}"#,
            to: readOnly
        )
        #expect(readOnlyOutput["ok"] == .bool(false))
        #expect(readOnlyOutput["reason"] == .string("readOnly"))
        #expect(readOnlyOutput["code"] == .string("readOnly"))

        let notFound = try await Self.rejection(.ruleDelete, #"{"baseRevision":0,"id":"nope"}"#, to: makeEngine())
        #expect(notFound.code == .operationUnavailable)
        #expect(notFound.message == "No rule 'nope'")
        #expect(notFound.details?["reason"] == .string("notFound"))
        #expect(notFound.details?["code"] == .string("ruleNotFound"))
        #expect(notFound.details?["params"] == .object(["rule": .string("nope")]))

        let store = MemoryConfigurationStore(Configuration(allowedHosts: ["maplocal.invalid"]))
        let full = MapLocalEngine(store: store, blockedHosts: [])
        store.failSaving()
        let storage = try await Self.rejection(.configurationPatch, #"{"baseRevision":0,"enabled":false}"#, to: full)
        #expect(storage.code == .providerFailed)
        #expect(storage.details?["reason"] == .string("storage"))
        #expect(storage.details?["code"] == .string("saveFailed"))
        #expect(full.state.configuration.enabled == true)
        #expect(full.state.configuration.revision == 0)
    }

    @Test("throws operationUnavailable when no engine is running")
    func engineMissing() async throws {
        do {
            _ = try await NectoMapLocalPlugin.perform(.state, input: .object([:]), engine: nil)
            Issue.record("answered without an engine")
        } catch let error as NectoBridgeError {
            #expect(error.code == .operationUnavailable)
            #expect(error.details?["code"] == .string("engineMissing"))
        }
    }

    @Test("clears the mocked session only with authMocked:false, and the clearing is saved")
    func clearsMockedSession() async throws {
        let store = MemoryConfigurationStore(authMocked: true)
        let engine = MapLocalEngine(store: store, blockedHosts: [])
        #expect(engine.state.mayHoldMockedSession)
        let output = try await Self.send(.configurationPatch, #"{"baseRevision":0,"authMocked":false}"#, to: engine)
        #expect(output["ok"] == .bool(true))
        #expect(engine.state.mayHoldMockedSession == false)
        #expect(store.loadAuthMocked() == false)
    }

    @Test("stream operations each send their own events, and one-shot operations have no stream")
    func selectsStreams() async throws {
        let engine = makeEngine()
        var states = try #require(NectoMapLocalPlugin.stream(.stateObserve, engine: engine)).makeAsyncIterator()
        guard case let .object(first)? = await states.next() else {
            Issue.record("not a state")
            return
        }
        #expect(first["revision"] == .number(0))

        var requests = try #require(NectoMapLocalPlugin.stream(.requestsObserve, engine: engine)).makeAsyncIterator()
        // Wait one round on the state stream until the subscribing Task is attached to the
        // engine's stream.
        _ = try await Self.send(.configurationPatch, #"{"baseRevision":0,"enabled":true}"#, to: engine)
        _ = await states.next()
        engine.recordPassthrough(URLRequest(url: URL(string: "https://other.invalid/p")!))
        guard case let .object(event)? = await requests.next() else {
            Issue.record("not a record")
            return
        }
        #expect(event["path"] == .string("/p"))

        for operation in MapLocalOperation.allCases where operation.kind == .once {
            #expect(NectoMapLocalPlugin.stream(operation, engine: engine) == nil)
        }
    }

    @Test("setActive raises the revision, and a stale baseRevision is refused as a conflict")
    func switchesAndConflicts() async throws {
        let engine = makeEngine()
        let ok = try await NectoMapLocalPlugin.perform(
            .ruleSetActive,
            input: .object(["baseRevision": .number(0), "id": .string("r"), "response": .string("down")]),
            engine: engine
        )
        #expect(ok == .object(["ok": .bool(true), "revision": .number(1)]))
        let stale = try await NectoMapLocalPlugin.perform(
            .ruleSetActive,
            input: .object(["baseRevision": .number(0), "id": .string("r"), "response": .string("ok")]),
            engine: engine
        )
        guard case let .object(object) = stale else {
            Issue.record("not an object")
            return
        }
        #expect(object["ok"] == .bool(false))
        #expect(object["reason"] == .string("conflict"))
        #expect(object["code"] == .string("conflict"))
        #expect(object["revision"] == .number(1))
    }

    @Test("replace validates a JSON configuration and swaps it in whole")
    func replaces() async throws {
        let engine = makeEngine()
        let document: NectoJSONValue = .object([
            "version": .number(1),
            "revision": .number(0),
            "enabled": .bool(true),
            "allowedHosts": .array([.string("maplocal.invalid")]),
            "unmatched": .object(["mode": .string("block"), "status": .number(421)]),
            "rules": .array([]),
        ])
        let output = try await NectoMapLocalPlugin.perform(
            .configurationReplace,
            input: .object(["baseRevision": .number(0), "configuration": document]),
            engine: engine
        )
        #expect(output == .object(["ok": .bool(true), "revision": .number(1)]))
        #expect(engine.state.configuration.unmatched == .block(status: 421))
    }

    @Test("refuses a write without baseRevision as invalid")
    func refusesMissingBaseRevision() async throws {
        let error = try await Self.rejection(.configurationPatch, #"{"enabled":false}"#, to: makeEngine())
        #expect(error.code == .invalidInput)
        #expect(error.message == "baseRevision is required")
    }

    @Test("creating the plugin many times still makes one engine")
    func oneEngine() {
        MapLocalRuntime.replace(nil)
        _ = NectoMapLocalPlugin(store: MemoryConfigurationStore())
        let first = MapLocalRuntime.engine
        _ = NectoMapLocalPlugin(store: MemoryConfigurationStore())
        #expect(first != nil)
        #expect(MapLocalRuntime.engine === first)
    }

    @Test("passes the blocked hosts the app gave through to the engine, normalized")
    func passesBlockedHosts() {
        MapLocalRuntime.replace(nil)
        _ = NectoMapLocalPlugin(blockedHosts: ["HTTPS://V2.Prod.invalid:443"], store: MemoryConfigurationStore())
        #expect(MapLocalRuntime.engine?.blockedHosts == ["v2.prod.invalid"])
    }

    @Test("export carries values as they are, tokens and passwords included")
    func exportIsTheOriginal() async throws {
        let engine = makeEngine()
        let signed = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln"
        let unsigned = "eyJhbGciOiJub25lIn0.eyJhIjoxfQ.x"
        let rule = #"""
        {"id":"login","tags":["auth"],"match":{"method":"POST","path":"/login"},"active":"ok",\#
        "responses":{"ok":{"status":200,"headers":{"Authorization":"Bearer \#(signed)"},\#
        "json":{"accessToken":"\#(unsigned)","password":"p"}}}}
        """#
        _ = try await Self.send(.ruleUpsert, #"{"baseRevision":0,"rule":\#(rule)}"#, to: engine)
        let output = try await Self.send(.configurationExport, "{}", to: engine)
        let text = String(decoding: try JSONEncoder().encode(output), as: UTF8.self)
        #expect(text.contains(signed))
        #expect(text.contains("\"p\""))
        #expect(text.contains(unsigned))
    }

    static func exported(_ engine: MapLocalEngine) async throws -> (text: String, configuration: Configuration) {
        let output = try await Self.send(.configurationExport, "{}", to: engine)
        let text = String(decoding: try JSONEncoder().encode(output), as: UTF8.self)
        let document = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
        return (text, try ConfigurationCodec.decode(try #require(document["configuration"])))
    }

    /// Imported again, the rule still catches the same requests.
    @Test("export does not mask a rule's match conditions or response names")
    func exportKeepsRuleShape() async throws {
        let engine = makeEngine()
        let rule = #"""
        {"id":"q","match":{"method":"GET","path":"/q","query":{"token":"abc"}},"active":"token",\#
        "responses":{"token":{"status":200,"json":{"ok":true}},"secret":{"status":500}}}
        """#
        _ = try await Self.send(.ruleUpsert, #"{"baseRevision":0,"rule":\#(rule)}"#, to: engine)
        let imported = try await Self.exported(engine).configuration
        let entry = imported.rules.first { entry in
            if case let .rule(rule) = entry { rule.id == "q" } else { false }
        }
        guard case let .rule(importedRule)? = entry else {
            Issue.record("the imported rule does not work: \(imported.rules)")
            return
        }
        #expect(importedRule.match.query == ["token": "abc"])
        #expect(importedRule.active == "token")
        #expect(Set(importedRule.responses.keys) == ["token", "secret"])
    }

    @Test("export carries response headers and text bodies as they are, and imports back to the same response")
    func exportKeepsResponses() async throws {
        let engine = makeEngine()
        let signed = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln"
        let rule = #"""
        {"id":"t","match":{"method":"GET","path":"/t"},"active":"ok","responses":{"ok":{"status":200,\#
        "headers":{"X-Auth-Token":"opaque-header","Authorization":"Bearer \#(signed)","Accept":"*/*"},\#
        "body":"password=hunter2&page=1"}}}
        """#
        _ = try await Self.send(.ruleUpsert, #"{"baseRevision":0,"rule":\#(rule)}"#, to: engine)
        let imported = try await Self.exported(engine).configuration
        let entry = imported.rules.first { entry in
            if case let .rule(rule) = entry { rule.id == "t" } else { false }
        }
        guard case let .rule(importedRule)? = entry else {
            Issue.record("the imported rule does not work")
            return
        }
        #expect(
            importedRule.responses["ok"]?.headers
                == ["X-Auth-Token": "opaque-header", "Authorization": "Bearer \(signed)", "Accept": "*/*"]
        )
        #expect(importedRule.responses["ok"]?.body == .text("password=hunter2&page=1"))
    }

    @Test("request record dates are milliseconds since 1970")
    func recordDatesAreMilliseconds() async throws {
        let engine = makeEngine()
        var events = try #require(NectoMapLocalPlugin.stream(.requestsObserve, engine: engine)).makeAsyncIterator()
        var states = try #require(NectoMapLocalPlugin.stream(.stateObserve, engine: engine)).makeAsyncIterator()
        _ = await states.next()
        _ = try await Self.send(.configurationPatch, #"{"baseRevision":0,"enabled":true}"#, to: engine)
        _ = await states.next()
        let before = Date().timeIntervalSince1970 * 1000
        engine.recordPassthrough(URLRequest(url: URL(string: "https://other.invalid/p")!))
        guard case let .object(event)? = await events.next(), case let .number(milliseconds)? = event["date"] else {
            Issue.record("no date")
            return
        }
        #expect(milliseconds >= before - 1000 && milliseconds <= before + 60_000)
    }
}
}
#endif
