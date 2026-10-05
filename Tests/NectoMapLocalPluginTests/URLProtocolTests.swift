//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Clocks
@testable import MapLocalCore
import os
import Testing
@testable import NectoMapLocalPlugin

/// There is one engine per process, so these tests run serially.
/// Replaces the global engine, so it runs under `RuntimeSuites`, serially with the other
/// runtime suites.
extension RuntimeSuites {
@Suite("MapLocalURLProtocol")
struct URLProtocolTests {
    static let host = "maplocal.invalid"

    @discardableResult
    func install(
        _ rules: [Rule],
        unmatched: Unmatched = .passthrough,
        clock: any Clock<Duration> = ContinuousClock()
    ) -> MapLocalEngine {
        let configuration = Configuration(
            allowedHosts: [Self.host],
            unmatched: unmatched,
            rules: rules.map(RuleEntry.rule)
        )
        let engine = MapLocalEngine(store: MemoryConfigurationStore(configuration), blockedHosts: [], clock: clock)
        MapLocalRuntime.replace(engine)
        return engine
    }

    func session(cache: URLCache? = nil) -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MapLocalURLProtocol.self, UpstreamStub.self]
        configuration.urlCache = cache
        return URLSession(configuration: configuration)
    }

    static func rule(_ path: String, _ specs: [String: ResponseSpec], active: String, method: String = "GET") -> Rule {
        Rule(id: "r", match: Match(method: method, path: path), active: active, responses: specs)
    }

    func makeProtocol(_ path: String, client: URLProtocolClient) -> MapLocalURLProtocol {
        MapLocalURLProtocol(
            request: URLRequest(url: URL(string: "https://\(Self.host)\(path)")!),
            cachedResponse: nil,
            client: client
        )
    }

    @Test("a match returns the mocked response with the marker header")
    func mocks() async throws {
        _ = install([Self.rule("/a", ["ok": ResponseSpec(status: 201, body: .text("mock"))], active: "ok")])
        let (data, response) = try await session().data(from: URL(string: "https://\(Self.host)/a")!)
        let http = try #require(response as? HTTPURLResponse)
        #expect(http.statusCode == 201)
        #expect(String(decoding: data, as: UTF8.self) == "mock")
        #expect(http.value(forHTTPHeaderField: "X-Map-Local") == "r/ok")
    }

    @Test("a request without a match goes to the real server upstream")
    func passesThrough() async throws {
        _ = install([Self.rule("/a", ["ok": ResponseSpec(status: 200)], active: "ok")])
        let (data, _) = try await session().data(from: URL(string: "https://\(Self.host)/b")!)
        #expect(String(decoding: data, as: UTF8.self) == "upstream")
    }

    @Test("an unmatched POST with a streamed body reaches the real server with its whole body")
    func passesStreamedBodyThrough() async throws {
        _ = install([Self.rule("/a", ["ok": ResponseSpec(status: 200)], active: "ok")])
        UpstreamStub.received.withLock { $0.removeAll() }
        let payload = Data(repeating: 7, count: 10_000)
        var request = URLRequest(url: URL(string: "https://\(Self.host)/upload")!)
        request.httpMethod = "POST"
        request.httpBodyStream = InputStream(data: payload)
        request.setValue("\(payload.count)", forHTTPHeaderField: "Content-Length")
        _ = try await session().data(for: request)
        #expect(UpstreamStub.received.withLock { $0.last?.bodyLength } == payload.count)
    }

    @Test(
        "an error response gives its URLError and the failing URL",
        arguments: [MockError.notConnectedToInternet, .connectionLost, .timedOut]
    )
    func failsWithError(error: MockError) async {
        _ = install([Self.rule("/a", ["e": ResponseSpec(error: error)], active: "e")])
        let url = URL(string: "https://\(Self.host)/a")!
        do {
            _ = try await session().data(from: url)
            Issue.record("must fail")
        } catch let urlError as URLError {
            #expect(urlError.code == error.urlErrorCode)
            #expect(urlError.failureURLString == url.absoluteString)
            #expect(urlError.failingURL == url)
        } catch {
            Issue.record("not a URLError: \(error)")
        }
    }

    @Test("mocked responses stay out of the cache, so the real server answers once turned off")
    func doesNotCache() async throws {
        let engine = install([Self.rule(
            "/c",
            ["ok": ResponseSpec(status: 200, headers: ["Cache-Control": "max-age=600"], body: .text("mock"))],
            active: "ok"
        )])
        let cache = URLCache(memoryCapacity: 1_000_000, diskCapacity: 0)
        let cachingSession = session(cache: cache)
        let url = URL(string: "https://\(Self.host)/c")!
        _ = try await cachingSession.data(from: url)
        #expect(cache.cachedResponse(for: URLRequest(url: url)) == nil)
        try engine.apply(.patch(enabled: false, allowedHosts: nil, unmatched: nil, order: nil), baseRevision: 0)
        let (data, _) = try await cachingSession.data(from: url)
        #expect(String(decoding: data, as: UTF8.self) == "upstream")
    }

    @Test("a task answers with its first decision even when the configuration changes before it starts")
    func taskKeepsItsDecision() throws {
        let engine = install([Self.rule(
            "/a",
            ["one": ResponseSpec(status: 200), "two": ResponseSpec(status: 500)],
            active: "one"
        )])
        let task = session().dataTask(with: URL(string: "https://\(Self.host)/a")!)
        defer { task.cancel() }
        #expect(MapLocalURLProtocol.canInit(with: task))
        try engine.apply(.setActive(ruleID: "r", response: "two"), baseRevision: 0)
        let client = RecordingClient()
        let loader = LoaderThread()
        defer { loader.stop() }
        loader.run { MapLocalURLProtocol(task: task, cachedResponse: nil, client: client).startLoading() }
        client.waitForEnd()
        #expect(client.status == 200)
    }

    @Test("a request the app copies and sends again is decided anew from the current configuration and its URL")
    func copiedRequestIsDecidedAgain() async throws {
        let engine = install([])
        let ruleA = Rule(
            id: "a",
            match: Match(method: "GET", path: "/a"),
            active: "one",
            responses: ["one": ResponseSpec(status: 200, body: .text("A")), "two": ResponseSpec(status: 500)]
        )
        let ruleB = Rule(
            id: "b",
            match: Match(method: "GET", path: "/b"),
            active: "ok",
            responses: ["ok": ResponseSpec(status: 201, body: .text("B"))]
        )
        try engine.apply(
            .replace(Configuration(allowedHosts: [Self.host], rules: [.rule(ruleA), .rule(ruleB)])),
            baseRevision: 0
        )
        // The request the system holds on the task (`currentRequest`).
        let held = MapLocalURLProtocol.canonicalRequest(for: URLRequest(url: URL(string: "https://\(Self.host)/a")!))
        try engine.apply(.setActive(ruleID: "a", response: "two"), baseRevision: 1)

        let (_, resent) = try await session().data(for: held)
        #expect((resent as? HTTPURLResponse)?.statusCode == 500)

        var moved = held
        moved.url = URL(string: "https://\(Self.host)/b")
        let (body, response) = try await session().data(for: moved)
        #expect((response as? HTTPURLResponse)?.statusCode == 201)
        #expect(String(decoding: body, as: UTF8.self) == "B")
    }

    @Test("response callbacks arrive on the thread that called startLoading")
    func callbackThread() {
        install([Self.rule("/a", ["ok": ResponseSpec(status: 200, body: .text("x"))], active: "ok")])
        let client = RecordingClient()
        let loader = LoaderThread()
        defer { loader.stop() }
        loader.run { makeProtocol("/a", client: client).startLoading() }
        client.waitForEnd()
        #expect(client.events == ["response", "data", "finish"])
        #expect(client.threads == [loader.underlying])
    }

    @Test("a delayed response arrives only after the clock has moved that far since the request started")
    func delays() async {
        let clock = TestClock()
        install([Self.rule("/a", ["ok": ResponseSpec(status: 204, delayMs: 500)], active: "ok")], clock: clock)
        let client = RecordingClient()
        let loader = LoaderThread()
        defer { loader.stop() }
        let started = ProtocolBox()
        loader.run {
            let urlProtocol = makeProtocol("/a", client: client)
            started.value = urlProtocol
            urlProtocol.startLoading()
        }
        loader.flush()
        await clock.advance(by: .milliseconds(499))
        loader.flush()
        #expect(client.events.isEmpty)

        await clock.advance(by: .milliseconds(1))
        await started.value?.work?.value
        loader.flush()
        #expect(client.events == ["response", "finish"])
    }

    @Test("calls no response callback after stopLoading, however far the clock moves", arguments: [0, 30])
    func noCallbackAfterStop(delayMs: Int) async {
        let clock = TestClock()
        install(
            [Self.rule("/a", ["ok": ResponseSpec(status: 200, body: .text("x"), delayMs: delayMs)], active: "ok")],
            clock: clock
        )
        let client = RecordingClient()
        let loader = LoaderThread()
        defer { loader.stop() }
        let started = ProtocolBox()
        loader.run {
            let urlProtocol = makeProtocol("/a", client: client)
            started.value = urlProtocol
            urlProtocol.startLoading()
            urlProtocol.stopLoading()
        }
        loader.flush()
        await clock.advance(by: .milliseconds(delayMs))
        await started.value?.work?.value
        loader.flush()
        #expect(client.events.isEmpty)
    }

    @Test("records a mocked request exactly once")
    func recordsOnce() async throws {
        let engine = install([Self.rule("/a", ["ok": ResponseSpec(status: 200)], active: "ok")])
        var events = engine.requestEvents().makeAsyncIterator()
        _ = try await session().data(from: URL(string: "https://\(Self.host)/a")!)
        // If the passthrough request that follows is the very next record, nothing was
        // recorded twice in between.
        _ = try await session().data(from: URL(string: "https://other.invalid/sentinel")!)
        #expect(await events.next()?.outcome == .mocked(rule: "r", response: "ok", status: 200, error: nil))
        #expect(await events.next()?.path == "/sentinel")
    }

    @Test("records every unmatched request, and collects each observed host once")
    func recordsPassthroughs() async throws {
        let engine = install([])
        var events = engine.requestEvents().makeAsyncIterator()
        _ = try await session().data(from: URL(string: "https://other.invalid/p1")!)
        _ = try await session().data(from: URL(string: "https://other.invalid/p2")!)
        #expect(await events.next()?.path == "/p1")
        #expect(await events.next()?.path == "/p2")
        #expect(engine.state.observedHosts == ["other.invalid"])
    }

    @Test("blocking unmatched requests keeps them from the real server, with the set status, body and marker")
    func blocksUnmatched() async throws {
        install([], unmatched: .block(status: 421))
        let (data, response) = try await session().data(from: URL(string: "https://\(Self.host)/x/y")!)
        let http = try #require(response as? HTTPURLResponse)
        #expect(http.statusCode == 421)
        #expect(http.value(forHTTPHeaderField: "X-Map-Local") == "unmocked")
        #expect(String(decoding: data, as: UTF8.self) == #"{"code":"MAP_LOCAL_UNMOCKED","message":"unmocked: /x/y"}"#)
    }

    @Test(
        "failing unmatched requests gives each its URLError and records it, and the server is never asked",
        arguments: [MockError.notConnectedToInternet, .connectionLost, .timedOut]
    )
    func failsUnmatched(error: MockError) async {
        let engine = install([], unmatched: .fail(error))
        var events = engine.requestEvents().makeAsyncIterator()
        let url = URL(string: "https://\(Self.host)/x/y")!
        do {
            _ = try await session().data(from: url)
            Issue.record("must fail")
        } catch let urlError as URLError {
            #expect(urlError.code == error.urlErrorCode)
            #expect(urlError.failingURL == url)
        } catch {
            Issue.record("not a URLError: \(error)")
        }
        #expect(await events.next()?.outcome == .unmocked(status: nil, error: error.urlErrorCode.rawValue))
    }

    @Test(
        "a mocked Set-Cookie reaches the shared cookie storage whatever the case of the header name",
        arguments: ["Set-Cookie", "set-cookie"]
    )
    func storesCookies(header: String) async throws {
        let name = "ml\(UUID().uuidString.prefix(8))"
        _ = install([Self.rule(
            "/k",
            ["ok": ResponseSpec(status: 200, headers: [header: "\(name)=v; Path=/"])],
            active: "ok"
        )])
        let url = URL(string: "https://\(Self.host)/k")!
        _ = try await session().data(from: url)
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        #expect(cookies.contains { $0.name == name })
        cookies.filter { $0.name == name }.forEach(HTTPCookieStorage.shared.deleteCookie)
    }
}
}

/// A thread with a running run loop, like `URLSession`'s protocol thread. Tests call
/// `startLoading()` and `stopLoading()` on it.
final class LoaderThread: @unchecked Sendable {
    private var runLoop: CFRunLoop?
    private var thread: Thread?
    private let ready = DispatchSemaphore(value: 0)

    init() {
        let thread = Thread { [unowned self] in
            runLoop = CFRunLoopGetCurrent()
            RunLoop.current.add(NSMachPort(), forMode: .default)
            ready.signal()
            while !Thread.current.isCancelled {
                _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
            }
        }
        self.thread = thread
        thread.start()
        ready.wait()
    }

    var underlying: Thread { thread! }

    func run(_ block: @escaping () -> Void) {
        CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue, block)
        CFRunLoopWakeUp(runLoop)
    }

    /// Waits until every block queued before has run.
    func flush() {
        let done = DispatchSemaphore(value: 0)
        run { done.signal() }
        done.wait()
    }

    func stop() { thread?.cancel() }
}

/// Holds on to a protocol created on the loader thread, for the test to reach.
final class ProtocolBox: @unchecked Sendable {
    var value: MapLocalURLProtocol?
}

/// Records each callback and the thread it arrived on, when a test calls `startLoading()`
/// itself.
final class RecordingClient: NSObject, URLProtocolClient, @unchecked Sendable {
    private let lock = NSLock()
    private let ended = DispatchSemaphore(value: 0)
    private var log: [(event: String, thread: Thread)] = []
    private(set) var status: Int?

    var events: [String] { lock.withLock { log.map(\.event) } }
    var threads: Set<Thread> { lock.withLock { Set(log.map(\.thread)) } }
    func waitForEnd() { _ = ended.wait(timeout: .now() + 2) }

    private func record(_ event: String) { lock.withLock { log.append((event, Thread.current)) } }

    func urlProtocol(
        _ urlProtocol: URLProtocol,
        didReceive response: URLResponse,
        cacheStoragePolicy: URLCache.StoragePolicy
    ) {
        status = (response as? HTTPURLResponse)?.statusCode
        record("response")
    }

    func urlProtocol(_ urlProtocol: URLProtocol, didLoad data: Data) { record("data") }

    func urlProtocolDidFinishLoading(_ urlProtocol: URLProtocol) {
        record("finish")
        ended.signal()
    }

    func urlProtocol(_ urlProtocol: URLProtocol, didFailWithError error: Error) {
        record("fail")
        ended.signal()
    }

    func urlProtocol(_ urlProtocol: URLProtocol, wasRedirectedTo request: URLRequest, redirectResponse: URLResponse) {}
    func urlProtocol(_ urlProtocol: URLProtocol, cachedResponseIsValid cachedResponse: CachedURLResponse) {}
    func urlProtocol(_ urlProtocol: URLProtocol, didReceive challenge: URLAuthenticationChallenge) {}
    func urlProtocol(_ urlProtocol: URLProtocol, didCancel challenge: URLAuthenticationChallenge) {}
}
#endif
