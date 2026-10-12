//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
@testable import MapLocalCore
import Testing

/// A clock the tests move by hand.
final class TestNow: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: 1_800_000_000)
    var date: Date { lock.withLock { value } }
    func advance(_ seconds: TimeInterval) { lock.withLock { value += seconds } }
}

@Suite("Cookie keeper")
struct CookieKeeperTests {
    static let url = URL(string: "https://www.example.com/a/b")!

    static func parse(_ header: String, url: URL = url) -> [HTTPCookie] {
        HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: url)
    }

    struct Fixture {
        let jar = StorageCookieJar.isolated()
        let store: MemoryConfigurationStore
        let now = TestNow()
        init(journal: CookieJournalLoad = .loaded(.empty)) { store = MemoryConfigurationStore(journal: journal) }

        func keeper(launch: String = "L1") -> CookieKeeper {
            let now = self.now
            return CookieKeeper(store: store, jar: jar, launchID: launch, now: { now.date })
        }

        func value(_ name: String, domain: String = "www.example.com", path: String = "/") -> String? {
            jar.cookie(CookieKey(domain: domain, path: path, name: name))?.value
        }
    }

    @Test("a mocked cookie on an empty key is journaled with no before")
    func writeNew() throws {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        #expect(f.value("sid") == "M")
        let entry = try #require(keeper.journal.entries.first)
        #expect(entry.before == nil)
        #expect(entry.written.matches(CookieRecord(try #require(f.jar.cookie(entry.key)))))
        #expect(keeper.counts.active == 1)
        #expect(f.store.journal == .loaded(keeper.journal))
    }

    @Test("a mocked cookie over a real one keeps the real one as before")
    func writeOver() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        #expect(try #require(keeper.journal.entries.first).before?.value == "R")
    }

    @Test("a second mocked write keeps the first before")
    func writeTwice() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M1; Path=/"), for: Self.url, mainDocumentURL: nil)
        keeper.write(Self.parse("sid=M2; Path=/"), for: Self.url, mainDocumentURL: nil)
        let entry = try #require(keeper.journal.entries.first)
        #expect(keeper.journal.entries.count == 1)
        #expect(entry.before?.value == "R")
        #expect(entry.written == .stored(CookieRecord(f.jar.cookie(entry.key)!)))
    }

    @Test("a real change between two mocked writes becomes the new before")
    func writeAfterRealChange() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R1; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M1; Path=/"), for: Self.url, mainDocumentURL: nil)
        f.jar.set(Self.parse("sid=R2; Path=/")[0])
        keeper.write(Self.parse("sid=M2; Path=/"), for: Self.url, mainDocumentURL: nil)
        #expect(try #require(keeper.journal.entries.first).before?.value == "R2")
    }

    @Test("a mocked deletion is journaled as deleted")
    func writeDeletion() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=; Path=/; Max-Age=0"), for: Self.url, mainDocumentURL: nil)
        #expect(f.value("sid") == nil)
        let entry = try #require(keeper.journal.entries.first)
        #expect(entry.written == .deleted)
        #expect(entry.before?.value == "R")
    }

    @Test("a write the accept policy refuses is not journaled")
    func writeRefused() {
        let f = Fixture()
        let jar = StorageCookieJar.isolated(policy: .never)
        let now = f.now
        let keeper = CookieKeeper(store: f.store, jar: jar, launchID: "L1", now: { now.date })
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        #expect(keeper.journal.entries.isEmpty)
        #expect(keeper.counts.active == 0)
    }

    @Test("a Set-Cookie without Path makes one key per request path")
    func writeWithoutPathMakesOneKeyPerPath() {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M", url: URL(string: "https://www.example.com/a/x")!), for: URL(string: "https://www.example.com/a/x")!, mainDocumentURL: nil)
        keeper.write(Self.parse("sid=M", url: URL(string: "https://www.example.com/b/y")!), for: URL(string: "https://www.example.com/b/y")!, mainDocumentURL: nil)
        #expect(Set(keeper.journal.entries.map(\.key.path)) == ["/a", "/b"])
    }

    @Test("an unreadable journal keeps writes in memory, never saves, and reports an issue")
    func unreadableJournal() {
        let f = Fixture(journal: .unreadable("locked"))
        let keeper = f.keeper()
        #expect(keeper.issues.map(\.code) == [.cookieJournalUnreadable])
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        #expect(keeper.counts.active == 1)
        #expect(f.store.journal == .unreadable("locked"))
    }

    @Test("a journal that was deleted as invalid reports an issue and starts empty")
    func invalidJournal() {
        let keeper = Fixture(journal: .invalid).keeper()
        #expect(keeper.issues.map(\.code) == [.cookieJournalDeleted])
        #expect(keeper.journal == .empty)
    }

    @Test("the listing gives keys, layers and launches, and no values")
    func listing() throws {
        let f = Fixture()
        let first = f.keeper(launch: "L1")
        first.write(Self.parse("old=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        let second = f.keeper(launch: "L2")
        second.write(Self.parse("new=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        let listing = second.listing()
        #expect(listing.first { $0.key.name == "old" }?.isCurrentLaunch == false)
        #expect(listing.first { $0.key.name == "new" }?.isCurrentLaunch == true)
        #expect(listing.allSatisfy { $0.layer == .active })
    }
}
#endif
