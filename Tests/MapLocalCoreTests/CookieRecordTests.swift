//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
@testable import MapLocalCore
import Testing

@Suite("Cookie record")
struct CookieRecordTests {
    static let url = URL(string: "https://www.example.com/a/b")!

    static func parse(_ header: String, url: URL = url) -> HTTPCookie {
        HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: url)[0]
    }

    @Test("a record rebuilds an equal cookie, attributes included")
    func roundTrip() throws {
        let cookie = Self.parse("sid=S; Path=/; Domain=example.com; Max-Age=3600; Secure; HttpOnly; SameSite=Lax")
        let record = CookieRecord(cookie)
        let rebuilt = try #require(record.cookie)
        #expect(CookieRecord(rebuilt) == record)
        #expect(record.httpOnly && record.secure)
        #expect(record.sameSite == "lax")
    }

    @Test("a record encodes to JSON and back")
    func codable() throws {
        let record = CookieRecord(Self.parse("sid=S; Path=/; Max-Age=60"))
        let data = try JSONEncoder().encode(record)
        #expect(try JSONDecoder().decode(CookieRecord.self, from: data) == record)
    }

    @Test("expiry is kept in whole seconds, so storage truncation does not break equality")
    func wholeSeconds() {
        let date = Date(timeIntervalSince1970: 1_800_000_000.75)
        let cookie = HTTPCookie(properties: [.name: "a", .value: "1", .domain: "www.example.com", .path: "/", .expires: date])!
        #expect(CookieRecord(cookie).expires == 1_800_000_000)
    }

    @Test("a host-only cookie and a Domain= cookie of the same name are different keys")
    func keys() {
        let hostOnly = CookieKey(Self.parse("sid=1; Path=/"))
        let domain = CookieKey(Self.parse("sid=2; Path=/; Domain=www.example.com"))
        #expect(hostOnly.domain == "www.example.com")
        #expect(domain.domain == ".www.example.com")
        #expect(hostOnly != domain)
    }

    @Test("a session cookie has no expiry, and expiry is checked against a given time")
    func expiry() {
        #expect(CookieRecord(Self.parse("a=1; Path=/")).isSession)
        let record = CookieRecord(Self.parse("a=1; Path=/; Max-Age=60"))
        #expect(!record.hasExpired(at: Date()))
        #expect(record.hasExpired(at: Date().addingTimeInterval(120)))
    }

    @Test("an isolated jar stores, finds, replaces and deletes by key")
    func jar() {
        let jar = StorageCookieJar.isolated()
        let cookie = Self.parse("sid=S; Path=/")
        jar.setCookies([cookie], for: Self.url, mainDocumentURL: nil)
        #expect(jar.cookie(CookieKey(cookie))?.value == "S")
        jar.set(Self.parse("sid=T; Path=/"))
        #expect(jar.cookie(CookieKey(cookie))?.value == "T")
        jar.delete(CookieKey(cookie))
        #expect(jar.cookie(CookieKey(cookie)) == nil)
    }

    @Test("set ignores the accept policy, setCookies does not")
    func policy() {
        let jar = StorageCookieJar.isolated(policy: .never)
        let cookie = Self.parse("sid=S; Path=/")
        jar.setCookies([cookie], for: Self.url, mainDocumentURL: nil)
        #expect(jar.cookie(CookieKey(cookie)) == nil)
        jar.set(cookie)
        #expect(jar.cookie(CookieKey(cookie))?.value == "S")
    }
}
#endif
