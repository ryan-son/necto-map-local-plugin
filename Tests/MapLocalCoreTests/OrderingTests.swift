//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

/// State delivery is only reordered by a concurrency race. That is probabilistic, so these
/// tests catch it by repetition. Measured in review: 8 in 3,000 runs, 41 in 200,000.
@Suite("State delivery order", .timeLimit(.minutes(1)))
struct OrderingTests {
    @Test("a new subscriber's last state is the current state even when a write and a request record overlap")
    func engineReplayIsCurrentState() async {
        var stale = 0
        for index in 0..<3000 {
            let engine = MapLocalEngine(
                store: MemoryConfigurationStore(Configuration(enabled: false, allowedHosts: ["maplocal.invalid"])),
                blockedHosts: []
            )
            let request = URLRequest(url: URL(string: "https://h\(index).invalid/x")!)
            DispatchQueue.concurrentPerform(iterations: 2) { iteration in
                if iteration == 0 {
                    engine.recordPassthrough(request)
                } else {
                    _ = try? engine.apply(
                        .patch(enabled: true, allowedHosts: nil, unmatched: nil, order: nil),
                        baseRevision: 0
                    )
                }
            }
            var iterator = engine.stateEvents().makeAsyncIterator()
            if await iterator.next() != engine.state { stale += 1 }
        }
        #expect(stale == 0)
    }

    @Test("an old replay never arrives after a value sent at the moment of subscribing")
    func sendWhileSubscribing() async {
        var reordered = 0
        for _ in 0..<50_000 {
            let broadcaster = Broadcaster<Int>(replay: true)
            broadcaster.send(1)
            let box = StreamBox()
            DispatchQueue.concurrentPerform(iterations: 2) { iteration in
                if iteration == 0 { box.stream = broadcaster.stream() } else { broadcaster.send(2) }
            }
            var iterator = box.stream!.makeAsyncIterator()
            if await iterator.next() == 2 {
                broadcaster.send(3)
                if await iterator.next() == 1 { reordered += 1 }
            }
        }
        #expect(reordered == 0)
    }
}

private final class StreamBox: @unchecked Sendable { var stream: AsyncStream<Int>? }
#endif
