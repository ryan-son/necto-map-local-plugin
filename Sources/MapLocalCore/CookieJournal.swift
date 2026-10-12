//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// What a mocked write left under a key, read back from storage after the write.
public enum CookieWrite: Codable, Equatable, Sendable {
    case stored(CookieRecord)
    /// The mock removed the cookie, with a `Max-Age=0` or a past `Expires`.
    case deleted

    /// Whether `stored`, the cookie now under the key, is still what the mock left.
    public func matches(_ stored: CookieRecord?) -> Bool {
        switch self {
        case let .stored(record): stored == record
        case .deleted: stored == nil
        }
    }
}

/// One key a mock has written, and the real value to bring back.
public struct CookieEntry: Codable, Equatable, Sendable {
    public enum Layer: String, Codable, Sendable {
        /// The mock's cookie is in storage.
        case active
        /// Map Local is off and the real value is back; turning it on puts the mock's back.
        case setAside
    }

    public var key: CookieKey
    /// The real cookie before the mock took the key, or nil when there was none.
    public var before: CookieRecord?
    /// The launch `before` was read in. A session `before` from an earlier launch has died.
    public var beforeLaunchID: String
    public var written: CookieWrite
    /// The launch of the last mocked write.
    public var launchID: String
    public var layer: Layer = .active
    /// For a set-aside entry, what storage held right after it was set aside.
    public var restoredTo: CookieRecord?
    /// Saved before the mock's write and cleared after it is read back. An entry still in
    /// flight means the process died in between, so the mock may be in storage.
    public var inFlight: Bool?
}

/// Every key Map Local's mocks have written, kept in the app's container.
public struct CookieJournal: Codable, Equatable, Sendable {
    public var entries: [CookieEntry] = []
    /// Restored entries the next launch checks again, in case a kill lost the restore
    /// before `HTTPCookieStorage` saved it.
    public var pending: [CookieEntry] = []

    public static let empty = CookieJournal()
}

/// A journal as it was loaded.
public enum CookieJournalLoad: Equatable, Sendable {
    case loaded(CookieJournal)
    /// The file exists but cannot be read, such as before first unlock. It is never
    /// overwritten.
    case unreadable(String)
    /// The file was not a journal and was deleted. It held real cookies, so it is not kept.
    case invalid
}
#endif
