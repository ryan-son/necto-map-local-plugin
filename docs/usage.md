# Using Map Local

[한국어](usage-ko.md)

How to define responses in the panel, and what the app does with them. Setting up the
package is in the [README](../README.md). Keeping it out of release builds is in
[release-builds.md](release-builds.md). For a short path to a common job, start with
[recipes.md](recipes.md).

## How rules apply

The app code is two lines: register the plugin and start Necto. Allowed hosts, rules,
responses, delays and errors are all set in the panel. Changes are saved at once and apply
from the next request.

The last configuration is saved in the app. **While Map Local is on, its rules apply, with
or without Necto.** That holds from the first request after a relaunch, and while Necto is
closed. The app shows a [badge](#the-badge) whenever something applies. Tap it to turn Map
Local off.

Requests that no rule answers go to the real server. If the allowed hosts are empty,
nothing is mocked.

### Register it once

Necto rejects a second plugin with the same ID (`io.github.ryan-son.maplocal`) in every
build, and asserts in debug. To replace it at runtime, call
`NectoSDK.unregister(id: "io.github.ryan-son.maplocal")` first.

Creating the plugin again is harmless, but changes nothing. The engine, its configuration
and its blocked hosts are set up once per process. A later
`NectoMapLocalPlugin(blockedHosts:)` keeps the blocked hosts of the first one.

## Matching rules

A rule responds when all of these match:

- **Method.**
- **Host.** Empty means every allowed host.
- **Path.** A segment like `{id}` matches any non-empty segment. Write the path
  percent-encoded, as the app sends it: `%20`, not a space.
- **Query conditions.** See below.

### Query conditions

Query conditions are the key=value rows under "Query conditions" in the editor. They match
when every listed key is present with exactly that value. Keys not listed are ignored.
Values are compared after percent-decoding; `+` is kept as is. No conditions means "Any
query".

The rule list shows the conditions, like `GET /api/sites ?page=2`, so rules for the same
path are easy to tell apart.

A rule created from traffic has no query conditions. Check "Only with this query" to copy
the request's query into the conditions. The checkbox is absent when a matching rule
already exists, because the response is then added to that rule.

### When several rules match

The rule with more query conditions responds. On a tie, the one higher in the list does.
When a rule that is on shares requests with another rule that is on, its editor says under
the query conditions which rule answers them, a third rule included when it takes them from
both.

## The traffic tab

The panel has two tabs, "Rules" and "Traffic". It follows Necto's language setting, English
or Korean.

The traffic tab lists the app's requests, grouped by endpoint ("Endpoints") or in time
order ("By time"), with the result of each one. You can filter by status, by result
("Mocked", "Real server", "Blocked", "Unknown"), or to "Allowed hosts only". The search
field matches the method, the host, the path and the query string the app sent
(`page=2`, `siteId=101`).

In the time view, a selected request stays where it is while new ones arrive above it. The
line above the list counts them, and "Show newest" goes to the latest. "Pause" freezes the
list.

Select a request to see its response, then turn it into a rule:

1. Press "Mock with this response". When the response cannot be seen, the button is "Mock
   with an empty response". Mocking also adds the request's host to the allowed hosts, as
   the line under the button says.
2. Edit the response in the "Rules" tab.

To allow a host without mocking anything yet, type or paste a host or URL into the
"+ Host" field in the panel header and press Return.

When a rule matches a request that was not mocked, the detail says why in one line. When a
rule mocked a request for every query, "Rule for this query only" beside "Open rule" makes a
rule with the request's query as conditions, starting with the response the app gets now.
A rule made from traffic with query conditions is followed until it first answers: a later
request it fits but for its query says which condition failed, with the fix beside it.

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

The order matters (measured):

- With Map Local first, mocked requests appear in the traffic tab with the mocked response.
  Each request is logged once.
- With the network plugin first, mocked requests disappear from the traffic tab, and
  passthrough requests are logged twice. The panel shows a warning when it sees this.
- Without the network plugin, the tab still lists requests, but you cannot see responses.
  A rule created from a request gets an empty 200 JSON response.

The cost: the Necto observer resends requests with `URLSession(configuration: .ephemeral)`.
That bypasses the app session's delegate (auth challenges, pinning), the shared cookies and
URLCache. Capturing is optional.

This relies on behaviour Necto does not document. The panel calls bridges that belong to
another plugin: `necto.device.network-records.*`, from Necto's network plugin. Necto 0.2.0
routes them, but its bridge docs describe app bridges as scoped to one plugin. The panel
checks availability on every connection, and shows Necto's reason when the records are
unavailable. The rules tab keeps working without them. A future Necto release could change
this.

## Allowed and blocked hosts

- **No allowed hosts, nothing mocked.** Add a host with the "+ Host" field. Mocking a
  request from the traffic tab adds its host too.
- **Write Unicode (IDN) hosts in punycode.** The engine receives a Unicode request host
  percent-encoded, so allowing `한국.kr` never matches any request. The "+ Host" field does
  not add such a host. It says "Enter a Unicode host as punycode (xn--…)", for example
  `xn--3e0b707e.kr`.
- **Block production hosts in app code.** With
  `NectoMapLocalPlugin(blockedHosts: ["api.example.com"])`, those hosts are never mocked.
  Scheme, port and case are ignored, and the panel cannot change the list. **It does not
  block the requests.** They still go to the real server, unmocked. It guards against
  mocking production, not against reaching it.
- **Block or fail requests without a rule.** "Requests without a rule" in the panel decides
  what an unmocked request to an allowed host gets; other hosts always pass through.
  - "Block (421)": the request gets 421. This keeps a fake token from riding on an unmocked
    real-server request and causing a 401 or a forced logout. Recommended when you mock
    authentication.
  - "No internet connection (-1009)", "Connection lost (-1005)" or "Timed out (-1001)": the
    request fails with that `URLError`, as if the server were out of reach. Rules still
    answer, so turn off the ones that should fail too. The request fails at once, even
    "Timed out"; for a late failure, give a rule's response that error and a delay. The
    device's own network state (`NWPathMonitor`) does not change.

## Auth rule

Turn on "Auth rule" ("A response that hands out a login or token") for rules that answer a
login or a token request. When such a rule responds, the app badge shows `Map Local 🔑`,
and the panel shows an "I've logged out" confirmation. When you turn the rule off or delete
it, you are told to log out of the app first.

## The badge

The app shows a small `Map Local` pill whenever something applies:

- an enabled rule answers an allowed host;
- requests without a rule are blocked or failed;
- or a mocked session may remain.

When nothing applies, the app shows nothing.

The pill sits beside the home indicator, at the bottom right. On devices with a Home
button, it sits in the status bar. Only the pill takes touches; everything else reaches the
app. It hides while the keyboard is up. VoiceOver reads it as a button.

### Turning it off from the app

Tap the badge to see what applies: up to three rules, named as the panel names them, and
blocking. "Turn off Map Local" writes the same switch as the panel, so the panel follows.
If a mocked session may reach the real server, it reminds you to log out first.

The sheet follows the device language: Korean when the device prefers Korean, English
otherwise.

## Undo and the keyboard

Deleting a rule or a response does not ask first. It offers "Undo" instead.

Necto keeps ⌘Z (Undo in the Edit menu) and Esc for itself; they never reach the panel. So
undo, close and clear always have a visible button: "Undo", × and ⓧ.

Keys that work in the panel. ↑↓, Return, ⌘↩ and `/` were measured in Necto 0.2.0.

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
  copied configuration contains any of these: a JWT-looking value; a rule tagged `auth`; an
  Authorization, Cookie or Set-Cookie header value; or a value under a response header,
  query condition key or JSON body key named like token, secret, password, api key or
  session. Check before you share or commit it.

## Known limitations

These were measured on an iOS 26.4 simulator with Necto 0.2.0.

- **Sessions and configurations obtained before `NectoSDK.register` are not intercepted.**
  Registering puts Map Local in front of `URLSession.shared` and of every
  `URLSessionConfiguration.default` or `.ephemeral` read afterwards. A configuration read
  earlier keeps its old list, and so does every session built from it. `URLSession.shared`
  is covered even when it was used first. Put the registration at the earliest point of
  app startup, such as `App.init` or `application(_:willFinishLaunchingWithOptions:)`.
- **A configuration whose `protocolClasses` is replaced outright loses Map Local.**
  `config.protocolClasses = [MyProtocol.self]`, as some SDKs do, drops the list Map Local
  was in. Adding to the existing list, at the front or the back, is fine. To restore it, put
  `NectoMapLocalPlugin.protocolClass` in front after the list is set:

  ```swift
  #if DEBUG
  config.protocolClasses = [NectoMapLocalPlugin.protocolClass] + (config.protocolClasses ?? [])
  #endif
  ```

  A configuration that lists `protocolClass` is intercepted whenever it was made, even
  before the plugin is registered, so this also fixes a session that must exist early.
- **Libraries built on `URLSession` (e.g. Alamofire, Moya) work under the same
  conditions.** Map Local must be registered before their session is created, and a
  configuration whose `protocolClasses` is replaced needs `NectoMapLocalPlugin.protocolClass`
  prepended. A shared session such as Alamofire's `AF` is created the first time anything
  uses it, so it is a session from before registration if anything reaches it earlier.
- **Background sessions are not intercepted.** Transfers on
  `URLSessionConfiguration.background(withIdentifier:)` run in a system process outside the
  app, which never consults the app's `URLProtocol`. Use a foreground session in Debug
  builds, or point the transfer at a mock server.
- **`WKWebView` is not intercepted**: page loads, `fetch` and `XMLHttpRequest` alike.
  WebKit does its own networking in a separate process.
- **A mocked 3xx is returned as is, not followed.** The app receives the 3xx with its
  `Location` header, and the target is never requested. A **real** redirect whose target a
  rule matches is mocked on that hop: the server answers the first request and the rule
  answers the redirected one.
- `Set-Cookie` on a mocked response always goes into **`HTTPCookieStorage.shared`**, not
  the session's own cookie storage. No public API reaches the session's storage. With an
  ephemeral session or a separate cookie storage, the mocked cookie is not reflected in that
  session, and it stays in the shared storage. After you turn Map Local off, it can ride on
  a real request from a session that uses the shared storage.
- It can hide changes to the server's contract. Checking the contract is a job for other
  tools.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A rule doesn't match | Is the host in the allowed hosts? Is it not a blocked host? Is the result in the traffic tab "Real server"? A dimmed host in the row means it is not an allowed host |
| The panel shows "Waiting for the app to connect…" | Is the app running as Debug, and did you select that app in Necto? |
| `module<NectoMapLocalPlugin>` compile error | The [configuration name rule](release-builds.md) |
| Every request to an allowed host gets 421 | "Requests without a rule" is set to "Block". Add the rules you need, or set it to "Send to the real server" |
| Every request to an allowed host fails as offline (-1009, -1005 or -1001) | "Requests without a rule" is set to an error. Add the rules you need, or set it to "Send to the real server" |
| The traffic detail says a matching rule didn't mock a request | Follow its one-line reason: Map Local off, host not allowed, rule off, or a host blocked in app code (never mocked) |
| The app doesn't appear in Necto | Several builds of one app (a Dev and a production flavour, say) can sit side by side. Launch the build whose code registers the plugin |
| Requests from a fresh install reach production | The app's own default may point to production until you switch its server environment. `blockedHosts` keeps production from being mocked, but still lets those requests through |
