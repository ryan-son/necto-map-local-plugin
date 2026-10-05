//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

@Suite("FileConfigurationStore")
struct StoreTests {
    /// A fresh directory whose path has a space in it, like the real Application Support.
    func makeDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appending(path: "maplocal-store-\(UUID().uuidString)/Application Support/NectoMapLocal")
    }

    @Test("an empty configuration without a file, and a saved one reads back")
    func roundTrips() throws {
        let store = FileConfigurationStore(directory: makeDirectory())
        #expect(store.load().configuration == .empty)
        let configuration = Configuration(revision: 3, allowedHosts: ["maplocal.invalid"])
        try store.save(configuration)
        #expect(store.load().configuration == configuration)
        #expect(store.load().readOnly == false)
    }

    @Test("a new instance reads back a configuration saved in a directory with a space")
    func spacedPathSurvivesRelaunch() throws {
        let directory = makeDirectory()
        let configuration = Configuration(revision: 3, allowedHosts: ["maplocal.invalid"])
        try FileConfigurationStore(directory: directory).save(configuration)
        #expect(FileConfigurationStore(directory: directory).load().configuration == configuration)
    }

    @Test("the mocked session mark survives into a new instance in a directory with a space")
    func spacedPathKeepsMockedSessionMark() {
        let directory = makeDirectory()
        FileConfigurationStore(directory: directory).saveAuthMocked(true)
        #expect(FileConfigurationStore(directory: directory).loadAuthMocked())
    }

    @Test("backs up a corrupt file and starts with an empty configuration")
    func corruptFile() throws {
        let directory = makeDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("{not json".utf8).write(to: directory.appending(path: "configuration.json"))
        let result = FileConfigurationStore(directory: directory).load()
        #expect(result.configuration == .empty)
        #expect(!result.issues.isEmpty)
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path(percentEncoded: false))
        #expect(names.contains { $0.hasPrefix("configuration.corrupt-") })
        #expect(!names.contains("configuration.json"))
    }

    @Test("opens a file from a newer version read-only")
    func newerVersion() throws {
        let directory = makeDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(#"{"version":99,"revision":1,"rules":[]}"#.utf8)
            .write(to: directory.appending(path: "configuration.json"))
        #expect(FileConfigurationStore(directory: directory).load().readOnly)
    }

    @Test("saves an unsupported rule exactly as it was read")
    func savingKeepsUnsupportedRule() throws {
        let raw: JSONValue = .object([
            "id": .string("future"),
            "match": .object(["method": .string("GET"), "path": .string("/a"), "bodyPatterns": .array([])]),
            "active": .string("a"),
            "responses": .object([:]),
        ])
        let store = FileConfigurationStore(directory: makeDirectory())
        try store.save(Configuration(rules: [.unsupported(raw: raw, reason: MapLocalMessage(.required, ["key": "id"]))]))
        let loaded = store.load().configuration
        guard case let .unsupported(kept, _) = loaded.rules.first else {
            Issue.record("not kept")
            return
        }
        #expect(kept == raw)
    }

    @Test("opens a newer file with unknown keys read-only, without backing it up")
    func newerVersionWithUnknownKeys() throws {
        let directory = makeDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(#"{"version":2,"revision":7,"profiles":[],"rules":[]}"#.utf8)
            .write(to: directory.appending(path: "configuration.json"))
        let result = FileConfigurationStore(directory: directory).load()
        #expect(result.readOnly)
        #expect(result.configuration.revision == 7)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: directory.path(percentEncoded: false))
                == ["configuration.json"]
        )
    }

    @Test("opens an existing file it cannot read read-only, so it is never overwritten, and leaves it alone")
    func unreadableFile() throws {
        let directory = makeDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appending(path: "configuration.json")
        try Data(#"{"version":1,"revision":5,"rules":[]}"#.utf8).write(to: file)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o000],
            ofItemAtPath: file.path(percentEncoded: false)
        )
        defer {
            try? FileManager.default.setAttributes(
                [.posixPermissions: 0o644],
                ofItemAtPath: file.path(percentEncoded: false)
            )
        }
        let result = FileConfigurationStore(directory: directory).load()
        #expect(result.readOnly)
        #expect(!result.issues.isEmpty)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: directory.path(percentEncoded: false))
                == ["configuration.json"]
        )
    }

    @Test("saves and clears the mocked session mark")
    func mockedSessionMark() {
        let store = FileConfigurationStore(directory: makeDirectory())
        #expect(store.loadAuthMocked() == false)
        store.saveAuthMocked(true)
        #expect(store.loadAuthMocked())
        store.saveAuthMocked(false)
        #expect(store.loadAuthMocked() == false)
    }
}
#endif
