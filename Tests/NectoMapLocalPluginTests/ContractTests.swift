//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
@testable import MapLocalCore
import NectoModel
import Testing
@testable import NectoMapLocalPlugin

/// The manifest's schemas are the wire contract. Necto validates every input and output
/// against them with `NectoJSONSchema`, so these tests use the same validator.
@Suite("Contract")
struct ContractTests {
    static func operations() throws -> [String: NectoJSONValue] {
        let data = try #require(EmbeddedPanel.files["manifest.json"].flatMap { Data(base64Encoded: $0) })
        let manifest = try JSONDecoder().decode(NectoJSONValue.self, from: data)
        let operations = try #require(manifest["operations"]?.arrayValue)
        var byID: [String: NectoJSONValue] = [:]
        for operation in operations {
            byID[try #require(operation["id"]?.stringValue)] = operation
        }
        return byID
    }

    static func schema(_ id: String, _ side: String) throws -> NectoJSONValue {
        try #require(try operations()[id]?[side])
    }

    static func json(_ text: String) throws -> NectoJSONValue {
        try JSONDecoder().decode(NectoJSONValue.self, from: Data(text.utf8))
    }

    @Test("each input schema declares exactly the keys Swift accepts, and requires the keys Swift requires",
          arguments: MapLocalOperation.allCases)
    func inputSchemaMirrorsSwift(operation: MapLocalOperation) throws {
        let input = try Self.schema(operation.rawValue, "inputSchema")
        #expect(input["type"] == .string("object"))
        #expect(input["additionalProperties"] == .bool(false))
        let properties = try #require(input["properties"]?.objectValue)
        #expect(Set(properties.keys) == operation.inputKeys)
        let required = Set((input["required"]?.arrayValue ?? []).compactMap(\.stringValue))
        #expect(required == operation.requiredKeys)
        #expect(operation.requiredKeys.isSubset(of: operation.inputKeys))
    }

    @Test("every write states where baseRevision comes from and which outcomes answer ok:false",
          arguments: MapLocalOperation.allCases.filter { $0.inputKeys.contains("baseRevision") })
    func writeDescriptions(operation: MapLocalOperation) throws {
        let description = try #require(try Self.operations()[operation.rawValue]?["description"]?.stringValue)
        #expect(description.contains("baseRevision"))
        #expect(description.contains("maplocal.state"))
        #expect(description.contains("conflict"))
        #expect(description.contains("readOnly"))
    }

    @Test("operations bound to Necto's network plugin take a strict input, and the panel's inputs fit it")
    func foreignInputs() throws {
        let inputs = [
            ("network.list", #"{"limit":1000}"#),
            ("network.detail", #"{"recordID":"r1"}"#),
            ("network.observe", "{}"),
        ]
        for (id, input) in inputs {
            let schema = try Self.schema(id, "inputSchema")
            #expect(schema["additionalProperties"] == .bool(false), "\(id)")
            #expect(NectoJSONSchema.validate(try Self.json(input), against: schema) == nil, "\(id)")
            #expect(NectoJSONSchema.validate(try Self.json(#"{"x":1}"#), against: schema) != nil, "\(id)")
        }
    }

    /// The inputs `Panel/src/model.ts` sends, with the `baseRevision` the writer adds.
    @Test("every input the panel sends fits the schema", arguments: [
        ("maplocal.configuration.patch", #"{"baseRevision":3,"enabled":false}"#),
        ("maplocal.configuration.patch", #"{"baseRevision":3,"allowedHosts":["api.example.com"]}"#),
        ("maplocal.configuration.patch", #"{"baseRevision":3,"unmatched":{"mode":"block","status":421}}"#),
        ("maplocal.configuration.patch", #"{"baseRevision":3,"unmatched":{"mode":"passthrough"}}"#),
        ("maplocal.configuration.patch", #"{"baseRevision":3,"unmatched":{"mode":"fail","error":"notConnectedToInternet"}}"#),
        ("maplocal.configuration.patch", #"{"baseRevision":3,"authMocked":false}"#),
        ("maplocal.configuration.patch", #"{"baseRevision":3,"order":["b","a"]}"#),
        (
            "maplocal.rule.upsert",
            #"{"baseRevision":3,"rule":{"id":"a","enabled":true,"tags":["auth"],"match":{"method":"GET","host":"api.example.com","path":"/a/{id}","query":{"page":"2"}},"active":"ok","responses":{"ok":{"status":200,"headers":{"X":"1"},"json":{"a":1},"delayMs":100},"down":{"error":"timedOut"}}}}"#
        ),
        ("maplocal.rule.delete", #"{"baseRevision":3,"id":"a"}"#),
        ("maplocal.rule.setActive", #"{"baseRevision":3,"id":"a","response":"ok"}"#),
        (
            "maplocal.configuration.replace",
            #"{"baseRevision":3,"force":true,"configuration":{"version":1,"revision":7,"enabled":true,"allowedHosts":[],"unmatched":{"mode":"passthrough"},"rules":[]}}"#
        ),
        ("maplocal.requests.list", "{}"),
        ("maplocal.state", "{}"),
        ("maplocal.configuration.export", "{}"),
    ])
    func panelInputs(id: String, input: String) throws {
        let failure = NectoJSONSchema.validate(try Self.json(input), against: try Self.schema(id, "inputSchema"))
        #expect(failure == nil)
    }

    /// The codec keeps a rule it cannot read and a file from a newer version; a stricter
    /// schema would refuse the whole import at the Mac before the codec could.
    @Test("replace stays as lenient as the codec about rules and newer versions")
    func lenientReplace() throws {
        let schema = try Self.schema("maplocal.configuration.replace", "inputSchema")
        let inputs = [
            #"{"force":true,"configuration":{"version":1,"rules":[{"id":"x","weird":true},5]}}"#,
            #"{"force":true,"configuration":{"version":2,"future":{"a":1},"rules":[]}}"#,
        ]
        for input in inputs {
            #expect(NectoJSONSchema.validate(try Self.json(input), against: schema) == nil)
        }
    }

    @Test("rule.upsert's rule schema refuses what the codec refuses for shape", arguments: [
        #"{"baseRevision":0,"rule":{"id":"t","match":{"method":"GET","path":"/t"},"active":"a","responses":{},"extra":1}}"#,
        #"{"baseRevision":0,"rule":{"id":"t","match":{"method":"GET","path":"/t","hots":"x"},"active":"a","responses":{}}}"#,
        #"{"baseRevision":0,"rule":{"id":"","match":{"method":"GET","path":"/t"},"active":"a","responses":{}}}"#,
        #"{"baseRevision":0,"rule":{"id":"t","match":{"method":"GET"},"active":"a","responses":{}}}"#,
        #"{"baseRevision":0,"rule":{"id":"t","tags":"auth","match":{"method":"GET","path":"/t"},"active":"a","responses":{}}}"#,
    ])
    func strictRule(input: String) throws {
        let schema = try Self.schema("maplocal.rule.upsert", "inputSchema")
        #expect(NectoJSONSchema.validate(try Self.json(input), against: schema) != nil)
    }

    static let upsert = #"{"baseRevision":0,"rule":{"id":"n","match":{"method":"GET","path":"/n"},"active":"ok","responses":{"ok":RESPONSE}}}"#

    /// Necto checks the schema before Swift runs, and Swift checks again for direct callers
    /// and for what a schema cannot say. Nothing the schema refuses may pass Swift; the rows
    /// where only Swift refuses are the constraints JSON Schema cannot express here.
    @Test("Swift refuses everything the schema refuses, and more only where a schema can't say it", arguments: [
        ("maplocal.requests.list", #"{"limit":0}"#, false, false),
        ("maplocal.requests.list", #"{"limit":500}"#, true, true),
        ("maplocal.requests.list", #"{"limit":501}"#, false, false),
        ("maplocal.state", #"{"x":1}"#, false, false),
        ("maplocal.configuration.export", #"{"x":1}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"enabled":true}"#, true, true),
        ("maplocal.configuration.patch", #"{"enabled":true}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":-1,"enabled":true}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":"0","enabled":true}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0.5,"enabled":true}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"authMocked":true}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"authMocked":false,"enabled":true}"#, true, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"block","status":99}}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"status":421}}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"drop"}}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"passthrough","status":421}}"#, true, true),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"fail"}}"#, true, true),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"fail","error":"timedOut"}}"#, true, true),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"fail","error":"offline"}}"#, false, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"fail","status":421}}"#, true, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"unmatched":{"mode":"block","error":"timedOut"}}"#, true, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"order":["x"]}"#, true, false),
        ("maplocal.configuration.patch", #"{"baseRevision":0,"order":[1]}"#, false, false),
        ("maplocal.configuration.replace", #"{"baseRevision":0,"configuration":{"version":1}}"#, true, true),
        ("maplocal.configuration.replace", #"{"configuration":{"version":1}}"#, true, false),
        ("maplocal.configuration.replace", #"{"force":"yes","configuration":{"version":1}}"#, false, false),
        ("maplocal.configuration.replace", #"{"baseRevision":0}"#, false, false),
        ("maplocal.configuration.replace", #"{"baseRevision":0,"configuration":{"version":0}}"#, false, false),
        ("maplocal.configuration.replace", #"{"baseRevision":0,"configuration":{"version":1,"rules":{}}}"#, false, false),
        ("maplocal.rule.upsert", upsert.replacingOccurrences(of: "RESPONSE", with: #"{"status":200}"#), true, true),
        ("maplocal.rule.upsert", upsert.replacingOccurrences(of: "RESPONSE", with: #"{"status":99}"#), true, false),
        ("maplocal.rule.upsert", upsert.replacingOccurrences(of: "/n", with: "n").replacingOccurrences(of: "RESPONSE", with: #"{"status":200}"#), true, false),
        ("maplocal.rule.upsert", upsert.replacingOccurrences(of: #""active":"ok""#, with: #""active":"no""#).replacingOccurrences(of: "RESPONSE", with: #"{"status":200}"#), true, false),
        ("maplocal.rule.upsert", #"{"baseRevision":0}"#, false, false),
        ("maplocal.rule.delete", #"{"baseRevision":0,"id":"r"}"#, true, true),
        ("maplocal.rule.delete", #"{"baseRevision":0,"id":5}"#, false, false),
        ("maplocal.rule.delete", #"{"baseRevision":0}"#, false, false),
        ("maplocal.rule.setActive", #"{"baseRevision":0,"id":"r","response":"ok"}"#, true, true),
        ("maplocal.rule.setActive", #"{"baseRevision":0,"id":"r"}"#, false, false),
        ("maplocal.rule.setActive", #"{"baseRevision":0,"id":"r","response":1}"#, false, false),
    ])
    func schemaAndSwiftAgree(id: String, input: String, schemaAccepts: Bool, swiftAccepts: Bool) async throws {
        let operation = try #require(MapLocalOperation(rawValue: id))
        let value = try Self.json(input)
        #expect((NectoJSONSchema.validate(value, against: try Self.schema(id, "inputSchema")) == nil) == schemaAccepts)
        let rule = Rule(id: "r", match: Match(method: "GET", path: "/r"), active: "ok", responses: ["ok": ResponseSpec(status: 200)])
        let engine = MapLocalEngine(
            store: MemoryConfigurationStore(Configuration(allowedHosts: ["maplocal.invalid"], rules: [.rule(rule)])),
            blockedHosts: []
        )
        do {
            let output = try await NectoMapLocalPlugin.perform(operation, input: value, engine: engine)
            #expect(swiftAccepts, "Swift accepted: \(output)")
            #expect(output["ok"] != .bool(false))
        } catch let error as NectoBridgeError {
            #expect(!swiftAccepts, "Swift refused: \(error)")
            #expect(error.code == .invalidInput)
        }
    }

    /// The tutorial's "break the contract on purpose" check. Necto runs this validation on
    /// every output and answers INVALID_OUTPUT when it fails, so a real output that failed
    /// here would never reach the panel.
    @Test("real outputs fit the output schemas, and a broken one fails the way Necto reports INVALID_OUTPUT")
    func outputs() async throws {
        let engine = MapLocalEngine(
            store: MemoryConfigurationStore(Configuration(allowedHosts: ["maplocal.invalid"])),
            blockedHosts: ["prod.invalid"]
        )
        engine.recordPassthrough(URLRequest(url: URL(string: "https://maplocal.invalid/a?page=1")!))
        let state = NectoMapLocalPlugin.encode(engine.state)
        let event = NectoMapLocalPlugin.encode(try #require(engine.recentRequests(limit: 1).events.first))
        let outputs: [(String, NectoJSONValue)] = [
            ("maplocal.state", state),
            ("maplocal.state.observe", state),
            ("maplocal.requests.observe", event),
            ("maplocal.requests.list", try await NectoMapLocalPlugin.perform(.requestsList, input: .object([:]), engine: engine)),
            ("maplocal.configuration.export", try await NectoMapLocalPlugin.perform(.configurationExport, input: .object([:]), engine: engine)),
            ("maplocal.rule.upsert", .object(["ok": .bool(true), "revision": .number(2)])),
            ("maplocal.rule.delete", NectoMapLocalPlugin.failure("conflict", MapLocalMessage(.conflict), revision: 2)),
            ("maplocal.configuration.patch", NectoMapLocalPlugin.failure("readOnly", MapLocalMessage(.readOnly), revision: 0)),
        ]
        for (id, output) in outputs {
            let failure = NectoJSONSchema.validate(output, against: try Self.schema(id, "outputSchema"))
            #expect(failure == nil, "\(id): \(String(describing: failure))")
        }

        guard case var .object(broken) = state else {
            Issue.record("state is not an object")
            return
        }
        broken["revision"] = .string("2")
        let failure = NectoJSONSchema.validate(.object(broken), against: try Self.schema("maplocal.state", "outputSchema"))
        #expect(failure?.path == "revision")
        let unknownReason = NectoMapLocalPlugin.failure("storage", MapLocalMessage(.saveFailed, ["error": "x"]), revision: 0)
        #expect(NectoJSONSchema.validate(unknownReason, against: try Self.schema("maplocal.rule.upsert", "outputSchema")) != nil)
    }
}
#endif
