//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore
@testable import NectoMapLocalPlugin

@Suite("Panel")
struct PanelTests {
    func manifestOperations() throws -> (manifest: [String: Any], operations: [[String: Any]]) {
        let data = try #require(EmbeddedPanel.files["manifest.json"].flatMap { Data(base64Encoded: $0) })
        let manifest = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let operations = try #require(manifest["operations"] as? [[String: Any]])
        return (manifest, operations)
    }

    @Test("the manifest names exactly the operations Swift registers")
    func manifestMatchesOperations() throws {
        let (manifest, operations) = try manifestOperations()
        let ours = operations.compactMap { ($0["binding"] as? [String: Any])?["name"] as? String }
            .filter { $0.hasPrefix("necto.device.maplocal.") }
            .map { String($0.dropFirst("necto.device.".count)) }
        #expect(Set(ours) == Set(MapLocalOperation.allCases.map(\.rawValue)))
        #expect(ours.count == MapLocalOperation.allCases.count)
        #expect(manifest["id"] as? String == NectoMapLocalPlugin.pluginID)
        for operation in operations {
            guard let name = (operation["binding"] as? [String: Any])?["name"] as? String,
                  name.hasPrefix("necto.device.maplocal."),
                  let ours = MapLocalOperation(rawValue: String(name.dropFirst("necto.device.".count)))
            else {
                continue
            }
            #expect(operation["kind"] as? String == ours.kind.rawValue, "\(name)")
        }
    }

    /// Necto keys a plugin's identity, approval and storage by its ID, so it must be
    /// reverse-domain and must never change after the first release.
    @Test("the plugin ID is the published reverse-domain ID, and the author is a display name")
    func identity() throws {
        let (manifest, _) = try manifestOperations()
        #expect(NectoMapLocalPlugin.pluginID == "io.github.ryan-son.maplocal")
        #expect(manifest["author"] as? String == "Geonhee Son")
    }

    /// Changing the plugin ID must not lose a saved configuration: the file lives in a
    /// directory named after the module, not the ID.
    @Test("the saved configuration is not keyed by the plugin ID")
    func storageIgnoresPluginID() {
        let directory = FileConfigurationStore.standard().directory
        #expect(directory.lastPathComponent == "NectoMapLocal")
        #expect(!directory.path().contains(NectoMapLocalPlugin.pluginID))
        #expect(!directory.path().contains("maplocal"))
    }

    /// When they differ, Necto silently drops the operation as unavailable.
    @Test("operations bound to another plugin have the kind that plugin registers")
    func foreignBindingKinds() throws {
        let (_, operations) = try manifestOperations()
        let expected = [
            "necto.device.network-records.list": "once",
            "necto.device.network-records.detail": "once",
            "necto.device.network-records.observe": "stream",
        ]
        let foreign = operations.compactMap { operation -> (String, String)? in
            guard let name = (operation["binding"] as? [String: Any])?["name"] as? String,
                  !name.hasPrefix("necto.device.maplocal.")
            else {
                return nil
            }
            return (name, operation["kind"] as? String ?? "")
        }
        #expect(Dictionary(uniqueKeysWithValues: foreign) == expected)
    }

    @Test("empties the fixed directory before writing, so no stale file is mixed in")
    func writesPanel() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "maplocal-panel-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("stale".utf8).write(to: directory.appending(path: "old-hash.js"))
        let written = try #require(PanelWriter.write(to: directory))
        let names = try FileManager.default.contentsOfDirectory(atPath: written.path()).sorted()
        #expect(names == ["assets", "index.html", "manifest.json"])
    }

    /// Handing Necto a path it cannot read would crash on an assertion.
    @Test("returns nil for a path it cannot write")
    func writeFailure() {
        #expect(PanelWriter.write(to: URL(filePath: "/dev/null/maplocal")) == nil)
    }

    /// The local `src` and `href` values of an HTML page, without a leading `./`. Remote,
    /// protocol-relative, data and fragment references are left out.
    static func localReferences(in html: String) -> [String] {
        let pattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/
        return html.matches(of: pattern).map { String($0.output.1) }
            .filter { reference in
                !["http:", "https:", "//", "data:", "#"].contains { reference.hasPrefix($0) }
            }
            .map { $0.hasPrefix("./") ? String($0.dropFirst(2)) : $0 }
    }

    /// Necto's panel asset harness checks the same (docs/harness.md): a reference to a
    /// missing or empty file loads a blank panel with no error anywhere.
    @Test("every local script and stylesheet index.html references is embedded and not empty")
    func indexReferencesExist() throws {
        let data = try #require(EmbeddedPanel.files["index.html"].flatMap { Data(base64Encoded: $0) })
        let references = Self.localReferences(in: try #require(String(data: data, encoding: .utf8)))
        #expect(references.contains { $0.hasSuffix(".js") })
        #expect(references.contains { $0.hasSuffix(".css") })
        for reference in references {
            let file = EmbeddedPanel.files[reference].flatMap { Data(base64Encoded: $0) }
            #expect(file != nil, "\(reference) is referenced but not embedded")
            #expect(file?.isEmpty == false, "\(reference) is empty")
        }
    }

    @Test("the reference reader finds src and href, strips ./ and skips remote ones")
    func readsReferences() {
        let html = """
            <script type="module" crossorigin src="./assets/index.js"></script>
            <link rel="stylesheet" href='assets/missing.css'>
            <link rel="icon" href="https://example.com/x.png"><a href="#top"></a>
            <img src="//cdn.example.com/y.png"><img src="data:image/png;base64,AA==">
            """
        #expect(Self.localReferences(in: html) == ["assets/index.js", "assets/missing.css"])
    }
}
#endif
