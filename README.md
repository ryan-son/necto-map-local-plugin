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

- It works like a proxy's Map Local, but with no certificates or proxy settings, and
  regardless of SSL pinning. Requests you haven't defined go to the real server
  ([docs/usage.md](docs/usage.md)).
- Rules match on method, host, a path template like `/users/{id}` and query conditions.
  Switch between responses, add delays and errors, or block or fail requests without a rule
  ([docs/usage.md](docs/usage.md)).
- The traffic tab shows what the app sent and what answered it. Turn a request into a rule
  in one step, filled with the real response when Necto's network plugin is registered
  ([docs/usage.md](docs/usage.md)).
- The app shows a badge whenever something applies. Tap it to turn Map Local off
  ([docs/usage.md](docs/usage.md)).
- Release builds compile none of the plugin, and `verify-release` proves it in CI
  ([docs/release-builds.md](docs/release-builds.md)).
- Everything the panel does to the configuration, `necto-cli` does too. Share it as a file
  ([docs/cli.md](docs/cli.md)).

## Quick start

For internal or local-only apps. Check the [requirements](#requirements) first.

1. Add the package: `https://github.com/ryan-son/necto-map-local-plugin` (from `0.1.0`).
2. Register it at app startup:
   ```swift
   #if DEBUG
   import NectoSDK
   import NectoMapLocalPlugin
   #endif

   // App.init or any other earliest point
   #if DEBUG
   NectoSDK.register(NectoMapLocalPlugin())
   NectoSDK.start()
   #endif
   ```
3. Run the Necto app, then open Device → App → **Map Local**.
4. In the "Traffic" tab, select a request and press "Mock with this response". Mocking also
   adds its host to the allowed hosts. Edit the response in the "Rules" tab.

Changes are saved at once and apply from the next request. While Map Local is on, its rules
apply with or without Necto. [docs/usage.md](docs/usage.md) covers the rest.

### Requirements

- [Necto](https://github.com/toss/necto) 0.2.x, at least 0.2.0 and below 0.3.0, for both
  the Mac app and the SDK the app links. The package declares
  `.upToNextMinor(from: "0.2.0")`. A new Necto minor needs a matching release of this
  plugin.
- iOS 17 or later for the app. The engine and the tests also build on macOS 14.
- Xcode 26 or later. The configuration name rule and the release checks were measured on
  Xcode 26 and pass on Xcode 27.1 beta too; CI runs on Xcode 26.
- Node 22.12 or later, only to build the panel from source.

## Known limitations

- Sessions and configurations the app makes before `NectoSDK.register` are not
  intercepted (`URLSession.shared` is). Register at the very start of app launch.
- A configuration whose `protocolClasses` is replaced outright, as some SDKs do, drops Map
  Local. Put `NectoMapLocalPlugin.protocolClass` back in front of the list.
- Libraries built on `URLSession` (e.g. Alamofire, Moya) work under the same two
  conditions.
- Background sessions and `WKWebView` are not intercepted.
- A mocked 3xx is returned, not followed. A real redirect to a URL a rule matches is
  mocked on that hop.
- `Set-Cookie` on a mocked response always goes into `HTTPCookieStorage.shared`.

The full list, with reasons, is in [docs/usage.md](docs/usage.md).

## Documentation

- [Recipes](docs/recipes.md): a short path for each common job
- [Usage](docs/usage.md): matching, the traffic tab, hosts, the badge, the keyboard and
  troubleshooting
- [Release builds](docs/release-builds.md): removing Necto, the configuration name rule and
  blocking in CI
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
