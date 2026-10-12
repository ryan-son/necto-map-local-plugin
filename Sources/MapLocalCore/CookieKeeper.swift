//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import os

/// A journaled key, as `maplocal.cookies.list` reports it. Never carries a value.
public struct CookieListing: Equatable, Sendable {
    public var key: CookieKey
    public var layer: CookieEntry.Layer
    public var isCurrentLaunch: Bool
}

/// Writes mocked cookies, journals them, and brings real ones back.
///
/// One lock covers reading a key, writing it, journaling it and restoring it, so a
/// restore can never fall between a write's read and its store. It is never held together
/// with the engine's state lock.
final class CookieKeeper: Sendable {
    private struct Inner {
        var journal: CookieJournal
        /// The file could not be read, so it is never written and nothing is restored.
        var readOnly: Bool
    }

    private let lock: OSAllocatedUnfairLock<Inner>
    let jar: any CookieJar
    let store: ConfigurationStore
    let launchID: String
    let now: @Sendable () -> Date
    let issues: [MapLocalMessage]
    static let logger = Logger(subsystem: "io.github.ryan-son.maplocal", category: "cookies")

    init(store: ConfigurationStore, jar: any CookieJar, launchID: String, now: @escaping @Sendable () -> Date) {
        self.store = store
        self.jar = jar
        self.launchID = launchID
        self.now = now
        switch store.loadCookieJournal() {
        case let .loaded(journal):
            lock = OSAllocatedUnfairLock(initialState: Inner(journal: journal, readOnly: false))
            issues = []
        case let .unreadable(error):
            lock = OSAllocatedUnfairLock(initialState: Inner(journal: .empty, readOnly: true))
            issues = [MapLocalMessage(.cookieJournalUnreadable, ["error": error])]
        case .invalid:
            lock = OSAllocatedUnfairLock(initialState: Inner(journal: .empty, readOnly: false))
            issues = [MapLocalMessage(.cookieJournalDeleted)]
            Self.logger.error("The cookie journal was not valid and was deleted")
        }
    }

    var journal: CookieJournal { lock.withLock { $0.journal } }

    var counts: (active: Int, setAside: Int) {
        lock.withLock { inner in
            let active = inner.journal.entries.filter { $0.layer == .active }.count
            return (active, inner.journal.entries.count - active)
        }
    }

    func listing() -> [CookieListing] {
        lock.withLock { inner in
            inner.journal.entries.map {
                CookieListing(key: $0.key, layer: $0.layer, isCurrentLaunch: $0.launchID == launchID)
            }
        }
    }

    func stored(_ key: CookieKey) -> CookieRecord? { jar.cookie(key).map(CookieRecord.init) }

    /// Writes a mocked response's cookies and journals what storage holds afterwards.
    ///
    /// The entry is saved before the write, so a crash leaves an entry and never an
    /// untracked mocked cookie. A failed save is logged and the journal stays in memory.
    func write(_ cookies: [HTTPCookie], for url: URL, mainDocumentURL: URL?) {
        lock.withLock { inner in
            for cookie in cookies {
                let key = CookieKey(cookie)
                let before = stored(key)
                let index = inner.journal.entries.firstIndex { $0.key == key }
                let previous = index.map { inner.journal.entries[$0] }
                // Keep the real value from before the first mock, unless something real
                // changed the cookie since the last mock: then that newer value is the real one.
                let keepsBefore = previous.map { $0.layer == .active && $0.written.matches(before) } ?? false
                var entry = CookieEntry(
                    key: key,
                    before: keepsBefore ? previous!.before : before,
                    beforeLaunchID: keepsBefore ? previous!.beforeLaunchID : launchID,
                    written: before.map(CookieWrite.stored) ?? .deleted,
                    launchID: launchID
                )
                if keepsBefore { entry.written = previous!.written }
                Self.put(entry, at: index, in: &inner.journal)
                inner.journal.pending.removeAll { $0.key == key }
                save(inner)
                jar.setCookies([cookie], for: url, mainDocumentURL: mainDocumentURL)
                let after = stored(key)
                if after == before {
                    // The policy refused it, or it changed nothing: no write to undo.
                    if previous == nil { inner.journal.entries.removeAll { $0.key == key } }
                    else if let index { inner.journal.entries[index] = previous! }
                } else {
                    entry.written = after.map(CookieWrite.stored) ?? .deleted
                    entry.launchID = launchID
                    Self.put(entry, at: inner.journal.entries.firstIndex { $0.key == key }, in: &inner.journal)
                    Self.logger.info("Journaled a mocked cookie \(key.name, privacy: .private) for \(key.domain, privacy: .private)")
                }
                save(inner)
            }
        }
    }

    private static func put(_ entry: CookieEntry, at index: Int?, in journal: inout CookieJournal) {
        if let index { journal.entries[index] = entry } else { journal.entries.append(entry) }
    }

    /// Saves unless read-only. Used where a failure must not stop the app's request.
    private func save(_ inner: Inner) {
        guard !inner.readOnly else { return }
        do {
            try store.saveCookieJournal(inner.journal)
        } catch {
            Self.logger.error("Couldn't save the cookie journal: \(error.localizedDescription, privacy: .public)")
        }
    }
}
#endif
