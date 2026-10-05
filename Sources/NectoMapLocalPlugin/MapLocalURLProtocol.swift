//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import MapLocalCore

/// Answers the requests the engine decides to mock, and lets every other request through.
///
/// `MapLocalInstaller` puts it in front of every session. A request it declines is
/// recorded as a passthrough and reaches the network unchanged. Apps that set their own
/// `protocolClasses` reach it through `NectoMapLocalPlugin.protocolClass`, so the class
/// itself stays internal and may be renamed.
final class MapLocalURLProtocol: URLProtocol {
    private var relay: ClientRelay?
    var work: Task<Void, Never>?

    /// Called exactly once per task, and once per redirect hop.
    ///
    /// The decision is tied to the task, not stamped on the request. If it were on the
    /// request, an app that copies `currentRequest` and changes its URL or method would
    /// carry the old decision along.
    override class func canInit(with task: URLSessionTask) -> Bool {
        guard let engine = MapLocalRuntime.engine,
              let request = task.currentRequest ?? task.originalRequest
        else {
            return false
        }
        guard let decision = engine.decide(request) else {
            engine.recordPassthrough(request)
            return false
        }
        TaskDecisions.shared.store(decision, for: task)
        return true
    }

    /// Does not read the body. Reading it would send an unmatched real request with an
    /// empty body.
    override class func canInit(with request: URLRequest) -> Bool {
        MapLocalRuntime.engine?.decide(request) != nil
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override class func requestIsCacheEquivalent(_ first: URLRequest, to second: URLRequest) -> Bool { false }

    override func startLoading() {
        let request = self.request
        let decision = task.flatMap(TaskDecisions.shared.take) ?? MapLocalRuntime.engine?.decide(request)
        guard let decision, let url = request.url, let engine = MapLocalRuntime.engine else {
            let error = URLError(
                .resourceUnavailable,
                userInfo: [NSLocalizedDescriptionKey: "Map Local: the rule is gone"]
            )
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        engine.recordMocked(request, decision: decision)
        let response = decision.response
        let relay = ClientRelay(self)
        self.relay = relay
        let wait = Self.delay(response.delayMs, on: engine.clock)
        work = Task {
            do {
                try await wait()
            } catch {
                return
            }
            relay.deliver(response, url: url, request: request)
        }
    }

    /// Returns a wait that ends `milliseconds` after now.
    ///
    /// The delay counts from when the request started. Fixing the deadline here gives the
    /// same result however late the `Task` is scheduled.
    static func delay<C: Clock<Duration>>(
        _ milliseconds: Int,
        on clock: C
    ) -> @Sendable () async throws -> Void {
        guard milliseconds > 0 else { return {} }
        let deadline = clock.now.advanced(by: .milliseconds(milliseconds))
        return { try await clock.sleep(until: deadline, tolerance: nil) }
    }

    override func stopLoading() {
        relay?.stop()
        work?.cancel()
        relay = nil
    }
}

/// Keeps the decision made in `canInit(with:)` for a task until `startLoading()`.
///
/// Tasks are held weakly, so an entry goes away with its task.
final class TaskDecisions: @unchecked Sendable {
    static let shared = TaskDecisions()
    private let lock = NSLock()
    private let table = NSMapTable<URLSessionTask, DecisionBox>.weakToStrongObjects()

    func store(_ decision: Decision, for task: URLSessionTask) {
        lock.withLock { table.setObject(DecisionBox(decision), forKey: task) }
    }

    func take(_ task: URLSessionTask) -> Decision? {
        lock.withLock {
            let box = table.object(forKey: task)
            table.removeObject(forKey: task)
            return box?.decision
        }
    }

    private final class DecisionBox {
        let decision: Decision
        init(_ decision: Decision) { self.decision = decision }
    }
}

/// Delivers a response to a `URLProtocol`'s client from another task.
///
/// The SDK marks `URLProtocol` as not `Sendable`, so `@unchecked Sendable` on a subclass has
/// no effect. Only this relay is handed to the `Task`, never the protocol instance. As the
/// `URLProtocol` contract requires, it calls the client on the run loop of the thread that
/// called `startLoading()`, and never after `stopLoading()`.
final class ClientRelay: @unchecked Sendable {
    private let lock = NSLock()
    private let runLoop: CFRunLoop
    private let mode: CFRunLoopMode
    private var target: (urlProtocol: URLProtocol, client: URLProtocolClient)?

    init(_ urlProtocol: URLProtocol) {
        runLoop = CFRunLoopGetCurrent()
        mode = CFRunLoopCopyCurrentMode(runLoop) ?? .defaultMode
        target = urlProtocol.client.map { (urlProtocol, $0) }
    }

    func stop() { lock.withLock { target = nil } }

    func deliver(_ response: ResolvedResponse, url: URL, request: URLRequest) {
        CFRunLoopPerformBlock(runLoop, mode.rawValue) { [self] in
            guard let (urlProtocol, client) = lock.withLock({ target }) else { return }
            if let code = response.errorCode {
                let error = URLError(
                    URLError.Code(rawValue: code),
                    userInfo: [
                        NSURLErrorFailingURLErrorKey: url,
                        NSURLErrorFailingURLStringErrorKey: url.absoluteString,
                    ]
                )
                client.urlProtocol(urlProtocol, didFailWithError: error)
                return
            }
            guard let http = HTTPURLResponse(
                url: url,
                statusCode: response.status,
                httpVersion: "HTTP/1.1",
                headerFields: response.headers
            ) else {
                client.urlProtocol(urlProtocol, didFailWithError: URLError(.badServerResponse))
                return
            }
            if request.httpShouldHandleCookies {
                // The cookie parser matches header names case-sensitively, and HTTP/2 headers
                // copied from developer tools are lowercase.
                let fields = response.headers.reduce(into: [String: String]()) { fields, pair in
                    fields[pair.key.lowercased() == "set-cookie" ? "Set-Cookie" : pair.key] = pair.value
                }
                let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
                if !cookies.isEmpty {
                    HTTPCookieStorage.shared.setCookies(cookies, for: url, mainDocumentURL: request.mainDocumentURL)
                }
            }
            client.urlProtocol(urlProtocol, didReceive: http, cacheStoragePolicy: .notAllowed)
            if !response.body.isEmpty { client.urlProtocol(urlProtocol, didLoad: response.body) }
            client.urlProtocolDidFinishLoading(urlProtocol)
        }
        CFRunLoopWakeUp(runLoop)
    }
}
#endif
