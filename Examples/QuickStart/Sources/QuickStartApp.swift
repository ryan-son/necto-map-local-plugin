//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if DEBUG
import NectoMapLocalPlugin
import NectoSDK
#endif
import SwiftUI

@main
struct QuickStartApp: App {
    init() {
        #if DEBUG
        NectoSDK.register(NectoMapLocalPlugin())
        NectoSDK.start()
        #endif
    }

    @State private var result = "Not requested yet"

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 16) {
                Text(result).font(.body.monospaced())
                // Set a response for this URL in the Map Local panel and the app gets it; otherwise the request goes to the server.
                // verbatim: from iOS 27 a URL in a localized title becomes a link that opens Safari
                // instead of running the action.
                Button {
                    Task {
                        do {
                            let (data, response) = try await URLSession.shared.data(from: URL(string: "https://httpbin.org/json")!)
                            result = "\((response as? HTTPURLResponse)?.statusCode ?? -1)\n\(String(decoding: data.prefix(200), as: UTF8.self))"
                        } catch {
                            result = "\(error)"
                        }
                    }
                } label: {
                    Text(verbatim: "GET https://httpbin.org/json")
                }
            }
            .padding()
        }
    }
}
