//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import NectoMapLocalPlugin
import NectoSDK
import SwiftUI

@main
struct ShopDevApp: App {
    init() {
        #if DEBUG
        NectoSDK.register(NectoMapLocalPlugin())
        NectoSDK.start()
        #endif
    }

    var body: some Scene { WindowGroup { ContentView() } }
}
