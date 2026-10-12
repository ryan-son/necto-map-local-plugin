# Mocked Cookie Journal — Design

Status: draft, revised after an adversarial review (see [Review log](#review-log)).
Branch `feature/mocked-cookie-journal`, based on `feature/ios-16-support`.

## Purpose

A mocked response's `Set-Cookie` goes into `HTTPCookieStorage.shared` and stays there
after Map Local is turned off, so real requests can carry a mocked cookie
([usage.md, Known limitations](../../usage.md#known-limitations)). Map Local must be able
to undo exactly what its mocks wrote to that storage, and nothing else.

This is the first piece of a larger goal: an agent runs QA on its own, driving everything
Map Local offers through `necto-cli`. Each scenario has to start clean and prove that it
ended clean, so every part of this design is reachable from the CLI and observable from
`maplocal.state`. A short playbook for agents and the pre-connection path are a later
sub-project.

Requested by the Aptner iOS app (minimum iOS 16). Turning off cookie writes altogether is
not acceptable: mocks that run before Necto attaches rely on their cookies.

## Success criteria

After a restore:

1. a cookie that a mock created, and that nothing has changed since, is gone;
2. a cookie that a mock overwrote or deleted has its last real value back, unless that
   value has expired or was a session cookie of an earlier launch;
3. a cookie that something else rewrote or deleted after the mock keeps that state;
4. no cookie that Map Local did not write is deleted or changed, even one with the same
   name on another domain or path;
5. a journal survives a relaunch, and a launch with Map Local off sets mocked cookies
   aside before the first request made after the plugin is created;

and across a switch:

6. turning Map Local off and on again, with nothing else touching those cookies in
   between, leaves the same mocked cookies in storage as before it was turned off.

## Scope

- In: `HTTPCookieStorage.shared`, the only storage Map Local writes to. The journal, the
  restore triggers, a new operation, two new state fields, a panel notice, a Swift API,
  and `os_log` output for cookies. The per-request `rules` log (request item 5) is a
  separate, later change.
- Out: a session's own cookie storage, `WKWebsiteDataStore`, the keychain, and any other
  place a mocked sign-in can leave state. Restoring cookies does not clear the
  mocked-session warning. A clean end state for an agent is therefore
  `mockedCookies == 0` and `authMocked == false` in `maplocal.state`, plus whatever the
  app keeps itself. `authMocked` already exists: it turns true when a rule tagged `auth`
  answers, survives a relaunch, and is cleared only by `maplocal.configuration.patch
  {"authMocked": false}` after logging out in the app ([usage.md, Auth
  rule](../../usage.md#auth-rule)).
- Known limit, documented in usage.md: inside the URL protocol a session's own opt-outs
  are invisible. A session with `httpShouldSetCookies = false`, a `.never` accept policy
  or its own or an ephemeral storage still gets the mocked cookie written to the shared
  storage (measured on macOS 27: `request.httpShouldHandleCookies` stays `true` and
  `mainDocumentURL` is nil). The journal covers those writes like any other.

## Approach

Chosen: a `CookieJournal` owned by the engine in `MapLocalCore`. The engine performs every
mocked cookie write itself, through an injected `CookieJar` protocol, and the URL protocol
hands it the parsed cookies instead of calling `HTTPCookieStorage`.

- The triggers that restore already pass through the engine, and the engine already
  publishes state to the panel and the CLI.
- Owning the write lets one lock cover read, write, journal and restore, so a restore
  cannot fall between a write's read and its store.
- An injected `CookieJar` lets tests and every engine built in a test use an in-memory
  jar. Only the plugin's real engine gets the shared storage.

Rejected:

- A journal inside the URL protocol layer alone. The triggers and the state live in the
  engine, so two layers would each hold part of the truth.
- A snapshot of the whole storage at the first mock, diffed at restore. Real cookies from
  other hosts that changed in between would be caught in the diff.

Verified on macOS 27 before writing this: URLSession stores nothing itself from a custom
protocol's `Set-Cookie` (shared, separate and ephemeral storages alike), so the plugin's
write is the only one to journal; and `HTTPCookie(properties:)` keeps HttpOnly,
SameSite, Secure, expiry, Comment and Port.

## Section 1: The journal

### Key

`(domain, path, name)`, the identity `HTTPCookieStorage` uses to replace a cookie, taken
from the cookie as stored. Measured: a host-only cookie keeps the bare host
(`www.example.com`), `Domain=` cookies get a leading dot, domains are lowercased, and a
host-only and a `Domain=` cookie of the same name sit side by side. A `Set-Cookie`
without `Path=` takes its path from the request URL, so one rule hit on several URLs can
make several keys.

### Cookie record

The journal stores a `Codable` `CookieRecord`, never the raw `properties` dictionary,
which holds `Date`, `NSNumber` and array values that `JSONSerialization` rejects
(measured: it throws):

`name`, `value`, `domain`, `path`, `expires` (whole epoch seconds, or nil for a session
cookie), `secure`, `httpOnly`, `sameSite` (string or nil), `comment`, `commentURL`,
`ports` (`[Int]`), `version`. `Created` is left out. A test checks that a record rebuilds
an equal cookie through `HTTPCookie(properties:)`.

Two records are *equal* when every field matches, with `expires` compared in whole
seconds. Storage truncates expiry to whole seconds (measured).

### Entry

One entry per key:

| Field | Holds |
|---|---|
| `before` | The record that was in storage before the mock took the key, or nothing |
| `written` | What the last mocked write left in storage, read back after the write: a record, or *deleted* when the mock removed the cookie |
| `launchID` | The launch of the last mocked write |
| `beforeLaunchID` | The launch in which `before` was read |
| `state` | *active* (the mock's cookie is in storage) or *set aside* (Map Local is off, and the real value is back) |
| `restoredTo` | For a set-aside entry, what storage held right after it was set aside: `before`, or nothing |

### Writing

`engine.writeMockedCookies(_:for:mainDocumentURL:)`, under the journal lock, for each
parsed cookie:

1. Read the stored cookie under the key, `S0`.
2. Choose `before`: if an entry exists and `S0` equals its `written`, keep the entry's
   `before`. Otherwise take `S0`. Something real changed the cookie since the last mock,
   and its newer value is the one to bring back. A stale `before` is never restored over
   a newer real value.
3. Save the entry with the old `written` (or none) to the journal file. A crash after this
   point leaves an entry, never an untracked cookie.
4. Store the cookie with `setCookies(_:for:mainDocumentURL:)`, which applies the accept
   policy as today.
5. Read the key back. A cookie now stored becomes `written`. Nothing stored, from a
   cookie whose expiry is already past, becomes *deleted*. If storage still holds `S0`
   because the policy refused the write, nothing was written: a new entry is removed, and
   an existing one stays as it was. Save the journal again.

### Restore

Under the journal lock, for each entry, with `S` the cookie stored under the key now:

| `S` | Action |
|---|---|
| Equal to `written` | Put `before` back, or delete the cookie if there is no `before` |
| Nothing, and the mock's cookie is gone by itself: `written` is *deleted*, or expired, or a session cookie from an earlier launch | Put `before` back |
| Nothing, and the mock's cookie should still be there | Something deleted it, such as a logout. Leave it |
| Differs from `written` | Something rewrote it. Leave it |

"Put `before` back" uses `setCookie(_:)`, which ignores the accept policy (measured), so a
strict policy cannot block a restore. It is skipped when `before` has expired, or is a
session cookie read in an earlier launch, because that cookie would be gone by now.

A restore changes storage first and saves the journal after. A crash in between leaves
entries whose stored value no longer equals `written`, and a later restore leaves those.
A cookie that something else set to exactly what the mock wrote, every field included,
is indistinguishable from the mock and is restored.

Restored entries move to a short *pending* list that the next launch checks again. If a
kill lost the restore before `HTTPCookieStorage` flushed it, the stored cookie equals
`written` again and is restored again. The pending list is then cleared.

### Off and on

Map Local treats its cookies as part of the layer it puts over the app: off takes them
away, and on puts them back.

- **Off** runs the restore above on every active entry. An entry that was restored, or
  whose mock cookie was deleted by a mock, becomes *set aside*, with `restoredTo`. An
  entry left alone because something else changed it is dropped, and so is one whose
  mock cookie expired or was a session cookie of an earlier launch: neither can come
  back.
- **On** looks at each set-aside entry. If storage under the key still equals
  `restoredTo`, and `written` has not expired and is not a session cookie of an earlier
  launch, it writes `written` back (or deletes the cookie, for a *deleted* entry) with
  `setCookie(_:)` and makes the entry active again. Otherwise something real changed the
  cookie while Map Local was off, or the mock cookie is no longer valid, and the entry is
  dropped, leaving the real value.
- **Discard**, the explicit restore, restores every active entry and drops every entry,
  set aside or not. The journal is then empty. This is how a person who is done with
  mocks, or an agent at the end of a scenario, cleans up for good.

So turning off and on again needs neither an undo nor a question (experience.md
principle 4), and while Map Local is off the app's requests carry only real cookies
(principle 10).

### Launch

The engine's `init` reconciles the journal on every launch, whether Map Local is on or
off:

- it checks the pending list as above;
- it resolves each entry whose mock cookie is gone by itself, using the second row of
  the table, so a session cookie that died with the last launch no longer counts.

If Map Local is off, it then sets every active entry aside, as turning it off does. If it
is on, it puts set-aside entries back, as turning it on does. An unreadable, corrupt or
too-new configuration loads as `.empty`, whose `enabled` is true.

### Storage

- `Application Support/NectoMapLocal/cookie-journal.json`, beside `configuration.json`.
  It is written atomically with the same file protection, and excluded from backups.
- `ConfigurationStore` gains `loadCookieJournal()` and `saveCookieJournal(_:)`. Every
  test engine gets an in-memory store and jar.
- A journal that **cannot be read**, for example before first unlock, opens read-only, as
  the configuration does. Map Local keeps writing mocked cookies and journals them in
  memory only, does not restore, and reports an issue in state. It never overwrites the
  file.
- A journal that **is not valid** is deleted and logged, and the engine starts with an
  empty journal and an issue. It is not kept aside, because it holds real session
  cookies.
- The journal is never part of an export, a request event, a log line or a panel view.

## Section 2: Triggers, interface and logs

### Triggers

| Trigger | Where | Does |
|---|---|---|
| Explicit | The CLI operation, the panel button, the Swift API | Discard. Works whether Map Local is on or off, and even when the configuration is read-only |
| Map Local turned off | Any engine write that moves `enabled` from true to false: `patch`, `replace` with or without `force`, the badge | Off. All take the one private `apply`. A write that keeps `enabled` true changes no cookie, even when it removes a rule or a host |
| Map Local turned on | Any engine write that moves `enabled` from false to true | On |
| Launch | The engine's `init`, as in [Launch](#launch) | Off or on, matching the loaded switch |

A restore triggered by a configuration write runs after that write has saved and
broadcast, under the journal lock and never under the state lock. Its failure never fails
the write. It becomes an issue in state and a log line.

The existing confirmation before turning Map Local off while a mocked session may remain
also says that mocked cookies are set aside until Map Local is on again.

A response delayed past the moment Map Local was turned off still writes its cookie, and
that cookie is journaled as active. The panel notice shows it, and the next launch with
Map Local off, or a discard, sets it aside or removes it.

### Operation `maplocal.cookies.restore`

- Binding `necto.device.maplocal.cookies.restore`, version 1. Kind `once`. It is handled
  before `change(for:)`, because it does not change the configuration.
- Input: optional `scope`, either `"all"` (the default) or `"earlierLaunches"`. The latter
  discards only entries whose `launchID` is not the current launch. Entries put back on
  at launch keep their original `launchID`, so they count as earlier. An agent uses it right
  after Necto attaches to clear what earlier runs left, without touching what this
  launch's pre-attach mocks wrote. No `baseRevision`: the operation writes no
  configuration, and calling it twice leaves the same storage.
- Output:

  ```json
  {"ok": true, "revision": 7, "mockedCookies": 0, "setAsideCookies": 0,
   "deleted": 1, "restored": 1, "skipped": 0,
   "entries": [{"domain": ".example.com", "path": "/", "name": "sid", "action": "restored"}]}
  ```

  `action` is `deleted`, `restored`, `skipped` (rewritten by something else) or `gone`
  (deleted by something else). Entries carry keys only, never values.
- Failures, both new `MessageCode`s with English and Korean strings and an entry in
  `Fixtures/message-codes.json`:
  - the journal is read-only: `OPERATION_UNAVAILABLE`, nothing changed;
  - the journal could not be saved after storage changed: `PROVIDER_FAILED`, with the
    counts in `details`. The in-memory journal matches the file on disk, so
    `mockedCookies` never claims a cleanup that the next launch would undo.

### State fields

`maplocal.state` and `maplocal.state.observe` gain:

- `mockedCookies`: the number of active entries, whose mock cookies are in storage now.
  Entries on the pending list do not count, so a successful restore reads 0 at once;
- `setAsideCookies`: the number of set-aside entries, which come back when Map Local is
  on;
- `lastCookieChange`: `{"trigger": "explicit" | "turnedOff" | "turnedOn" | "launch",
  "date", "deleted", "restored", "skipped", "reapplied", "dropped"}`, or null. It tells an
  agent that attaches late what the launch did.

Added output fields keep binding version 1
([cli.md, Binding versions](../../cli.md#binding-versions)).

### Operation `maplocal.cookies.list`

- Binding `necto.device.maplocal.cookies.list`, version 1. Kind `once`, read-only.
- Input `{}`. Output `{"entries": [{"domain", "path", "name", "layer": "active" |
  "setAside", "launch": "current" | "earlier"}]}`: keys only, never values, and nothing
  else from the journal.
- It lets an agent assert that a scenario's mock set a given cookie, and see what an
  earlier run left, without discarding anything. Requested by the Aptner trial sessions.
- It is a separate operation rather than a field of `maplocal.state`, so the state that
  every change broadcasts stays small and the panel's state is unchanged.

### Swift API

`NectoMapLocalPlugin.restoreMockedCookies(scope:)`, static, returns the same result. Like
every source file it sits inside `#if MAP_LOCAL_ENABLED`.

### Panel

While `mockedCookies > 0` the header shows "N mocked cookies in use", and while
`setAsideCookies > 0` it shows "N mocked cookies set aside; they return when Map Local is
on". Either way it carries a "Discard mocked cookies" button. It sits beside the mocked-session
notice, in the panel's existing notice stack. The button calls
`maplocal.cookies.restore`. No cookie name or value is shown. The badge does not change:
set-aside cookies are not in storage, so nothing applies while Map Local is off.

### Logs

`Logger` with subsystem `io.github.ryan-son.maplocal`:

- category `cookies`: each journaled write, each restore with its trigger and counts, and
  each entry left alone. Cookie names and values are `.private`.

On a simulator:
`xcrun simctl spawn booted log stream --level debug --predicate 'subsystem == "io.github.ryan-son.maplocal"'`.

## Section 3: Testing, verification and documents

### Swift, MapLocalCore

- `CookieJournalTests` (new), against an in-memory `CookieJar`, one case for each row of
  Writing and Restore:
  - created, then restored;
  - overwritten, then restored;
  - deleted by a mock (`Max-Age=0`), then restored;
  - a mocked cookie that expired, then restored;
  - a session cookie from an earlier launch;
  - off then on with nothing in between returns the same cookies;
  - a real change while off, or a mock cookie that expired while off, drops the entry;
  - a discard drops set-aside entries;
  - rewritten or deleted by something else;
  - a stale `before` replaced by a newer real value;
  - an expired or earlier-launch session `before` not restored;
  - a write the accept policy refused;
  - a real cookie with the same name on another domain or path left untouched;
  - one rule hit on two paths;
  - `scope: earlierLaunches`.
- `CookieRecord` round trip through `HTTPCookie(properties:)`, and equality at whole
  seconds.
- `EngineTests`:
  - every write that moves `enabled` to false sets aside, and to true puts back
    (`patch`, `replace`, `force`);
  - a write that keeps `enabled` true changes no cookie;
  - a failing restore does not fail the write;
  - the launch reconcile, and the full restore when off;
  - a corrupt configuration launches as on;
  - a write racing a restore.
- `StoreTests`: the journal round-trips; an unreadable journal is read-only and never
  overwritten; an invalid one is deleted; the write and restore orders survive a store
  that fails at each step.

### Swift, NectoMapLocalPlugin

- `URLProtocolTests`: a mocked `Set-Cookie` reaches the engine's jar and is journaled.
  The jar is injected into `ClientRelay`, so no test touches the shared storage.
- `PluginOperationTests` and `ContractTests`:
  - `cookies.restore` input checks, output and both failures; `cookies.list` output;
  - both operations in `outputs()`, and `cookies.restore` in the panel inputs;
  - the manifest and `MapLocalOperation` agree.

### Panel

- The notice's condition, its place in the fixed header rows, and its button's call
  (`view.test.ts`, `fake-api.ts`).
- The turn-off confirmation's cookie sentence, in English and Korean.
- `script/build-panel` regenerates `EmbeddedPanel.swift`, which is committed with the
  manifest change.

### Rules from AGENTS.md

- Every new Swift file starts with the copyright header and is wrapped in
  `#if MAP_LOCAL_ENABLED` … `#endif`.
- Report the `swift test` and `npx vitest run` counts before and after.

### Measured in Necto

With QuickStart on a simulator, record each result in `docs/verification-log.md`:

1. a mocked `Set-Cookie` makes `mockedCookies` 1;
2. `cookies.restore` from `necto-cli` deletes the cookie;
3. turning Map Local off restores the real cookie, and turning it on brings the mocked
   one back;
4. relaunching with Map Local off sets the cookies aside;
5. `simctl terminate` right after a restore, then a relaunch: the pending check restores
   again if the kill undid it;
6. expiry precision after a relaunch;
7. the `log stream` lines appear.

Run on iOS 27. Repeat on iOS 16 once its simulator runtime is installed. This Mac has
none today, so until then the log says iOS 16 was not measured.

### Documents, each with its Korean copy

- `docs/usage.md`:
  - the cookie item and the session opt-out limit in "Known limitations";
  - a section on the notice;
  - the confirmation's new sentence.
- `docs/cli.md`:
  - both operations, `scope` and the failures, and the state fields;
  - the Error model.
- `docs/design.md`: this decision and its reasons:
  - compare at restore instead of watching;
  - the engine owns the write;
  - a full restore at launch only when off;
  - the error model entry.
- `docs/experience.md`: a "compare with the real server and come back" scenario (off,
  on, same cookies), and a "clean up mocked cookies" scenario (discard).
- `docs/recipes.md`:
  - the agent's start (`scope: earlierLaunches`), its checks with `cookies.list`, and
    its end check (`mockedCookies == 0`, `authMocked == false`);
  - switching rule sets before launch by writing `configuration.json` into the app
    container.

## Review log

Three adversarial reviews (cookie semantics with measurements on macOS 27, engine and
contract, agent QA and safety) ran against the first draft. Cookie behavior claims rest
on the reviewer's macOS scripts (not run on iOS). Code claims rest on the reviewers'
file and line citations; `.empty` launching with `enabled == true` and the experience.md
principles were re-read before deciding. The rest is reasoning, and the Necto
measurements in Section 3 are what confirm it.

| Finding | Decision |
|---|---|
| A write and a restore could interleave and journal a mocked value as `before` | Taken: the engine owns the write under one journal lock |
| Cookie I/O under the state lock; a restore failure failing `apply` | Taken: separate lock, restore after the write, failure becomes an issue |
| A mock that deletes, an expired mock cookie, a session cookie after relaunch lost `before` | Taken: *deleted* marker and the "gone by itself" row |
| A stale `before` restored over a newer real cookie; old session `before` resurrected | Taken: `before` is re-read whenever storage no longer equals `written`; expired and earlier-launch session `before` are skipped |
| Writes the accept policy refused were journaled | Taken: journal what storage holds after the write |
| `properties` cannot be written as JSON | Taken: `CookieRecord` (measured: `JSONSerialization` throws) |
| Value-and-expiry comparison too weak and too strict | Taken: compare full records at whole seconds |
| Crash ordering unspecified | Taken: journal before a write, storage before the journal on restore, pending re-check at launch |
| An unreadable journal treated as corrupt | Taken: read-only like the configuration |
| Corrupt journal kept on disk; journal in backups | Taken: deleted; excluded from backups |
| Contract shape, ContractTests, error model, partial failure | Taken: `revision` and `mockedCookies` in the output, two message codes, memory equals disk |
| `replace` and `force` missing from the turn-off trigger | Taken |
| Agents cannot start clean while pre-attach mocks run | Taken without a launch argument: `scope: earlierLaunches` plus `launchID` per entry. A launch argument would be a second way to configure the engine, which was rejected for item 3 |
| Agents cannot tell what happened | Taken: per-entry keys in the result, `lastCookieChange`, and `maplocal.cookies.list`, which the Aptner trial sessions asked for in the fit check |
| Turn-off should return the restore result | Not taken: it changes the output of an existing write. `lastCookieChange` covers it |
| Badge while cookies remain with Map Local off | Not taken: with restore on turn-off, that only follows a response delayed past turn-off, and the notice and the next restore cover it |
| Restore on turn-off cannot be undone (principle 4) | Taken, decided by the user: off sets mocked cookies aside and on puts them back ([Off and on](#off-and-on)), instead of an undo that only the panel could offer |
| Session opt-outs are invisible in the protocol | Taken as a documented limit (measured) |
| `log stream` command and public paths | Taken |
| Measure on iOS 16; test counts; file guards; regenerated panel | Taken |

### Fit check with the Aptner app (modernization-ec)

- Names: kept as they are, with no renames.
- The clean end check names `authMocked`, the field `maplocal.state` already has, instead
  of the internal `mayHoldMockedSession`.
- `maplocal.cookies.list` added, so journaled keys can be read before a restore.
- Session-level cookie opt-outs: the app has none, so the known limit does not affect it.
- The `rules` log: not needed soon, so it ships later as its own change.

## Changed during implementation

The tables above are the design as approved. Implementation and its final review changed
these points; `docs/design.md` holds the decisions in force.

- An entry carries `inFlight` while the mock's write is pending, and a restore treats an
  in-flight entry whose key changed as the mock's write.
- Restore treats a key that again holds exactly `before` as already restored: a kill can
  lose the mock's unsaved write (measured on iOS 27).
- Restoring and reapplying delete the key first, because storage refuses to replace an
  `HttpOnly` cookie with one that is not (measured).
- A restored mocked deletion is not put on the pending list, and an entry dropped by "on"
  leaves the pending list.
- A mock that writes the same value again in a new launch makes the key that launch's.
- `lastCookieChange` is present from launch, not null, unless the journal could not be
  read or saved; its shape is declared in full in the manifest.
