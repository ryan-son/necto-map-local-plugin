# Mocked Cookie Journal — Design

Status: draft for review. Branch `feature/mocked-cookie-journal`, based on
`feature/ios-16-support`.

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
2. a cookie that a mock overwrote, and that nothing has changed since, has its original
   value and attributes back;
3. a cookie that something else rewrote after the mock keeps its latest value;
4. no cookie that Map Local did not write is deleted or changed, even one with the same
   name on another domain or path;
5. a journal survives a relaunch, and a launch with Map Local off cleans it up before the
   app's first request.

## Scope

- In: `HTTPCookieStorage.shared`, the only storage Map Local writes to. The journal, the
  three restore triggers, a new operation, a new state field, a panel notice, a Swift API,
  and `os_log` output for rules and cookies.
- Out: a session's own cookie storage (no public API reaches it, so Map Local never
  writes there), `WKWebsiteDataStore`, the keychain, and any other place a mocked sign-in
  can leave state. Restoring cookies does not clear the mocked-session warning
  (`authMocked`).

## Approach

Chosen: a `CookieJournal` owned by the engine in `MapLocalCore`, reaching cookie storage
through a small `CookieJar` protocol.

- The triggers that restore already pass through the engine (a configuration change that
  turns Map Local off, the engine's `init`), and the engine already publishes state to the
  panel and the CLI. The URL protocol only reports a cookie it is about to write.
- `CookieJar` lets the tests use an in-memory jar instead of the shared storage.

Rejected:

- A journal inside the URL protocol layer alone. The triggers and the state live in the
  engine, so two layers would each hold part of the truth.
- A snapshot of the whole storage at the first mock, diffed at restore. Real cookies from
  other hosts that changed in between would be caught in the diff, and limiting the diff
  to cookies Map Local wrote is this design anyway.

## Section 1: The journal

### Key

`(domain, path, name)`, the identity `HTTPCookieStorage` uses to replace a cookie. The
domain is taken from the parsed `HTTPCookie`, so a host-only cookie and a `Domain=`
cookie for the same host are different keys, as they are in the storage.

### Entry

One entry per key:

| Field | Set when | Holds |
|---|---|---|
| `before` | The first mocked write to the key only | The full `HTTPCookie.properties` that was in storage under the key just before that write, or nothing |
| `written` | Every mocked write to the key | The value and expiry date of the cookie the mock wrote last |

A key written by several mocks therefore keeps the value from before the first mock.

### Restore

For each entry, read the cookie stored under the key now:

| Stored now | Action |
|---|---|
| Nothing | Leave it. Something deleted it on purpose, such as a logout, so `before` is not brought back |
| Differs from `written` (value or expiry) | Something else rewrote it. Drop the entry and leave the cookie |
| Equal to `written` | No `before`: delete it. With `before`: store `before` again |

After a restore the journal is empty. A restore deletes or replaces only cookies under
journaled keys, and never by name alone. A server that sends exactly the value and expiry
the mock wrote is indistinguishable from the mock, so that cookie is restored.

The comparison runs at restore time, not by watching real responses: responses from
sessions or hosts Map Local does not intercept never reach it, and comparing finds every
rewrite whatever its source.

### Storage

- `Application Support/NectoMapLocal/cookie-journal.json`, beside `configuration.json`,
  written atomically with `.completeUntilFirstUserAuthentication`.
- `ConfigurationStore` gains `loadCookieJournal()` and `saveCookieJournal(_:)`, following
  `loadAuthMocked()`.
- A journal file that is not valid is moved to `cookie-journal.corrupt-<time>.json` and
  the journal starts empty, as `configuration.json` does.
- `before` holds real session cookies. The journal is never part of an export, a request
  event or a log line.

## Section 2: Triggers, interface and logs

### Triggers

All three call the engine's single `restoreMockedCookies()`.

| Trigger | Where | Note |
|---|---|---|
| Explicit | The CLI operation, the panel button, the Swift API | Works whether Map Local is on or off |
| Map Local turned off | The engine, when a change moves `enabled` from true to false | The panel switch, the badge sheet and `configuration.patch` all take this path. `false` to `false` does not restore |
| Launched off with a journal left | The engine's `init`, synchronously, right after the configuration loads | Runs before the app's first request. A launch with Map Local on keeps the journal, because rules apply with or without Necto |

A response delayed past the moment Map Local was turned off still writes its cookie and
is journaled. The next trigger cleans it up, and the panel notice shows it meanwhile.

### Operation `maplocal.cookies.restore`

- Binding `necto.device.maplocal.cookies.restore`, version 1. Kind `once`.
- Input `{}`. No `baseRevision`: it does not write the configuration, and calling it
  twice gives the same storage.
- Output `{"ok": true, "deleted": n, "restored": n, "skipped": n}`, where `skipped` counts
  entries dropped because something else rewrote the cookie.
- A journal that cannot be saved fails the call with `PROVIDER_FAILED`, as a failed
  configuration save does.

### State field `mockedCookies`

`maplocal.state` and `maplocal.state.observe` gain `mockedCookies`, the number of journal
entries. An added output field keeps binding version 1
([cli.md, Binding versions](../../cli.md#binding-versions)). An agent ends a scenario by
checking `mockedCookies == 0`.

### Swift API

`NectoMapLocalPlugin.restoreMockedCookies()`, static, returns the same three counts. Like
every source file it sits inside `#if MAP_LOCAL_ENABLED`.

### Panel

While `mockedCookies > 0`, the panel shows "N mocked cookies remain" with a "Restore
cookies" button beside the mocked-session notice, whether Map Local is on or off. The
button calls `maplocal.cookies.restore`. No cookie name or value is shown. The badge does
not change.

### Logs

`Logger` with subsystem `io.github.ryan-son.maplocal`:

- category `rules`: a mocked request at `.info`, a request passed through at `.debug`,
  with method, host, path, rule ID and outcome as public values;
- category `cookies`: each journaled write, each restore with its trigger and counts, and
  each dropped entry. Cookie names and values are `.private`.

A test session reads them with
`log stream --predicate 'subsystem == "io.github.ryan-son.maplocal"'`.

## Section 3: Testing, verification and documents

### Swift, MapLocalCore

- `CookieJournalTests` (new), against an in-memory `CookieJar`: created then restored,
  overwritten then restored, rewritten by someone else, deleted by someone else, several
  mocked writes to one key, and a real cookie with the same name on another domain or
  path left untouched.
- `EngineTests`: restore when `enabled` goes true to false and not on false to false;
  restore in `init` when off with a journal, not when on; `mockedCookies` follows.
- `StoreTests`: the journal round-trips, and a corrupt journal moves aside.

### Swift, NectoMapLocalPlugin

- `URLProtocolTests`: a mocked `Set-Cookie` is journaled, and nothing is journaled when
  `httpShouldHandleCookies` is false. Tests use their own storage, never the shared one.
- `PluginOperationTests` and `ContractTests`: `cookies.restore` input checks and output,
  and the manifest and `MapLocalOperation` list the same operations.

### Panel

The notice's condition and its button's call (`view.test.ts`, `fake-api.ts`), and its
English and Korean strings. New message codes go into `Fixtures/message-codes.json`. No
new shared fixture: the journal logic exists only in Swift.

### Measured in Necto

On a simulator (iOS 27) with QuickStart: a mocked `Set-Cookie` makes `mockedCookies` 1;
`cookies.restore` from `necto-cli` deletes it; turning Map Local off restores; relaunching
with Map Local off cleans up; `log stream` shows the lines. The results go into
`docs/verification-log.md`.

### Documents, each with its Korean copy

- `docs/usage.md`: the cookie item in "Known limitations", and a section on the notice.
- `docs/cli.md`: the operation and the state field.
- `docs/design.md`: the decision and its reasons (compare at restore instead of
  watching; clean up only on a launch with Map Local off).
- `docs/experience.md`: a "clean up mocked cookies" scenario.
- `docs/recipes.md`: the agent's end-of-scenario cleanup, and switching rule sets before
  launch by writing `configuration.json` into the app container.
