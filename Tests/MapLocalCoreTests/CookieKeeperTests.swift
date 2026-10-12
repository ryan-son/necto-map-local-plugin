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
    /// Starts at the real time, because `Max-Age` is counted from it.
    private var value = Date()
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

    @Test("discarding a created cookie deletes it")
    func discardCreated() throws {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        let change = try keeper.discard(scope: .all)
        #expect(f.value("sid") == nil)
        #expect(change.count(.deleted) == 1)
        #expect(keeper.journal.entries.isEmpty)
    }

    @Test("discarding an overwritten cookie restores the real one")
    func discardOverwritten() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=3600; HttpOnly")[0])
        let keeper = f.keeper()
        // Storage refuses to replace an HttpOnly cookie with one that is not (measured).
        keeper.write(Self.parse("sid=M; Path=/; HttpOnly"), for: Self.url, mainDocumentURL: nil)
        let change = try keeper.discard(scope: .all)
        #expect(f.value("sid") == "R")
        #expect(f.jar.cookie(CookieKey(domain: "www.example.com", path: "/", name: "sid"))?.isHTTPOnly == true)
        #expect(change.count(.restored) == 1)
    }

    @Test("discarding after a mocked deletion brings the real cookie back")
    func discardRestoresAfterMockedDeletion() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=; Path=/; Max-Age=0"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.discard(scope: .all)
        #expect(f.value("sid") == "R")
    }

    @Test("a cookie something else rewrote is left and skipped")
    func discardSkipsRewritten() throws {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        f.jar.set(Self.parse("sid=R2; Path=/")[0])
        let change = try keeper.discard(scope: .all)
        #expect(f.value("sid") == "R2")
        #expect(change.count(.skipped) == 1)
    }

    @Test("a cookie something else deleted is left gone")
    func discardLeavesDeleted() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/; Max-Age=3600"), for: Self.url, mainDocumentURL: nil)
        f.jar.delete(CookieKey(domain: "www.example.com", path: "/", name: "sid"))
        let change = try keeper.discard(scope: .all)
        #expect(f.value("sid") == nil)
        #expect(change.count(.gone) == 1)
    }

    @Test("a mocked cookie that expired by itself brings the real one back")
    func discardAfterMockExpired() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=86400")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/; Max-Age=60"), for: Self.url, mainDocumentURL: nil)
        f.jar.delete(CookieKey(domain: "www.example.com", path: "/", name: "sid")) // storage purged it
        f.now.advance(120)
        _ = try keeper.discard(scope: .all)
        #expect(f.value("sid") == "R")
    }

    @Test("an expired before is not resurrected")
    func discardSkipsExpiredBefore() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=60")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        f.now.advance(120)
        _ = try keeper.discard(scope: .all)
        #expect(f.value("sid") == nil)
    }

    @Test("a real cookie with the same name on another domain or path is untouched")
    func discardLeavesOtherKeys() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=OTHER; Path=/other")[0])
        f.jar.set(Self.parse("sid=DOMAIN; Path=/; Domain=example.com")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.discard(scope: .all)
        #expect(f.value("sid", path: "/other") == "OTHER")
        #expect(f.value("sid", domain: ".example.com") == "DOMAIN")
    }

    @Test("earlierLaunches discards only entries written in earlier launches")
    func discardEarlierLaunches() throws {
        let f = Fixture()
        f.keeper(launch: "L1").write(Self.parse("old=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        let keeper = f.keeper(launch: "L2")
        keeper.write(Self.parse("new=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.discard(scope: .earlierLaunches)
        #expect(f.value("old") == nil)
        #expect(f.value("new") == "M")
        #expect(keeper.journal.entries.map(\.key.name) == ["new"])
    }

    @Test("restored entries go on the pending list")
    func discardFillsPending() throws {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.discard(scope: .all)
        #expect(keeper.journal.pending.map(\.key.name) == ["sid"])
    }

    @Test("a failed save throws with the counts and leaves the journal as it was on disk")
    func discardKeepsJournalWhenSaveFails() throws {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        let onDisk = f.store.journal
        f.store.failSavingJournal()
        #expect {
            try keeper.discard(scope: .all)
        } throws: { error in
            (error as? CookieSaveFailure)?.change.count(.deleted) == 1
        }
        #expect(.loaded(keeper.journal) == onDisk)
    }

    @Test("an unreadable journal refuses a discard")
    func discardReadOnly() {
        let keeper = Fixture(journal: .unreadable("locked")).keeper()
        #expect(throws: MapLocalMessage.self) { try keeper.discard(scope: .all) }
    }

    @Test("off then on with nothing in between returns the same mocked cookie")
    func offOnRoundTrip() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.setAside(trigger: .turnedOff)
        #expect(f.value("sid") == "R")
        #expect(keeper.counts == (0, 1))
        let change = try keeper.putBack(trigger: .turnedOn)
        #expect(f.value("sid") == "M")
        #expect(keeper.counts == (1, 0))
        #expect(change.count(.reapplied) == 1)
    }

    @Test("a real change while off drops the set-aside entry and keeps the real value")
    func putBackDropsWhenRealChangedWhileOff() throws {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.setAside(trigger: .turnedOff)
        f.jar.set(Self.parse("sid=REAL; Path=/")[0])
        let change = try keeper.putBack(trigger: .turnedOn)
        #expect(f.value("sid") == "REAL")
        #expect(change.count(.dropped) == 1)
        #expect(keeper.journal.entries.isEmpty)
    }

    @Test("a mocked cookie that expired while off is not put back")
    func putBackDropsExpired() throws {
        let f = Fixture()
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/; Max-Age=60"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.setAside(trigger: .turnedOff)
        f.now.advance(120)
        _ = try keeper.putBack(trigger: .turnedOn)
        #expect(f.value("sid") == nil)
        #expect(keeper.journal.entries.isEmpty)
    }

    @Test("a set-aside mocked deletion deletes again when turned on")
    func putBackReappliesDeletion() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=; Path=/; Max-Age=0"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.setAside(trigger: .turnedOff)
        #expect(f.value("sid") == "R")
        _ = try keeper.putBack(trigger: .turnedOn)
        #expect(f.value("sid") == nil)
    }

    @Test("a discard drops set-aside entries without touching storage")
    func discardDropsSetAside() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        _ = try keeper.setAside(trigger: .turnedOff)
        let change = try keeper.discard(scope: .all)
        #expect(f.value("sid") == "R")
        #expect(change.count(.dropped) == 1)
        #expect(keeper.journal.entries.isEmpty)
    }

    @Test("a launch with Map Local off sets active entries aside")
    func launchOffSetsAside() throws {
        let f = Fixture()
        f.keeper(launch: "L1").write(Self.parse("sid=M; Path=/; Max-Age=3600"), for: Self.url, mainDocumentURL: nil)
        let keeper = f.keeper(launch: "L2")
        _ = try keeper.reconcileAtLaunch(enabled: false)
        #expect(f.value("sid") == nil)
        #expect(keeper.counts == (0, 1))
    }

    @Test("a launch with Map Local on puts set-aside entries back")
    func launchOnPutsBack() throws {
        let f = Fixture()
        let first = f.keeper(launch: "L1")
        first.write(Self.parse("sid=M; Path=/; Max-Age=3600"), for: Self.url, mainDocumentURL: nil)
        _ = try first.setAside(trigger: .turnedOff)
        let keeper = f.keeper(launch: "L2")
        _ = try keeper.reconcileAtLaunch(enabled: true)
        #expect(f.value("sid") == "M")
        #expect(keeper.counts == (1, 0))
    }

    @Test("a mocked session cookie gone with the last launch brings the real cookie back at launch")
    func launchResolvesDeadSessionCookie() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=3600")[0])
        f.keeper(launch: "L1").write(Self.parse("sid=M; Path=/"), for: Self.url, mainDocumentURL: nil)
        f.jar.delete(CookieKey(domain: "www.example.com", path: "/", name: "sid")) // the session ended
        let keeper = f.keeper(launch: "L2")
        _ = try keeper.reconcileAtLaunch(enabled: true)
        #expect(f.value("sid") == "R")
        #expect(keeper.journal.entries.isEmpty)
    }

    @Test("the pending check restores again when a kill undid a restore")
    func pendingRestoresAgain() throws {
        let f = Fixture()
        let first = f.keeper(launch: "L1")
        first.write(Self.parse("sid=M; Path=/; Max-Age=3600"), for: Self.url, mainDocumentURL: nil)
        let entry = try #require(first.journal.entries.first)
        _ = try first.discard(scope: .all)
        // A kill lost the delete before storage saved it.
        f.jar.set(try #require(Self.record(entry.written)?.cookie))
        let keeper = f.keeper(launch: "L2")
        _ = try keeper.reconcileAtLaunch(enabled: true)
        #expect(f.value("sid") == nil)
        #expect(keeper.journal.pending.isEmpty)
    }

    @Test("the pending check leaves a key that was put back")
    func pendingCheckSkipsKeysPutBack() throws {
        let f = Fixture()
        let first = f.keeper(launch: "L1")
        first.write(Self.parse("sid=M; Path=/; Max-Age=3600"), for: Self.url, mainDocumentURL: nil)
        _ = try first.setAside(trigger: .turnedOff)
        _ = try first.putBack(trigger: .turnedOn)
        let keeper = f.keeper(launch: "L2")
        _ = try keeper.reconcileAtLaunch(enabled: true)
        #expect(f.value("sid") == "M")
    }

    static func record(_ write: CookieWrite) -> CookieRecord? {
        if case let .stored(record) = write { record } else { nil }
    }

    @Test("a mocked write a kill lost, leaving the real cookie, is set aside at launch and comes back when on")
    func lostWriteCountsAsRestored() throws {
        let f = Fixture()
        // One R, built once: parsing Max-Age twice can straddle a second and differ.
        let real = Self.parse("sid=R; Path=/; Max-Age=86400")[0]
        f.jar.set(real)
        f.keeper(launch: "L1").write(Self.parse("sid=M; Path=/; Max-Age=3600"), for: Self.url, mainDocumentURL: nil)
        // The kill lost the write before storage saved it: the relaunched storage holds R again.
        f.jar.set(real)
        let keeper = f.keeper(launch: "L2")
        let change = try keeper.reconcileAtLaunch(enabled: false)
        #expect(change.count(.skipped) == 0)
        #expect(keeper.counts == (0, 1))
        _ = try keeper.putBack(trigger: .turnedOn)
        #expect(f.value("sid") == "M")
    }

    // MARK: Final review findings

    @Test("an HttpOnly mock over a plain real cookie is undone, off and on and discard alike")
    func httpOnlyMockIsUndone() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=3600")[0])
        let keeper = f.keeper()
        keeper.write(Self.parse("sid=M; Path=/; HttpOnly"), for: Self.url, mainDocumentURL: nil)
        #expect(f.value("sid") == "M")
        _ = try keeper.setAside(trigger: .turnedOff)
        #expect(f.value("sid") == "R")
        _ = try keeper.putBack(trigger: .turnedOn)
        #expect(f.value("sid") == "M")
        _ = try keeper.discard(scope: .all)
        #expect(f.value("sid") == "R")
    }

    @Test("an identical mocked write in a new launch belongs to that launch")
    func identicalRewriteTakesTheNewLaunch() throws {
        let f = Fixture()
        let header = "sid=M; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT"
        f.keeper(launch: "L1").write(Self.parse(header), for: Self.url, mainDocumentURL: nil)
        let keeper = f.keeper(launch: "L2")
        _ = try keeper.reconcileAtLaunch(enabled: true)
        keeper.write(Self.parse(header), for: Self.url, mainDocumentURL: nil)
        #expect(keeper.listing().first?.isCurrentLaunch == true)
        _ = try keeper.discard(scope: .earlierLaunches)
        #expect(f.value("sid") == "M")
    }

    @Test("the pending check does not revive a real cookie the user logged out of after a mocked logout was undone")
    func pendingDoesNotReviveAfterRealLogout() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=86400")[0])
        let first = f.keeper(launch: "L1")
        first.write(Self.parse("sid=; Path=/; Max-Age=0"), for: Self.url, mainDocumentURL: nil)
        _ = try first.discard(scope: .all)
        #expect(f.value("sid") == "R")
        f.jar.delete(CookieKey(domain: "www.example.com", path: "/", name: "sid")) // a real logout
        _ = try f.keeper(launch: "L2").reconcileAtLaunch(enabled: true)
        #expect(f.value("sid") == nil)
    }

    @Test("an entry dropped by on leaves nothing for the pending check to undo")
    func droppedPutBackClearsPending() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=86400")[0])
        let first = f.keeper(launch: "L1")
        first.write(Self.parse("sid=M; Path=/; Max-Age=3600"), for: Self.url, mainDocumentURL: nil)
        _ = try first.setAside(trigger: .turnedOff)
        f.jar.set(Self.parse("sid=M; Path=/; Max-Age=3600")[0]) // the real server happens to send M while off
        _ = try first.putBack(trigger: .turnedOn)               // storage changed while off: dropped
        #expect(first.journal.pending.isEmpty)
    }

    @Test("a crash between the write and its second save still lets a discard bring the real cookie back")
    func inFlightWriteIsRestored() throws {
        let f = Fixture()
        f.jar.set(Self.parse("sid=R; Path=/; Max-Age=86400")[0])
        let before = CookieRecord(try #require(f.jar.cookie(CookieKey(domain: "www.example.com", path: "/", name: "sid"))))
        // The journal as the first save leaves it, then the mock lands, then the process dies.
        let entry = CookieEntry(
            key: before.key, before: before, beforeLaunchID: "L1", written: .stored(before), launchID: "L1", inFlight: true
        )
        try f.store.saveCookieJournal(CookieJournal(entries: [entry]))
        f.jar.set(Self.parse("sid=M; Path=/; Max-Age=3600")[0])
        let keeper = f.keeper(launch: "L2")
        _ = try keeper.discard(scope: .all)
        #expect(f.value("sid") == "R")
    }

    @Test("turning on and off from many threads leaves cookies matching the final switch", arguments: 0..<20)
    func toggleStorm(seed: Int) throws {
        let jar = StorageCookieJar.isolated()
        let engine = MapLocalEngine(store: MemoryConfigurationStore(), blockedHosts: [], cookieJar: jar)
        let url = URL(string: "https://maplocal.invalid/a")!
        engine.writeMockedCookies(HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "sid=M; Path=/"], for: url), for: url, mainDocumentURL: nil)
        DispatchQueue.concurrentPerform(iterations: 64) { i in
            _ = try? engine.applyForcing(.patch(enabled: i.isMultiple(of: 2), allowedHosts: nil, unmatched: nil, order: nil))
        }
        let value = jar.cookie(CookieKey(domain: "maplocal.invalid", path: "/", name: "sid"))?.value
        if engine.state.configuration.enabled { #expect(value == "M") } else { #expect(value == nil) }
    }
}
#endif
