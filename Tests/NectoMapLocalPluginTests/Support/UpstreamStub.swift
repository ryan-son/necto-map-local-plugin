//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import os
import Testing

/// The parent of every suite that replaces the global `MapLocalRuntime`, so that those
/// suites never run in parallel with each other.
@Suite(.serialized, .timeLimit(.minutes(1))) enum RuntimeSuites {}

/// Plays the real server. Only requests Map Local did not take arrive here, and it records
/// the length of each body it receives.
final class UpstreamStub: URLProtocol, @unchecked Sendable {
    static let received = OSAllocatedUnfairLock<[(path: String, bodyLength: Int)]>(initialState: [])

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var length = request.httpBody?.count ?? 0
        if let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                length += count
            }
            stream.close()
        }
        let total = length
        let path = request.url?.path() ?? ""
        Self.received.withLock { $0.append((path, total)) }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Cache-Control": "max-age=600"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
        client?.urlProtocol(self, didLoad: Data("upstream".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
#endif
