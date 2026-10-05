//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import os

/// A configuration as it was loaded, with whatever went wrong while loading it.
public struct LoadResult: Sendable {
    public var configuration: Configuration
    /// Whether the engine must refuse writes, so that a file it could not fully read is
    /// never overwritten.
    public var readOnly: Bool
    public var issues: [MapLocalMessage]
}

/// Where the engine keeps its configuration between launches.
public protocol ConfigurationStore: Sendable {
    func load() -> LoadResult
    func save(_ configuration: Configuration) throws
    /// Whether a mocked sign-in session may still be in the app.
    ///
    /// It is stored so that the warning survives a relaunch of the app.
    func loadAuthMocked() -> Bool
    func saveAuthMocked(_ value: Bool)
}

/// Stores the configuration as JSON in a directory of the app's container.
public struct FileConfigurationStore: ConfigurationStore {
    let directory: URL
    var file: URL { directory.appending(path: "configuration.json") }
    var authMarker: URL { directory.appending(path: "auth-mocked") }

    public init(directory: URL) { self.directory = directory }

    /// The default location in the app's container.
    public static func standard() -> FileConfigurationStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return FileConfigurationStore(directory: base.appending(path: "NectoMapLocal"))
    }

    /// Loads the file, never losing a configuration that exists but cannot be used.
    ///
    /// A file that cannot be read opens read-only. A file that is not a valid configuration
    /// is moved aside to a timestamped backup before starting empty.
    public func load() -> LoadResult {
        guard FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) else {
            return LoadResult(configuration: .empty, readOnly: false, issues: [])
        }
        let data: Data
        do {
            data = try Data(contentsOf: file)
        } catch {
            // The file exists but cannot be read, for example under data protection before
            // the first unlock. Starting empty would overwrite it on the next save.
            return LoadResult(
                configuration: .empty,
                readOnly: true,
                issues: [MapLocalMessage(.fileUnreadable, ["error": error.localizedDescription])]
            )
        }
        do {
            let json = try JSONDecoder().decode(JSONValue.self, from: data)
            let configuration = try ConfigurationCodec.decode(json)
            let readOnly = configuration.version > Configuration.currentVersion
            var issues = configuration.unsupportedIssues
            if readOnly {
                issues.insert(MapLocalMessage(.fileTooNew, ["version": String(configuration.version)]), at: 0)
            }
            return LoadResult(configuration: configuration, readOnly: readOnly, issues: issues)
        } catch {
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let backup = directory.appending(path: "configuration.corrupt-\(stamp).json")
            try? FileManager.default.moveItem(at: file, to: backup)
            return LoadResult(
                configuration: .empty,
                readOnly: false,
                issues: [MapLocalMessage(.fileMovedAside, ["file": backup.lastPathComponent])]
            )
        }
    }

    public func save(_ configuration: Configuration) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(ConfigurationCodec.encode(configuration))
        try data.write(to: file, options: .atomic)
    }

    public func loadAuthMocked() -> Bool {
        FileManager.default.fileExists(atPath: authMarker.path(percentEncoded: false))
    }

    public func saveAuthMocked(_ value: Bool) {
        if value {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: authMarker.path(percentEncoded: false), contents: Data())
        } else {
            try? FileManager.default.removeItem(at: authMarker)
        }
    }
}

/// Keeps the configuration in memory, for tests.
final class MemoryConfigurationStore: ConfigurationStore {
    private struct State {
        var initial: Configuration
        var readOnly: Bool
        var saved: [Configuration] = []
        var authMocked = false
        var failsSaving = false
    }

    private let state: OSAllocatedUnfairLock<State>

    init(_ initial: Configuration = .empty, readOnly: Bool = false, authMocked: Bool = false) {
        state = OSAllocatedUnfairLock(
            initialState: State(initial: initial, readOnly: readOnly, authMocked: authMocked)
        )
    }

    /// Every configuration saved so far, oldest first.
    var saved: [Configuration] { state.withLock { $0.saved } }

    /// Makes every later save fail, as on a full disk.
    func failSaving() { state.withLock { $0.failsSaving = true } }

    func load() -> LoadResult {
        state.withLock { state in
            LoadResult(configuration: state.saved.last ?? state.initial, readOnly: state.readOnly, issues: [])
        }
    }

    func save(_ configuration: Configuration) throws {
        try state.withLock { state in
            if state.failsSaving { throw CocoaError(.fileWriteOutOfSpace) }
            state.saved.append(configuration)
        }
    }

    func loadAuthMocked() -> Bool { state.withLock { $0.authMocked } }
    func saveAuthMocked(_ value: Bool) { state.withLock { $0.authMocked = value } }
}
#endif
