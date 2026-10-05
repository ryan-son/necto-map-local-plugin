//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import os

/// Sends each value to every current subscriber.
///
/// With `replay`, a new subscriber first receives the last value sent, so a panel opened
/// late still starts from the current state.
public final class Broadcaster<Value: Sendable>: Sendable {
    private struct State {
        var continuations: [UUID: AsyncStream<Value>.Continuation] = [:]
        var last: Value?
    }

    private let state = OSAllocatedUnfairLock(initialState: State())
    private let replay: Bool

    public init(replay: Bool) { self.replay = replay }

    public func stream() -> AsyncStream<Value> {
        AsyncStream { continuation in
            let id = UUID()
            continuation.onTermination = { [weak self] _ in
                _ = self?.state.withLock { $0.continuations.removeValue(forKey: id) }
            }
            // Registering, replaying and sending share one lock. Otherwise a value sent at
            // the moment of subscribing could arrive before the older replayed one.
            state.withLock { state in
                state.continuations[id] = continuation
                if replay, let last = state.last { continuation.yield(last) }
            }
        }
    }

    public func send(_ value: Value) {
        state.withLock { state in
            if replay { state.last = value }
            for continuation in state.continuations.values {
                continuation.yield(value)
            }
        }
    }
}
#endif
