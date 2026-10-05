// swift-tools-version: 6.0

import PackageDescription

// Every source file is wrapped in `#if MAP_LOCAL_ENABLED`, so release builds compile none of it.
let enabled: [SwiftSetting] = [.define("MAP_LOCAL_ENABLED", .when(configuration: .debug))]

let package = Package(
    name: "necto-map-local-plugin",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "NectoMapLocalPlugin", targets: ["NectoMapLocalPlugin"]),
    ],
    dependencies: [
        .package(url: "https://github.com/toss/necto.git", .upToNextMinor(from: "0.2.0")),
        // Only the tests use it. No product target depends on it.
        .package(url: "https://github.com/pointfreeco/swift-clocks", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "MapLocalCore",
            swiftSettings: enabled
        ),
        .target(
            name: "NectoMapLocalPlugin",
            dependencies: [
                "MapLocalCore",
                .product(name: "NectoSDK", package: "necto"),
            ],
            swiftSettings: enabled
        ),
        .testTarget(
            name: "MapLocalCoreTests",
            dependencies: ["MapLocalCore"],
            swiftSettings: enabled
        ),
        .testTarget(
            name: "NectoMapLocalPluginTests",
            dependencies: [
                "NectoMapLocalPlugin",
                "MapLocalCore",
                .product(name: "NectoSDK", package: "necto"),
                .product(name: "Clocks", package: "swift-clocks"),
            ],
            swiftSettings: enabled
        ),
    ]
)
