# Using Map Local

[한국어](usage-ko.md)

What each part of the panel does, and what the app does with your rules. For a short path
to a common job, see [recipes.md](recipes.md). When something doesn't work, find the symptom
in [troubleshooting.md](troubleshooting.md). Setting up the package is in the
[README](../README.md), and keeping Map Local out of release builds is in
[release-builds.md](release-builds.md).

## How rules apply

The app code is two lines: register the plugin and start Necto. You set allowed hosts,
rules, responses, delays and errors in the panel. A change in the panel is saved in the app
at once and applies from the next request.

The app keeps the latest configuration. **While Map Local is on, its rules apply even when
the Necto Mac app is closed.** They apply from the first request after the app relaunches.
While Map Local is on, the app shows a [badge](#the-badge) whenever Map Local is affecting
it. Tap the badge to
turn Map Local off.

By default, requests that no rule answers go to the real server. You can change that in
[Requests without a rule](#requests-without-a-rule). With no allowed hosts, Map Local mocks
nothing.

### Registering the plugin once

Necto rejects a second plugin with the same ID (`io.github.ryan-son.maplocal`) in every
build. In Debug builds it also fails an assertion. To replace the plugin at runtime, call
`NectoSDK.unregister(id: "io.github.ryan-son.maplocal")` first.

Creating the plugin again is harmless, but changes nothing. Map Local sets up its engine
(the code that decides what each request gets), its configuration and its
[hosts blocked in app code](#allowed-hosts) once per process. A later
`NectoMapLocalPlugin(blockedHosts:)` call keeps the `blockedHosts` of the first call.

## Allowed hosts

Map Local mocks only requests to an allowed host.

- **With no allowed hosts, Map Local mocks nothing.** To add a host, type or paste a host
  or URL into the "+ Host" field in the panel header and press Return. Mocking a request
  from the "Traffic" tab adds its host too.
- **Write internationalized domain names (IDN) in punycode.** The engine receives a Unicode
  request host percent-encoded, so an allowed host such as `한국.kr` never matches any
  request. The "+ Host" field does not add such a host. It shows "Enter a Unicode host as
  punycode (xn--…)". For `한국.kr`, enter `xn--3e0b707e.kr`.
- **List production server hosts in app code to keep them from being mocked.** With
  `NectoMapLocalPlugin(blockedHosts: ["api.example.com"])`, Map Local never mocks those
  hosts, even when they are allowed hosts. It ignores the scheme, port and case of each
  entry, and the panel cannot change the list. These docs call them hosts blocked in app
  code. **The list does not stop the requests.** They still go to the real server. It
  keeps the production server from being mocked, not from being reached.

## Requests without a rule

"Requests without a rule" in the panel decides what a request to an allowed host gets when
no rule answers it. Requests to other hosts, and to hosts blocked in app code, always go to
the real server.

- "Send to the real server" (the default): the request goes to the real server.
- "Block (421)": the request gets 421. This stops a mocked token from being sent to the real
  server with a request that no rule answers, where it would get a 401 and could force a
  logout. Recommended when you mock authentication (see [Auth rule](#auth-rule)).
- "No internet connection (-1009)", "Connection lost (-1005)" or "Timed out (-1001)": the
  request fails with that `URLError`, as if the server were out of reach. A rule that
  matches a request still answers it, so turn off any rule whose requests should fail too.
  The request fails at once, even with "Timed out". To make a request fail late, set the
  "Network error" of a rule's response to that error and give the response a "Delay (ms)".
  The device's own network state (`NWPathMonitor`) does not change.

## Matching rules

A rule answers a request when all of these match:

- **Method.** The request's HTTP method equals the rule's.
- **Host.** The request's host equals the rule's. A rule with an empty host matches every
  allowed host. Either way, the request's host must be an [allowed host](#allowed-hosts).
- **Path.** A segment like `{id}` matches any non-empty segment. Write the path
  percent-encoded, as the app sends it: `%20`, not a space.
- **Query conditions.** See below.

### Query conditions

Query conditions are the key=value rows under "Query conditions" in the editor. They match
when every listed key is present with exactly that value. Keys not listed are ignored.
Values are compared after percent-decoding, and `+` is not turned into a space. No
conditions means "Any query".

The rule list shows the conditions, like `GET /api/sites ?page=2`, so rules for the same
path are easy to tell apart.

A rule created from traffic has no query conditions. Check "Only with this query" to copy
the request's query into the conditions. The checkbox does not appear when a matching rule
already exists, because the panel then adds the response to that rule.

### When several rules match

The rule with more query conditions answers. On a tie, the one higher in the list does.
When two rules that are on can match some of the same requests, each rule's editor says,
under its query conditions, which rule answers those requests. If a third rule takes those
requests from both, the editor names that third rule instead.

## The traffic tab

The panel has two tabs, "Rules" and "Traffic". It follows Necto's language setting, English
or Korean.

The "Traffic" tab lists the app's requests, grouped by endpoint ("Endpoints") or in time
order ("By time"), with the result of each one. You can filter by status, by result
("Mocked", "Real server", "Blocked", "Unknown"), or to "Allowed hosts only". The search
field matches the method, the host, the path and the query string the app sent
(`page=2`, `siteId=101`).

In the "By time" view, a selected request stays where it is while new ones arrive above it.
The line above the list counts them. Press "Show newest" to go to the latest, or "Pause" to
freeze the list.

Select a request to see its response, then turn it into a rule:

1. Press "Mock with this response". When the response cannot be seen, for example without
   [Necto's network plugin](#capturing-real-responses), the panel offers "Mock with an empty
   response" instead, or "Open rule" when a rule already matches the request. Mocking also adds the request's host to the allowed hosts, as the line under
   the button says.
2. Edit the response in the "Rules" tab.

The same job with every step, through checking the result in the app, is in
[recipes.md](recipes.md#see-a-screen-with-different-data).

When a rule matches a request that was not mocked, the traffic detail says why in one line.
Each reason and its fix are in
[troubleshooting.md](troubleshooting.md#why-a-request-wasnt-mocked).

When the rule that mocked a request does not check every key in the request's query, press
"Rule for this query only", beside "Open rule". It makes a rule whose query conditions are
the request's query, starting with the response the app gets now.

After you make a rule from traffic with query conditions, the panel watches that rule until
it first answers a request. If a later request matches the rule except for its query, the
traffic detail says which condition failed and shows the fix beside it.

### Capturing real responses

To see the real response (status, headers, body) and have it filled into a new rule,
register Necto's network plugin **after** Map Local:

```swift
#if DEBUG
import NectoURLSessionCapture   // URLSessionNetworkPlugin lives in this module
#endif

#if DEBUG
NectoSDK.register(NectoMapLocalPlugin())      // first
NectoSDK.register(URLSessionNetworkPlugin())  // after
NectoSDK.start()
#endif
```

The order matters (measured with Necto 0.2.0):

- With Map Local first, mocked requests appear in the "Traffic" tab with the mocked
  response. Each request is logged once.
- With the network plugin first, mocked requests disappear from the "Traffic" tab, and
  requests that go to the real server are logged twice. The panel shows a warning when
  mocked requests are missing from Necto's records, or when requests that go to the real
  server are logged twice.
- Without the network plugin, the tab still lists requests, but you cannot see responses.
  A rule created from a request gets an empty 200 JSON response.

The cost: the network plugin resends each request with
`URLSession(configuration: .ephemeral)`. The resent request skips the app session's
delegate (auth challenges, pinning), the shared cookies and URLCache. Capturing is
optional.

Capturing relies on behavior that Necto does not document. The panel calls bridges that
belong to another plugin: `necto.device.network-records.*`, from the network plugin.
Necto 0.2.0 routes them, but Necto's bridge docs describe app bridges as scoped to one
plugin. The panel checks availability on every connection, and shows Necto's reason when
the records are unavailable. The "Rules" tab keeps working without them. A future Necto
release could change how these bridges are routed.

## Auth rule

Turn on "Auth rule" ("A response that hands out a login or token") for rules that answer a
login or a token request.

After such a rule answers, the app may hold the mocked token. These docs call that a
*mocked session*. Map Local remembers it, across relaunches, until you log out in the app
and press "I've logged out" in the panel. While a mocked session may remain:

- while Map Local is on, the app badge shows `Map Local 🔑`. Turning Map Local off hides
  the badge, but the mocked session remains;
- the panel shows a notice with the "I've logged out" button;
- the panel tells you to log out of the app first when you turn off or delete an auth
  rule. It does the same when an auth rule that is on answers an allowed host and you turn
  Map Local off or remove that host.

To keep a mocked token from reaching the real server with requests that no rule answers,
also set [Requests without a rule](#requests-without-a-rule) to "Block (421)".

## The badge

The app shows a small `Map Local` badge while Map Local is on and one of these applies:

- a rule that is on answers requests to an allowed host;
- "Requests without a rule" is set to "Block (421)" or an error, and there is an allowed
  host;
- or a [mocked session](#auth-rule) may remain.

When none of these applies, or Map Local is off, the app shows nothing.

The badge sits beside the home indicator, at the bottom right. On devices with a Home
button, it sits in the status bar, where it shows but may not take taps; turn Map Local off
from the panel there. Only the badge takes touches; everything else reaches
the app. It hides while the keyboard is up. VoiceOver reads it as a button.

### Turning Map Local off from the app

Tap the badge to open a sheet that lists what applies: how many rules answer requests, up
to three of them named as the panel names them, what requests that no rule answers get, and
whether a mocked session may remain. "Turn off Map Local" in the sheet flips the same switch
as the panel's "Map Local on", so the panel follows. If a mocked session may reach the real
server, the sheet tells you to log out of the app first.

The sheet follows the device language: Korean when the device prefers Korean, English
otherwise.

## Undo and the keyboard

Deleting a rule or a response does not ask first. It offers "Undo" instead.

Necto keeps ⌘Z (Undo in the Edit menu) and Esc for itself; they never reach the panel. So
undo, close and clear always have a visible button: "Undo", × and ⓧ.

These keys work in the panel. We measured ↑↓, Return, ⌘↩ and `/` in Necto 0.2.0.

| Key | Action |
| --- | --- |
| ↑ ↓ | Move through a list |
| Return | Focus the detail's primary action |
| ⌘↩ | "Mock with this response" (the shortcut is shown on the button) |
| `/` | Search |
| ← → | Resize the list, on the split handle (double-click for the default width) |

## What the panel can see

- **Linking the package is the permission.** Necto shows no install dialog for device
  plugins. Adding the package to an app grants its panel full access to the plugin's
  device bridges ([Necto: bridges](https://github.com/toss/necto/blob/main/docs/bridges.md)).
  That covers reading and replacing the configuration, and every request record, tokens
  included. Add it only to builds you control.
- **Export and capture keep values as they are.** "Copy configuration", traffic capture and
  the request log carry tokens, cookies and passwords unchanged, as Necto's own network
  records do.
- **Copying warns, but never changes values.** The panel shows a one-line warning when the
  copied configuration contains any of these:
  - a value that looks like a JSON Web Token (JWT);
  - a rule tagged `auth` (an auth rule);
  - the value of an Authorization, Cookie or Set-Cookie response header;
  - a non-empty text or number value under a response header, query condition key or JSON
    body key whose name contains `token`, `secret`, `password`, `apikey` (also `api-key`,
    `api_key`) or `session` (case-insensitive).

  Check the configuration before you share or commit it.

## Known limitations

These were measured on an iOS 26.4 simulator with Necto 0.2.0.

- **Sessions created, and session configurations read, before `NectoSDK.register` are not
  intercepted.** Registering puts Map Local in front of `URLSession.shared`, and first in
  the `protocolClasses` list of every `URLSessionConfiguration.default` or `.ephemeral`
  read afterwards. A session configuration read earlier keeps its old `protocolClasses` list,
  and so does every session created from it. `URLSession.shared` is covered even when it
  was used first. Put the registration at the earliest point of app startup, such as
  `App.init` or `application(_:willFinishLaunchingWithOptions:)`.
- **A session configuration whose `protocolClasses` is replaced outright loses Map Local.**
  `config.protocolClasses = [MyProtocol.self]`, as some SDKs do, drops the list Map Local
  was in. Adding to the existing list, at the front or the back, is fine. To restore it, put
  `NectoMapLocalPlugin.protocolClass` in front after the list is set:

  ```swift
  #if DEBUG
  config.protocolClasses = [NectoMapLocalPlugin.protocolClass] + (config.protocolClasses ?? [])
  #endif
  ```

  Map Local intercepts a session whose configuration lists `protocolClass`, whenever that
  configuration was created, even before the plugin is registered. So this also fixes a
  session that must exist early.
- **Libraries built on `URLSession`, such as Alamofire and Moya, need the same two things.**
  Register Map Local before the library creates its session. If the library replaces
  `protocolClasses`, put `NectoMapLocalPlugin.protocolClass` in front. A shared session such
  as Alamofire's `AF` is created the first time any code uses it. If that first use happens
  before `NectoSDK.register`, Map Local does not intercept the session.
- **Background sessions are not intercepted.** Transfers on
  `URLSessionConfiguration.background(withIdentifier:)` run in a system process outside the
  app, and that process never consults the app's `URLProtocol`. Use a foreground session in
  Debug builds, or point the transfer at an external mock server.
- **`WKWebView` is not intercepted**: page loads, `fetch` and `XMLHttpRequest` alike.
  WebKit does its own networking in a separate process.
- **A mocked 3xx is returned as is, not followed.** The app receives the 3xx with its
  `Location` header, and the target is never requested. A **real** redirect whose target a
  rule matches is mocked on that hop: the server answers the first request and the rule
  answers the redirected one.
- `Set-Cookie` on a mocked response always goes into **`HTTPCookieStorage.shared`**, not
  the session's own cookie storage, when the request handles cookies
  (`httpShouldHandleCookies`, on by default). No public API lets Map Local write to the session's
  storage. With an ephemeral session or a separate cookie storage, that session does not
  get the mocked cookie, and the cookie stays in the shared storage. After you turn Map
  Local off, a session that uses the shared storage can send the mocked cookie with real
  requests.
- Map Local can hide changes to the server's API contract. Use other tools to check the
  contract.
