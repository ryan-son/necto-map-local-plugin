//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
@testable import MapLocalCore
import Testing
@testable import NectoMapLocalPlugin

/// Replaces the global engine, so it runs under `RuntimeSuites`, serially with the other
/// runtime suites.
extension RuntimeSuites {
@Suite("MapLocalInstaller")
struct InstallerTests {
    @Test("installing many times adds the protocol once, first, and keeps the existing list")
    func installIsIdempotent() {
        let before = URLSessionConfiguration.default.protocolClasses?.map { ObjectIdentifier($0) } ?? []
        MapLocalInstaller.installIfNeeded()
        MapLocalInstaller.installIfNeeded()
        MapLocalInstaller.installIfNeeded()
        for configuration in [URLSessionConfiguration.default, URLSessionConfiguration.ephemeral] {
            let classes = configuration.protocolClasses ?? []
            #expect(classes.first.map(ObjectIdentifier.init) == ObjectIdentifier(MapLocalURLProtocol.self))
            #expect(classes.filter { $0 == MapLocalURLProtocol.self }.count == 1)
        }
        let after = URLSessionConfiguration.default.protocolClasses?.dropFirst().map { ObjectIdentifier($0) } ?? []
        #expect(Array(after) == before.filter { $0 != ObjectIdentifier(MapLocalURLProtocol.self) })
    }

    @Test("after installing, both a session from the default configuration and the shared session are mocked")
    func mocksSessions() async throws {
        let rule = Rule(
            id: "g",
            match: Match(method: "GET", path: "/g"),
            active: "ok",
            responses: ["ok": ResponseSpec(status: 204)]
        )
        let configuration = Configuration(allowedHosts: ["maplocal.invalid"], rules: [.rule(rule)])
        MapLocalRuntime.replace(MapLocalEngine(store: MemoryConfigurationStore(configuration), blockedHosts: []))
        MapLocalInstaller.installIfNeeded()
        let url = URL(string: "https://maplocal.invalid/g")!
        let (_, defaultResponse) = try await URLSession(configuration: .default).data(from: url)
        let (_, sharedResponse) = try await URLSession.shared.data(from: url)
        #expect((defaultResponse as? HTTPURLResponse)?.statusCode == 204)
        #expect((sharedResponse as? HTTPURLResponse)?.statusCode == 204)
    }

    @Test("a configuration whose protocol classes were replaced is mocked again once protocolClass is put in front")
    func protocolClassRestoresReplacedList() async throws {
        Self.installEngine()
        MapLocalInstaller.installIfNeeded()

        let replaced = URLSessionConfiguration.ephemeral
        replaced.protocolClasses = [UpstreamStub.self]
        replaced.urlCache = nil
        let (realData, realResponse) = try await URLSession(configuration: replaced).data(from: Self.url)
        #expect((realResponse as? HTTPURLResponse)?.statusCode == 200)
        #expect(String(decoding: realData, as: UTF8.self) == "upstream")

        let restored = URLSessionConfiguration.ephemeral
        restored.protocolClasses = [UpstreamStub.self]
        restored.protocolClasses = [NectoMapLocalPlugin.protocolClass] + (restored.protocolClasses ?? [])
        restored.urlCache = nil
        let (_, mockedResponse) = try await URLSession(configuration: restored).data(from: Self.url)
        let http = try #require(mockedResponse as? HTTPURLResponse)
        #expect(http.statusCode == 204)
        #expect(http.value(forHTTPHeaderField: "X-Map-Local") == "g/ok")
    }

    @Test("a configuration given protocolClass before the plugin exists is mocked once it does")
    func protocolClassWorksBeforeThePlugin() async throws {
        MapLocalRuntime.replace(nil)
        let early = URLSessionConfiguration.ephemeral
        early.protocolClasses = [NectoMapLocalPlugin.protocolClass, UpstreamStub.self]
        early.urlCache = nil
        let session = URLSession(configuration: early)

        let (beforeData, _) = try await session.data(from: Self.url)
        #expect(String(decoding: beforeData, as: UTF8.self) == "upstream")

        Self.installEngine()
        let (_, afterResponse) = try await session.data(from: Self.url)
        #expect((afterResponse as? HTTPURLResponse)?.statusCode == 204)
    }

    static let url = URL(string: "https://maplocal.invalid/g")!

    static func installEngine() {
        let rule = Rule(
            id: "g",
            match: Match(method: "GET", path: "/g"),
            active: "ok",
            responses: ["ok": ResponseSpec(status: 204)]
        )
        let configuration = Configuration(allowedHosts: ["maplocal.invalid"], rules: [.rule(rule)])
        MapLocalRuntime.replace(MapLocalEngine(store: MemoryConfigurationStore(configuration), blockedHosts: []))
    }
}
}
#endif
