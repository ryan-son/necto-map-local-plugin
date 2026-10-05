# Map Local for Necto

English | [한국어](README-ko.md)

Define an endpoint's response in a [Necto](https://github.com/toss/necto) panel, and your
app gets it from the next request on.

![Map Local's traffic tab with a mocked request selected, beside the app showing the mocked empty list and the Map Local badge](docs/images/map-local.png)

> ⚠️ **Shipping through TestFlight or the App Store? Read
> [Keeping Map Local out of release builds](docs/release-builds.md) first.** A build that
> links NectoSDK is rejected by App Store Connect validation for using private APIs
> (measured: 7 selectors including `_touchesEvent` and `_setHIDEvent:`).

Use it to:

- see a screen with other data, an error, a slow response or no connection;
- build against an API that isn't ready yet;
- answer one page or one item differently;
- mock a login without a test account;
- hand QA the exact responses you used.

[Recipes](docs/recipes.md) has a short path for each. What to expect:

- It works like the Map Local feature of an HTTP proxy tool, but needs no certificates or
  proxy settings. It also works in apps that use SSL pinning. By default, requests that no
  rule answers go to the real server ([How rules apply](docs/usage.md#how-rules-apply)).
- Rules match on method, host, a path template like `/users/{id}` and query conditions
  ([Matching rules](docs/usage.md#matching-rules)). A rule can hold several responses to
  switch between, each with its own delay or error. You can also block or fail the requests
  to allowed hosts that no rule answers
  ([Requests without a rule](docs/usage.md#requests-without-a-rule)).
- The "Traffic" tab shows what the app sent and what answered it. Turn a request into a
  rule in one step. If Necto's network plugin is registered, the rule starts with the real
  response ([The traffic tab](docs/usage.md#the-traffic-tab)).
- While Map Local is on, the app shows a badge whenever Map Local is affecting it. Tap it to turn
  Map Local off ([The badge](docs/usage.md#the-badge)).
- Release builds don't compile the plugin. Run `verify-release` in continuous integration
  (CI) to check that an archive holds no trace of it
  ([Keeping Map Local out of release builds](docs/release-builds.md)).
- `necto-cli`, Necto's command-line interface (CLI), can do everything the panel does to the
  configuration. You can also share a configuration as a file
  ([Import, export and the CLI](docs/cli.md)).

## Quick start

These steps are for internal or local-only apps, which you don't ship through TestFlight or
the App Store. When you finish, your app shows a response you edited in the panel.

### Requirements

- [Necto](https://github.com/toss/necto) 0.2.x (0.2.0 or later, and earlier than 0.3.0),
  for both the Mac app and the SDK the app links. The package declares
  `.upToNextMinor(from: "0.2.0")`. A new Necto minor version, such as 0.3.0, needs a
  matching release of this plugin.
- iOS 17 or later for the app. The engine and the tests also build on macOS 14.
- Xcode 26 or later. We measured the build configuration name rule and the release checks
  on Xcode 26. They also pass on Xcode 27.1 beta. CI runs on Xcode 26.
- Node.js 22.12 or later, only to build the panel from source.

### Steps

1. Add two packages to the app: this one (from `0.1.0`) and
   [Necto](https://github.com/toss/necto) (`0.2.x`). Link `NectoMapLocalPlugin` from this
   package and `NectoSDK` from Necto to the app target. The app calls `NectoSDK` to register
   the plugin. In Xcode, use File → Add Package Dependencies. In a `Package.swift`:
   ```swift
   dependencies: [
       .package(url: "https://github.com/ryan-son/necto-map-local-plugin.git", from: "0.1.0"),
       .package(url: "https://github.com/toss/necto.git", .upToNextMinor(from: "0.2.0")),
   ],
   // the app target's dependencies
   .product(name: "NectoMapLocalPlugin", package: "necto-map-local-plugin"),
   .product(name: "NectoSDK", package: "necto"),
   ```
2. Register Map Local at app startup. Necto's network plugin is optional. Register it after
   Map Local to see real responses and to start a rule from one. It has a cost
   ([Capturing real responses](docs/usage.md#capturing-real-responses)).
   ```swift
   #if DEBUG
   import NectoSDK
   import NectoMapLocalPlugin
   import NectoURLSessionCapture
   #endif

   // App.init or any other earliest point
   #if DEBUG
   NectoSDK.register(NectoMapLocalPlugin())
   NectoSDK.register(URLSessionNetworkPlugin())  // optional, after Map Local
   NectoSDK.start()
   #endif
   ```
3. Build with a build configuration whose name contains `Debug` (case-insensitive). Under another
   name, such as `Staging`, the package builds as Release and the app doesn't compile
   ([Follow the build configuration name rule](docs/release-builds.md#follow-the-build-configuration-name-rule)).
4. [Install the Necto app](https://github.com/toss/necto/blob/main/docs/install.md) 0.2.x and
   open it. Run your app, then in Necto open Device → App → **Map Local**. The panel shows
   "Waiting for the app to connect…" until your app connects, then its "Rules" and
   "Traffic" tabs.
5. In the "Traffic" tab, select a request and press "Mock with this response" ("Mock with an
   empty response" without the network plugin). Mocking also adds the request's host to the
   allowed hosts, the hosts whose requests Map Local can answer. The `Map Local` badge
   appears in the app. Edit the response in the "Rules" tab.
6. Make the app send that request again (reload, or reopen the screen). The app shows the
   response you edited.

The panel saves your changes in the app at once, and they apply from the next request.
While Map Local is on, its rules apply even after a relaunch and while the Necto app is
closed.

If it didn't work, find the symptom in
[Troubleshooting](docs/troubleshooting.md#find-your-symptom). [docs/usage.md](docs/usage.md)
covers the rest.

## Known limitations

These can keep Map Local from intercepting an app's requests:

- Sessions that the app creates, and session configurations (`URLSessionConfiguration`)
  that it reads, before `NectoSDK.register` are not intercepted. `URLSession.shared` is
  intercepted even if the app used it first. Register at the very start of app launch.
- A session configuration whose `protocolClasses` is replaced outright, as some SDKs do,
  drops Map Local. Put `NectoMapLocalPlugin.protocolClass` back at the front of the list.
- Libraries built on `URLSession`, for example Alamofire and Moya, are intercepted under the
  same two conditions: register before the library creates its session, and if it replaces
  `protocolClasses`, put `NectoMapLocalPlugin.protocolClass` at the front.

Map Local also doesn't intercept background sessions or `WKWebView`, doesn't follow a mocked
3xx, and stores a mocked `Set-Cookie` in `HTTPCookieStorage.shared`, not the session's own
storage. The full list,
with reasons and the code that restores `protocolClasses`, is in
[Known limitations](docs/usage.md#known-limitations).

## Documentation

- [Recipes](docs/recipes.md): a short path for each common job
- [Usage](docs/usage.md): matching, the traffic tab, hosts, the badge and the keyboard
- [Troubleshooting](docs/troubleshooting.md): what to check for each symptom, and why a
  request wasn't mocked
- [Release builds](docs/release-builds.md): removing Necto, the build configuration name rule
  and blocking a release in CI
- [Import, export and the CLI](docs/cli.md): the file format, operations and errors
- Contributor guides: [experience](docs/experience.md) · [design](docs/design.md) ·
  [first-use test](docs/first-use-test.md) · [verification log](docs/verification-log.md)
- [Security](SECURITY.md) · [Changelog](CHANGELOG.md)
- Necto's own guides: [github.com/toss/necto](https://github.com/toss/necto/tree/main/docs)

## Contributing

Anyone is welcome to contribute. Read [CONTRIBUTING.md](CONTRIBUTING.md)
([한국어](CONTRIBUTING-ko.md)) for how to build from source, report an issue and open a
pull request.

## License

MIT. See [LICENSE](LICENSE). The embedded panel includes third-party code; see
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
