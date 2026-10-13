//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// The cookie storage Map Local writes mocked cookies to and restores from.
///
/// The app's engine uses `HTTPCookieStorage.shared`; tests use an isolated storage, so no
/// test touches the shared one.
public protocol CookieJar: Sendable {
    /// The cookie stored under `key`, if any.
    func cookie(_ key: CookieKey) -> HTTPCookie?
    /// Stores a response's cookies as the loading system would, applying the accept policy.
    func setCookies(_ cookies: [HTTPCookie], for url: URL, mainDocumentURL: URL?)
    /// Stores one cookie whatever the accept policy, so a strict policy cannot block a restore.
    func set(_ cookie: HTTPCookie)
    func delete(_ key: CookieKey)
}

/// A `CookieJar` over an `HTTPCookieStorage`.
public struct StorageCookieJar: CookieJar, @unchecked Sendable {
    // `HTTPCookieStorage` is thread-safe but not marked `Sendable`.
    private let storage: HTTPCookieStorage

    public init(_ storage: HTTPCookieStorage = .shared) { self.storage = storage }

    /// A storage of its own, for tests.
    static func isolated(policy: HTTPCookie.AcceptPolicy = .always) -> StorageCookieJar {
        let storage = HTTPCookieStorage.sharedCookieStorage(forGroupContainerIdentifier: "maplocal.test.\(UUID().uuidString)")
        storage.cookieAcceptPolicy = policy
        return StorageCookieJar(storage)
    }

    public func cookie(_ key: CookieKey) -> HTTPCookie? {
        (storage.cookies ?? []).first { CookieKey($0) == key }
    }

    public func setCookies(_ cookies: [HTTPCookie], for url: URL, mainDocumentURL: URL?) {
        storage.setCookies(cookies, for: url, mainDocumentURL: mainDocumentURL)
    }

    public func set(_ cookie: HTTPCookie) { storage.setCookie(cookie) }

    public func delete(_ key: CookieKey) {
        if let cookie = cookie(key) { storage.deleteCookie(cookie) }
    }
}
#endif
