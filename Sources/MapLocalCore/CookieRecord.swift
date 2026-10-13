//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// The identity `HTTPCookieStorage` replaces a cookie by.
///
/// A host-only cookie keeps the bare host as its domain and a `Domain=` cookie gets a
/// leading dot, so the two are different keys, as they are in the storage.
public struct CookieKey: Hashable, Codable, Sendable {
    public var domain: String
    public var path: String
    public var name: String

    public init(domain: String, path: String, name: String) {
        self.domain = domain
        self.path = path
        self.name = name
    }

    public init(_ cookie: HTTPCookie) {
        self.init(domain: cookie.domain, path: cookie.path, name: cookie.name)
    }
}

/// A cookie as the journal keeps it.
///
/// `HTTPCookie.properties` holds dates, numbers and arrays that `JSONSerialization`
/// rejects, so the journal stores these fields instead. `Created` is left out: it changes
/// on every write and says nothing about the cookie.
public struct CookieRecord: Codable, Equatable, Sendable {
    public var name: String
    public var value: String
    public var domain: String
    public var path: String
    /// Whole seconds since 1970, or nil for a session cookie. Storage keeps whole seconds,
    /// so comparing at this precision matches what is read back.
    public var expires: Int?
    public var secure: Bool
    public var httpOnly: Bool
    public var sameSite: String?
    public var comment: String?
    public var commentURL: String?
    public var ports: [Int]
    public var version: Int

    public init(_ cookie: HTTPCookie) {
        name = cookie.name
        value = cookie.value
        domain = cookie.domain
        path = cookie.path
        expires = cookie.expiresDate.map { Int($0.timeIntervalSince1970.rounded(.down)) }
        secure = cookie.isSecure
        httpOnly = cookie.isHTTPOnly
        sameSite = cookie.sameSitePolicy?.rawValue
        comment = cookie.comment
        commentURL = cookie.commentURL?.absoluteString
        ports = (cookie.portList ?? []).map(\.intValue)
        version = cookie.version
    }

    public var key: CookieKey { CookieKey(domain: domain, path: path, name: name) }

    public var isSession: Bool { expires == nil }

    public func hasExpired(at now: Date) -> Bool {
        expires.map { TimeInterval($0) <= now.timeIntervalSince1970 } ?? false
    }

    /// The cookie to store again, or nil if Foundation refuses the fields.
    public var cookie: HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            .domain: domain,
            .path: path,
            .version: String(version),
        ]
        if let expires { properties[.expires] = Date(timeIntervalSince1970: TimeInterval(expires)) }
        if secure { properties[.secure] = "TRUE" }
        if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if let sameSite { properties[.sameSitePolicy] = sameSite }
        if let comment { properties[.comment] = comment }
        if let commentURL { properties[.commentURL] = commentURL }
        if !ports.isEmpty { properties[.port] = ports.map(String.init).joined(separator: ",") }
        return HTTPCookie(properties: properties)
    }
}
#endif
