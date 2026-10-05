# Map Local — Design Decisions

[한국어](design-ko.md)

The decisions that shape the plugin today, each with the reason it was made. Only
decisions the code still follows are here; when one changes, change this file with it.
How the panel looks and behaves is decided in [experience.md](experience.md), and how to
use the plugin is in [usage.md](usage.md).

Upstream references are to Necto 0.2.0, the version this release resolves.

## Goal

Define an endpoint's response in a Necto panel and have the running app receive it from
the next request on, with no certificates, no proxy and no app changes beyond registering
the plugin. Requests without a rule reach the real server. Proxies do this too, but need
a trusted certificate on every device and stop working under SSL pinning; in-process
interception has neither problem.

## Interception

**`URLProtocol`, installed once per process.**
`MapLocalInstaller` registers `MapLocalURLProtocol` (covers `URLSession.shared`) and
replaces the class getters `URLSessionConfiguration.default` and `.ephemeral`, so every
configuration the app creates afterwards lists the protocol first while keeping the
classes it already had (`Sources/NectoMapLocalPlugin/MapLocalInstaller.swift`).
- Why replace the getters: sessions built from a configuration do not consult
  `registerClass`, and the app should not have to add the protocol itself.
- Why `method_setImplementation` behind a `static let`: the plugin may be created more
  than once. Exchanging implementations would undo itself on the second call; a one-time
  replacement holds.
- A configuration whose `protocolClasses` the app replaces outright, as some SDKs do,
  loses the protocol. The app puts it back with `NectoMapLocalPlugin.protocolClass`, the
  only public way to name it, as Necto offers `NectoURLSessionCapture.protocolClass`.
  `MapLocalURLProtocol` itself is internal, so it can be renamed or split without
  breaking apps.
- Why not replace the `protocolClasses` instance getter as well: measured, it also covers
  sessions made before registration and replaced lists, but it works only because CFNetwork
  reads that getter after a session is created, which is private behavior that a new OS
  can change. The public `protocolClass` and the documented limits are the safer trade.
- There is one engine per process (`MapLocalRuntime.installIfNeeded`,
  `Sources/MapLocalCore/MapLocalEngine.swift`). The instance Necto holds and the
  `URLProtocol` read the same engine. A second plugin instance reuses it, including its
  blocked hosts.

**The decision belongs to the task, not the request.**
`canInit(with: URLSessionTask)` runs once per task (and per redirect hop). It decides,
records a passthrough when no rule applies, and stores a matching decision in
`TaskDecisions` for `startLoading()` to take (`MapLocalURLProtocol.swift`).
- Why not stamp it on the request: an app that copies `currentRequest` and changes its
  URL or method would carry the old decision along.
- `startLoading()` answers with the decision made when the task started, even if the
  configuration changed in between, and records the mock there, exactly once.
- `canInit(with: URLRequest)` never reads the body stream. Reading it sends an unmatched
  real request with an empty body.
- Responses are delivered with `cacheStoragePolicy: .notAllowed`, and
  `requestIsCacheEquivalent` is always false, so a mock never lands in or comes from
  `URLCache`.
- Every mocked response carries `X-Map-Local: <rule>/<response>`; a blocked request
  carries `X-Map-Local: unmocked` (`Sources/MapLocalCore/Matcher.swift`). The traffic tab
  reads this header to tell what happened to a request. A request failed with an error,
  by a rule or as a request without a rule, has no response and so no header; its result
  comes from the engine's record of it, and a failed detail never overrules that.
- Delays wait on an injected `Clock` with the deadline fixed in `startLoading()`, so
  tests run without real time and a late `Task` does not stretch the delay.

**Limits that follow from this approach** (also in usage.md, "Known limitations"):
- A session or configuration created before `NectoSDK.register` is not intercepted.
- Background sessions, `WKWebView`, WebSocket and stacks that bypass `URLSession` are out
  of scope.
- A mocked `Set-Cookie` goes into `HTTPCookieStorage.shared`: no public API reaches a
  session's own cookie storage.
- A mocked 3xx is not followed as a redirect.
- Necto's own connection uses a socket, not `URLSession`, so Map Local never sees it.

## Hosts

**Nothing is mocked until a host is allowed.**
`Matcher.decide` considers only requests to an allowed host that is not blocked. An
empty list mocks nothing, so adding the package cannot change an app's traffic by itself.

**Blocked hosts come from app code and are never mocked.**
`NectoMapLocalPlugin(blockedHosts:)` takes hosts such as production servers. The panel
cannot change them, and a blocked host is skipped even when it is also allowed.
- Why app code: the protection must not depend on what someone does in the panel.
- Why pass through instead of failing: a Debug build that points at production by
  default would otherwise go silently offline the moment the plugin is added.
- So the name means "never mocked", not "never reached": a blocked host's requests still
  go to the real server. Measured: a fresh install pointing at production sent an
  unauthenticated search there as a passthrough. usage.md and the traffic detail say so.

**Requests without a rule can be blocked or failed.**
`unmatched` is `passthrough`, `block` (default status 421, `Unmatched.defaultBlockStatus`
in `Sources/MapLocalCore/Configuration.swift`) or `fail` (default error
`notConnectedToInternet`). Both apply only to allowed hosts.
- Why: when authentication is mocked, an unmocked request would carry a fake token to the
  real server and the app may sign itself out.
- Why 421: apps commonly retry 5xx, and often treat 401, 403 and 404 as an invalid
  session. 421 is rarely handled, so a missing mock shows up as itself.
- Why `fail`: a server out of reach while the network is up is common, and taking the
  device offline does not reproduce it. An error on a response fails only the requests a
  rule answers; `fail` covers the rest, and with the rules off, every request to the
  allowed hosts fails. It takes the same errors as a response, so there is one list.
  It cannot change what the device reports about its network (`NWPathMonitor`), which
  stays the job of airplane mode or the Network Link Conditioner.

**Hosts are normalized in one place.** Scheme, port, trailing dot and case are removed
from allowed, blocked, rule and recorded hosts (`HostName.normalize`). Swift and the panel
read the same cases from `Fixtures/host-cases.json`. Unicode hosts must be written in
punycode, because the engine receives them percent-encoded.

## Matching

A rule matches when method, host (absent means every allowed host), path and query
conditions all match (`Matcher.swift`).
- Paths are compared percent-encoded, segment by segment. `{name}` matches any non-empty
  segment and never a prefix (`Sources/MapLocalCore/PathTemplate.swift`).
- **A rule path must be written percent-encoded**, as requests are matched: every segment
  is a `{name}` template or holds only RFC 3986 path characters and `%XX` escapes. A path
  with anything else (`/x y`, `/검색`) is refused with `pathNotEncoded`, and such a rule
  in a file is kept as written but not applied (`PathTemplate.isEncoded`, `isEncodedPath`
  in `Panel/src/traffic/match.ts`, `Fixtures/path-cases.json`).
  - Why refuse rather than encode it: there is no single right encoding to guess. The
    engine compares the path as the app wrote it in the URL, and `{name}` braces are not
    path characters, so an encoder would need exceptions and could still produce a path
    that never matches, silently. A rule made from traffic already carries the path as the
    app sent it, and the codec keeps what was written instead of rewriting it.
- Query conditions match when every listed key is present with exactly that value, after
  percent-decoding; `+` is not turned into a space; a repeated key keeps its last value.
  Unlisted keys are ignored.
- **Specificity decides between matching rules**: the rule with more query conditions
  wins, and the list order breaks a tie. Why: with list order alone, a `?page=2` rule
  placed after a general rule for the same path was dead. Specificity only revives such
  rules, and needs no reordering UI.
- Only enabled rules with an existing active response are candidates.

The panel ports the matcher to TypeScript to predict which rule a capture would hit
(`Panel/src/traffic/match.ts`). Both sides read `Fixtures/matcher-cases.json`, so they
cannot drift apart silently.

## Configuration

**Writes carry the revision they were based on.**
Necto runs each operation in its own `Task` and does not keep their order (Necto 0.2.0,
`Sources/NectoSDK/NectoSDKRuntime.swift`), and the panel and the CLI can write at the same
time. Every write sends `baseRevision`; the engine refuses a stale one with `conflict`,
and applies, saves and broadcasts under one lock in revision order (`MapLocalEngine.apply`).
The panel sends writes one at a time and retries a conflict once (`Panel/src/writer.ts`).
Importing a shared file uses `configuration.replace` with `force: true`, since a file
cannot know the device's revision.

**Saved in the app, applied whenever Map Local is on.**
`FileConfigurationStore` writes `Application Support/NectoMapLocal/configuration.json`
atomically and loads it synchronously when the plugin is created
(`Sources/MapLocalCore/ConfigurationStore.swift`). A relaunched app mocks from its first
request.
- The rule is deterministic: on means the rules apply, with or without Necto attached, and
  off means nothing does. Nothing waits for Necto, holds a request, or depends on which
  panel is open. The badge shows whenever something applies, and tapping it turns Map
  Local off (`Badge and in-app control` below).
- Why: measured, an app reaches Necto 0.1–2s after launch, and its launch requests come
  before that. Gating on the connection would make the same launch mock or not by timing,
  and a person without Necto at hand would have no way to know or change it.

**Loading never loses a configuration.**
- A file that is not a valid configuration is moved to
  `configuration.corrupt-<time>.json`, and the engine starts empty.
- A file that exists but cannot be read (for example under data protection before first
  unlock) opens read-only, so the next save cannot overwrite it.
- A file from a newer version opens read-only.
- A rule this build cannot apply (unknown key, wrong type, duplicate id) is kept as an
  unsupported entry, never applied, and written back exactly as read
  (`RuleEntry.unsupported`). A rule made by a newer plugin survives an older one.

**Edits save immediately.** Necto recreates the panel's WebView when the app reconnects
or the user switches panels, so there is no Save button: fields save after a short
debounce, and unfinished text is kept per `rule/response` in the panel's `localStorage`
(`Panel/src/drafts.ts`). A new `launchID` in the state tells the panel the app relaunched,
which a revision alone cannot (`EngineState.launchID`).

**JSON bodies are stored as text.** The panel saves a body written in JSON mode, a
captured body and the empty 200 of a new rule or response as `body` (a string), exactly
as typed or as the server sent it; `json` (a parsed value) remains for hand-written files.
A captured JSON body sent on one line is indented for editing (`indentJSON` in
`Panel/src/json.ts`): only whitespace changes, never values, key order or repeated keys,
and the text is never parsed and written again, which would round numbers past 2^53.
Nesting deeper than 100, or text that would grow more than fourfold, is left on one line:
indentation grows with commas times depth.
- Why: `NectoJSONValue` and the engine's `JSONValue` keep objects in Swift dictionaries,
  so a parsed value comes back from every state echo with its keys in another order. The
  body editor reshuffled while the user typed, and could not be compared with the server
  response. Only a string crosses the bridge unchanged.
- A text body gets no content type from the engine, so the panel adds
  `Content-Type: application/json` to a JSON-mode body that has none, as the engine does
  for `json` — but only for a legacy `json` body, a response without a body, or one
  switched to JSON in the editor. A text body that merely parses as JSON was served
  without a content type and keeps it that way. The editor opens a body that parses as a
  JSON object or array in JSON mode.
- The panel compares an echo with the edit with every object's keys sorted, so an echo
  that differs only in order never replaces what is on screen.

## Auth rule and mocked session

A rule tagged `auth` hands out a login or a token. When such a rule answers, the engine
marks that the app may hold a mocked session, stores the mark next to the configuration
so it survives a relaunch, and shows it on the badge (`MapLocalEngine.recordMocked`). It is
cleared only by `configuration.patch {"authMocked": false}`, which the panel sends when
the user confirms signing out. While it may remain, turning off or deleting an auth rule,
turning Map Local off and removing an allowed host an auth rule answers all ask first,
through one question (`View.askFirst`). Turning an auth rule on from the traffic detail
asks too, since the next login would be mocked and the tag is not in view there. The
badge's sheet asks the same way, with the same words (`Effects.sessionAtRisk` mirrors
`View.sessionAtRisk`).
- Why: a mocked session left in the Keychain causes confusing expiries and sign-outs
  after mocking stops, and an unmocked request may send its fake token to the real
  server. The block mode above is the other half of this.

## Keeping it out of release builds

**Our code compiles only in debug.** Every Swift file in `Sources/` and `Tests/` is
wrapped in `#if MAP_LOCAL_ENABLED`, and `Package.swift` defines that flag for the debug
configuration only. `script/lint-guard` checks the wrapping.

**Xcode decides "debug" by the configuration's name.** A package is built as Debug when
the configuration name contains `debug` in any case, whatever the configuration's
settings. This was measured on Xcode 26 and is pinned by control ⑤ below, so
[release-builds.md](release-builds.md) states the naming rule.

**NectoSDK itself stays in a release build once linked**, and App Store Connect
validation rejects it for private selectors used by Necto's touch injection (measured
2026-10-02). So for TestFlight and App Store apps release-builds.md recommends a separate
Debug-only app project (`Examples/SeparateProject`). A second target or a shared
workspace is not enough, because package resolution is per project or workspace, which
would tie the release archive to this repository.

**Checked on the archive, not assumed.**
`script/verify-release [--include-necto]` searches an archive, app or IPA for our traces
(and optionally Necto's), counts unreadable files as failures, and exits 0, 1 or 2 for CI.
`script/verify-controls` archives the examples and asserts five archive controls, each by the rule
and file it must hit: same-target release passes; same-target Debug fails on our code;
same-target release fails the Necto check; the separate project passes the Necto check;
a release configuration named `ReleaseDebuggable` fails on our code. It also builds the
Debug-only project of the separate-project example. The release
workflow publishes `verify-release` with its checksum for apps that do not depend on this
package, written before any dependency code runs in the release job, and puts the hash in
the release notes for users to pin. CI is the only place a check can block: a build-phase script cannot read inside
the `.app` under the script sandbox, and a scheme post-action cannot fail an archive.

Debug symbols (dSYM) still hold empty module names and build paths. Removing them needs
`-gnone`, an unsafe flag a remote package cannot set; the `.app` itself carries nothing.

## The panel rides inside the Swift module

`script/embed-panel` turns `Panel/dist` into `EmbeddedPanel.swift`, a dictionary of path
to base64 string. At startup `PanelWriter` empties a fixed directory under the temporary
directory, writes the files there and hands it to `NectoPluginPanel(root:)`
(`Sources/NectoMapLocalPlugin/PanelWriter.swift`). Necto's template ships the panel as a
package resource instead.
- Why not a resource bundle: a package with resources produces a bundle and a
  bundle-lookup accessor in every build, release included. With the panel as Swift data
  under `#if MAP_LOCAL_ENABLED`, a release build contains no trace of it.
- Why base64 strings: a `[UInt8]` literal of the panel's size took several times longer
  to compile.
- Why a fixed directory, emptied first: Necto hashes every regular file in the panel
  directory to identify its content, so leftovers would change the hash, and a new
  directory per launch would pile up.
- When writing fails, `panel` is nil. A path Necto cannot read would trip an assertion in
  NectoSDK's debug build.
- `EmbeddedPanel.swift` is generated and committed. CI rebuilds the panel and fails when
  the committed file differs.

## Seeing real responses: Necto's network records

Map Local does not resend requests to capture responses. Its manifest binds Necto's own
`necto.device.network-records.{observe,list,detail}` bridges, which
`URLSessionNetworkPlugin` provides when the app registers it
(`Panel/public/manifest.json`, `network.*` operations).
- Why reuse: one capture path in the app instead of two, and the user's Network panel
  and the traffic tab see the same records.
- This is a cross-plugin binding. Necto's host resolves a device bridge across every
  plugin of the target (Necto 0.2.0,
  `NectoMac/Sources/NectoMacService/NectoPluginRegistry.swift`), but the bridge docs
  describe app bridges as scoped to one plugin. It works on undocumented behaviour, so
  the panel checks availability through `context().operations` on every connection and
  shows Necto's `unavailableReason` (`Panel/src/api.ts`). `PanelTests` pins the kinds of
  the foreign bindings, since a mismatched kind is dropped as unavailable without an error.
- `network-records.clear` is not bound: it would clear the user's Network panel too.

**Registration order: Map Local first, the network plugin after.**
The URLProtocol registered last is asked first. Necto's observer resends each request on
`URLSession(configuration: .ephemeral)` (Necto 0.2.0,
`Sources/NectoURLSessionCapture/NectoURLSessionCapture.swift`). With Map Local first, that
ephemeral session gets our protocol through the replaced getter, so mocks appear in
Necto's records with the mocked response and each request is logged once. In the other
order, mocks disappear from the records and passthroughs are logged twice (measured).
The panel recognises that signature in live data from the current launch and warns
(`Panel/src/traffic/order.ts`).

**Each request's result is attributed carefully** (`Panel/src/traffic/store.ts`):
1. The `X-Map-Local` header in the record's detail decides first.
2. Otherwise the panel pairs the Necto record with our own event of the same method,
   normalized host, path and query that came 0–50 ms after it, using each of our events
   once. The window is one-sided because our event always followed Necto's in the
   registration order above.
3. Otherwise, and for a failed request with no headers (which may be a mocked error), the
   result is "unknown". A wrong badge is worse than none.
Our events carry a `seq` within a launch, and `maplocal.requests.list` returns the last
500 so a panel opened late still has results; stream events at or below the listed
`lastSeq` are dropped.

Without the network plugin, the traffic tab lists our own events, and a rule made from one
holds an empty 200 JSON response.

## Values are kept as they are

Captures, copied configurations and the request log carry tokens, cookies and passwords
unchanged. Only "Copy configuration" warns, in one line, when the configuration looks like
it holds a secret: a JWT-like value, a rule tagged `auth`, an Authorization, Cookie or
Set-Cookie header, or a value under a key named like token, secret, password, api key or
session (`Panel/src/transfer.ts`). The values are never changed.
- Why: a mock exists to reproduce exactly what was seen, and Necto's own network records
  are raw too. Redaction fought that, and keeping two parsers (Swift and TypeScript) in
  agreement on what to hide cost more than it protected.
- Cost: a real token can reach a shared or committed configuration if the warning is
  ignored.
- A capture drops `Set-Cookie`, `Content-Length`, `Content-Encoding`,
  `Transfer-Encoding`, `Connection`, `Date` and `X-Map-Local`: the body arrives already
  decoded, so a kept `Content-Encoding` would make the app decode it twice
  (`Panel/src/traffic/capture.ts`).
- It also leaves out headers the app does not act on, which only crowded the editor: CORS
  (`Access-Control-*`), `Cache-Control`, `Pragma`, `Expires`, `X-Frame-Options`,
  `X-Content-Type-Options`, `X-XSS-Protection`, `Strict-Transport-Security`, `Server`
  and request ids (`X-Request-Id`, `X-Message-Id` and the like). `Content-Type` and the
  app's own headers stay. The detail says how many it leaves out, naming them on hover, and
  the capture notice repeats the count; a header that matters can be typed back in.

## Localization

- The panel's source text is English and is the dictionary key; Korean comes from a
  table through `necto.createTranslator` (`Panel/src/localization.ts`), as in Necto's
  built-in plugins. The host picks the language, and the panel sets `<html lang>` from
  `necto.locale()`.
- The engine speaks in codes. Every message has a stable `MessageCode`, parameters and
  an English text (`Sources/MapLocalCore/MapLocalMessage.swift`); the panel translates by
  code, and the CLI shows the English. The codes are listed in
  `Fixtures/message-codes.json` and checked on both sides.
- The badge on the device follows the device's first preferred language, Korean or
  English, not the app's localizations, which this package does not control
  (`Sources/NectoMapLocalPlugin/Badge.swift`).
- The badge's own text is the same in every language (`Map Local`, `Map Local 🔑`); its
  spoken label, its sheet and the sheet's message follow the device language.

## Badge and in-app control

**The badge shows exactly when something applies** (`EngineState.effects`): Map Local is
on and an enabled rule with its active response answers an allowed host that is not
blocked, or requests without a rule are blocked or failed on such a host, or a mocked session may
remain. Otherwise the app shows nothing; there is no idle or "no allowed hosts" badge.
- Why: a badge that is always there stops being read. One that appears only when the app
  is not talking to the real server is a cue nobody has to learn.
- A mocked session counts on its own: no rule may answer any more, but the app still holds
  a fake token, and the cue to sign out must not disappear.
- The sheet counts only rules that can answer: a rule an earlier rule always wins over
  (the same method and query conditions, a path the earlier one covers, no host the earlier
  one misses) is left out (`Effects.rules`).

**Tapping it turns Map Local off.** The pill is a button; the sheet (an action sheet, a
popover anchored to the pill where the system shows one) names what applies and offers
only `Turn off Map Local` and `Cancel`. Turning off sends the panel's own write,
`configuration.patch {"enabled": false}`, based on the revision the sheet opened on
(`BadgeControl`), so the panel updates from its usual state stream and a change made
while the sheet was open is a conflict: nothing is written and the sheet asks again with
what applies now. When a mocked token could reach the real server, the sheet leads with
the panel's sign-out guidance, and if that became true while the sheet was open (a mocked
sign-in raises no revision), turning off asks again with it instead of writing
(`BadgeControl.confirm`). Nothing is presented over an alert or a sheet already on its way
in or out. The sheet comes from the app's top-most controller; in a scene with no
normal-level window it comes from the scene's key or top-most window, and with no app
window at all from the badge's own window, which then takes touches on the sheet
(`BadgePresenter`).
- Measured on an iPhone 17 Pro simulator (iOS 26.4): an action's handler runs after its
  alert has been dismissed, so the sheet asked again and the failure alert both appear.
  Rechecked on iOS 27.0 (iPhone 18 Pro): the same.
- Why: rules apply without Necto, so someone without Necto at hand needs a way out from
  the app itself. Editing stays in the panel.

**Only the pill takes touches.** The badge's window returns nil from `hitTest` for every
point outside the pill, and never becomes the key window, so the app keeps its touches and
its keyboard.

**It sits beside the home indicator** (`BadgeLayout`), at the trailing side, centred in the
strip. Where it does not fit beside the indicator it goes above it; on a Home button
device it goes at the leading edge of the status bar; with neither strip it is hidden.
It hides while a keyboard covers the bottom of its own scene, since the dictation key
sits in that strip (`BadgeLayout.keyboardCovers`). Keyboard notifications reach every
scene, so a keyboard in another iPad window that does not cover this scene, a floating
keyboard and the hardware keyboard's shortcut bar leave it shown.
- Measured on iOS 26.4 simulators: the notification's object is the keyboard's screen;
  the software keyboard is 335pt tall on an iPhone 17 Pro and 337pt on an iPad Air
  11-inch; with a hardware keyboard an iPhone posts only a hide. Remeasured on iOS 27.0:
  328pt on an iPhone 18 Pro, 337pt on an iPad Air 11-inch (M4), the object still the
  screen; the safe area (62pt top, 34pt bottom) and the 54pt status bar are unchanged. Not measured: the iPad
  shortcut bar, assumed under the 150pt the badge treats as a keyboard.
- Measured in the Necto simulation: centred under the Dynamic Island, it covered pushed
  screens' navigation titles and the first row of popover menus.
- Measured on an iPhone 17 Pro simulator (iOS 26.4): the status bar cannot hold it. The
  system draws the clock and indicators above every app window, and keeps every touch in
  the status bar frame (the top 54pt of a 62pt inset) without handing it to the app.
  Rechecked on iOS 27.0 (iPhone 18 Pro): the same. The
  floating search field of iOS 26 ends 29pt above the bottom edge, inside the 34pt strip
  (tab bars are assumed to share that baseline; not measured), so the badge sits below them, not above the indicator.
- Not measured: a Home button device, where the status bar may keep the badge's touches
  too, and an iPad.

## Error model

Only two outcomes of a write are answered as data, `{"ok": false, "reason": …}`:
`conflict` (stale `baseRevision`) and `readOnly`. The panel acts on both as normal flow.
Everything else throws a `NectoBridgeError`, so Necto fails the call and the CLI exits
nonzero: malformed input is `INVALID_INPUT`, a missing rule or response is
`OPERATION_UNAVAILABLE`, a failed save is `PROVIDER_FAILED`
(`Sources/NectoMapLocalPlugin/NectoMapLocalPlugin.swift`). Both shapes carry `reason`,
`code`, `params`, an English `message` and `revision`.
- Why: answering every failure as `ok: false` let scripts and agents read a failure as
  success.
- Every operation declares a strict input schema in the manifest, so Necto rejects bad
  input before the app sees it. The app checks again for callers that skip Necto, and
  `ContractTests` keeps the two equal.
- Bindings are version 1. A change that breaks a caller ships under a new binding
  version; adding an optional input key or an output field does not.

## Identity and dependencies

- The plugin ID is `io.github.ryan-son.maplocal`, reverse-domain under the author's
  GitHub account, and it does not change: Necto treats a new ID as a different plugin with
  its own grants and storage. Operation ids keep the `maplocal.` prefix.
- Necto is required with `.upToNextMinor(from: "0.2.0")`. Its SDK source API has changed
  between minors, so a wider range could break builds, and `exact:` would conflict with
  the app's own Necto dependency. The weekly `script/check-necto-latest` job tests the
  latest Necto tag and its `@necto/bridge`, and says when a matching release is needed.
