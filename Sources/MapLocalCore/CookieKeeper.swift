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

/// Which entries a discard takes.
public enum CookieScope: String, Sendable, CaseIterable {
    case all
    /// Only entries written in an earlier launch, so an agent can clear what earlier runs
    /// left without touching this launch's pre-attach mocks.
    case earlierLaunches
}

public enum CookieTrigger: String, Sendable {
    case explicit, turnedOff, turnedOn, launch
}

public struct CookieEntryResult: Equatable, Sendable {
    public enum Action: String, Sendable {
        /// The mock created the cookie, and it was deleted.
        case deleted
        /// The real cookie was put back.
        case restored
        /// Something else rewrote the cookie, so it was left.
        case skipped
        /// Something else deleted the cookie, so it was left.
        case gone
        /// A set-aside mocked cookie was put back.
        case reapplied
        /// The entry was dropped without touching storage.
        case dropped
    }

    public var key: CookieKey
    public var action: Action
}

/// What one restore, set-aside or put-back did.
public struct CookieChange: Equatable, Sendable {
    public var trigger: CookieTrigger
    public var date: Date
    public var results: [CookieEntryResult]

    public func count(_ action: CookieEntryResult.Action) -> Int {
        results.filter { $0.action == action }.count
    }
}

/// Storage changed but the journal could not be saved. The journal in memory still
/// matches the file, so the next launch does not undo a cleanup the caller was told of.
public struct CookieSaveFailure: Error, Sendable {
    public var change: CookieChange
    public var error: String
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

    /// Whether `record`, read in launch `launch`, could still exist now.
    func isAlive(_ record: CookieRecord, readIn launch: String) -> Bool {
        !record.hasExpired(at: now()) && !(record.isSession && launch != launchID)
    }

    /// Whether the mock's own cookie is gone by its own nature: expired, or a session
    /// cookie of an earlier launch.
    func goneByItself(_ entry: CookieEntry) -> Bool {
        guard case let .stored(record) = entry.written else { return false }
        return !isAlive(record, readIn: entry.launchID)
    }

    /// Puts the real cookie back, or deletes the key when there was none.
    private func putBefore(_ entry: CookieEntry) {
        if let before = entry.before {
            if isAlive(before, readIn: entry.beforeLaunchID), let cookie = before.cookie {
                jar.set(cookie)
            } else {
                jar.delete(entry.key)
            }
        } else {
            jar.delete(entry.key)
        }
    }

    /// The restore table in the spec, for one entry.
    func restore(_ entry: CookieEntry) -> CookieEntryResult.Action {
        let current = stored(entry.key)
        if entry.written.matches(current) {
            putBefore(entry)
            return entry.before == nil ? .deleted : .restored
        }
        if current == nil {
            guard goneByItself(entry) else { return .gone }
            putBefore(entry)
            return .restored
        }
        return .skipped
    }

    /// Runs `body` on the journal and saves it. Storage changes first and the journal is
    /// saved after. If the save fails the journal in memory goes back to what is on disk.
    private func change(
        _ trigger: CookieTrigger,
        _ body: (inout CookieJournal) -> [CookieEntryResult]
    ) throws -> CookieChange {
        // `body` runs synchronously inside the lock and never escapes, so it need not be
        // `Sendable`.
        try lock.withLockUnchecked { inner in
            guard !inner.readOnly else {
                throw MapLocalMessage(.cookieJournalUnreadable, ["error": "read-only"])
            }
            var journal = inner.journal
            let change = CookieChange(trigger: trigger, date: now(), results: body(&journal))
            do {
                try store.saveCookieJournal(journal)
            } catch {
                throw CookieSaveFailure(change: change, error: error.localizedDescription)
            }
            inner.journal = journal
            Self.logger.info("""
                Cookies \(trigger.rawValue, privacy: .public): \
                deleted \(change.count(.deleted)), restored \(change.count(.restored)), \
                skipped \(change.count(.skipped)), gone \(change.count(.gone)), \
                reapplied \(change.count(.reapplied)), dropped \(change.count(.dropped))
                """)
            return change
        }
    }

    /// The explicit restore: every active entry in `scope` is restored and every entry in
    /// it is dropped, set aside or not.
    func discard(scope: CookieScope) throws -> CookieChange {
        try change(.explicit) { journal in
            var results: [CookieEntryResult] = []
            var kept: [CookieEntry] = []
            for entry in journal.entries {
                if scope == .earlierLaunches, entry.launchID == launchID {
                    kept.append(entry)
                    continue
                }
                if entry.layer == .setAside {
                    results.append(CookieEntryResult(key: entry.key, action: .dropped))
                    continue
                }
                let action = restore(entry)
                if action == .deleted || action == .restored { journal.pending.append(entry) }
                results.append(CookieEntryResult(key: entry.key, action: action))
            }
            journal.entries = kept
            return results
        }
    }

    private func setAside(_ journal: inout CookieJournal) -> [CookieEntryResult] {
        var results: [CookieEntryResult] = []
        var kept: [CookieEntry] = []
        for var entry in journal.entries {
            guard entry.layer == .active else {
                kept.append(entry)
                continue
            }
            let action = restore(entry)
            results.append(CookieEntryResult(key: entry.key, action: action))
            guard action == .deleted || action == .restored, !goneByItself(entry) else { continue }
            journal.pending.append(entry)
            entry.layer = .setAside
            entry.restoredTo = stored(entry.key)
            kept.append(entry)
        }
        journal.entries = kept
        return results
    }

    private func putBack(_ journal: inout CookieJournal) -> [CookieEntryResult] {
        var results: [CookieEntryResult] = []
        var kept: [CookieEntry] = []
        for var entry in journal.entries {
            guard entry.layer == .setAside else {
                kept.append(entry)
                continue
            }
            let unchanged = stored(entry.key) == entry.restoredTo
            guard unchanged, !goneByItself(entry) else {
                results.append(CookieEntryResult(key: entry.key, action: .dropped))
                continue
            }
            switch entry.written {
            case let .stored(record):
                guard let cookie = record.cookie else {
                    results.append(CookieEntryResult(key: entry.key, action: .dropped))
                    continue
                }
                jar.set(cookie)
            case .deleted:
                jar.delete(entry.key)
            }
            journal.pending.removeAll { $0.key == entry.key }
            entry.layer = .active
            entry.restoredTo = nil
            kept.append(entry)
            results.append(CookieEntryResult(key: entry.key, action: .reapplied))
        }
        journal.entries = kept
        return results
    }

    func setAside(trigger: CookieTrigger) throws -> CookieChange {
        try change(trigger) { setAside(&$0) }
    }

    func putBack(trigger: CookieTrigger) throws -> CookieChange {
        try change(trigger) { putBack(&$0) }
    }

    /// Matches the cookies to the switch: off sets aside, on puts back. Idempotent, so the
    /// engine can call it after any write that may have flipped `enabled`.
    func sync(enabled: Bool, trigger: CookieTrigger) throws -> CookieChange {
        enabled ? try putBack(trigger: trigger) : try setAside(trigger: trigger)
    }

    /// Runs once per launch, before the first request after the plugin is created.
    func reconcileAtLaunch(enabled: Bool) throws -> CookieChange {
        try change(.launch) { journal in
            var results: [CookieEntryResult] = []
            // Restores a kill may have lost, unless the key is in use by a mock again.
            let active = Set(journal.entries.filter { $0.layer == .active }.map(\.key))
            for entry in journal.pending where !active.contains(entry.key) && entry.written.matches(stored(entry.key)) {
                putBefore(entry)
                results.append(CookieEntryResult(key: entry.key, action: .restored))
            }
            journal.pending = []
            // Mock cookies that went away by themselves no longer count.
            journal.entries = journal.entries.filter { entry in
                guard entry.layer == .active, stored(entry.key) == nil, goneByItself(entry) else { return true }
                putBefore(entry)
                results.append(CookieEntryResult(key: entry.key, action: .restored))
                return false
            }
            results += enabled ? putBack(&journal) : setAside(&journal)
            return results
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
