//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// Writes the embedded panel to disk, where Necto serves it from.
enum PanelWriter {
    static let defaultDirectory = FileManager.default.temporaryDirectory.appending(path: "NectoMapLocalPanel")

    /// Empties the fixed directory and writes the panel into it.
    ///
    /// Necto hashes every regular file in the directory to identify the panel's content,
    /// so a file left over from an older panel would change that hash.
    static func write(to directory: URL = defaultDirectory) -> URL? {
        let fileManager = FileManager.default
        do {
            if fileManager.fileExists(atPath: directory.path(percentEncoded: false)) {
                try fileManager.removeItem(at: directory)
            }
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            for (path, base64) in EmbeddedPanel.files {
                guard let data = Data(base64Encoded: base64) else { return nil }
                let file = directory.appending(path: path)
                try fileManager.createDirectory(
                    at: file.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: file, options: .atomic)
            }
            return directory
        } catch {
            return nil
        }
    }
}
#endif
