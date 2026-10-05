# Keeping Map Local out of release builds

[한국어](release-builds-ko.md)

Map Local is a debug tool. This page shows how to keep it, and Necto, out of the builds you
ship, and how to prove it in CI.

> ⚠️ A build that links NectoSDK is rejected by App Store Connect validation for using
> private APIs (measured: 7 selectors including `_touchesEvent` and `_setHIDEvent:`).

## Removing Necto from the release app

The plugin's own code in this package is not compiled into Release builds. But **NectoSDK
stays in a Release app the moment it is linked**, and that build is rejected at validation.

So leave your existing app project as it is. Keep a **separate, Debug-only app project**
that links Necto and this plugin. `Examples/SeparateProject` shows the layout:

- `App/App.xcodeproj` is the release project. It knows nothing about Necto.
- `Dev/Dev.xcodeproj` has a single Debug configuration. It uses the same sources
  (`Shared/`) and only adds the registration code. Give it a different bundle ID and
  display name.

Why not another target in the same project, or the same workspace? Package resolution is
per project or workspace. The release archive would then be tied to the plugin repository.

To verify an archive:

```bash
script/verify-release --include-necto <archive>   # OK: no traces
```

## Configuration name rule

Xcode builds packages as Debug **whenever the configuration name contains `debug`
(case-insensitive), regardless of the configuration's actual settings**.

- A configuration you ship with must not contain `debug` in its name. The plugin code got
  into a build named `ReleaseDebuggable`.
- A debug configuration's name must contain `debug`. If it doesn't, like `QA` or
  `Staging`, the package is built as Release, and the app fails to compile like this:

  ```
  cannot call value of non-function type 'module<NectoMapLocalPlugin>'
  ```

Both were measured on Xcode 26.

## Blocking in CI

**CI is the only place where the check can block a release.** In the separate-project
setup, the release project does not depend on this package. So download the script from
the release, and check it against a hash you pinned before you run it.

The release notes print the SHA-256 of `verify-release`. Copy it into your CI
configuration once, together with the version. The `verify-release.sha256` asset comes
from the same place as the script, so whoever could replace one could replace both. Only a
hash kept in your own repository catches that.

```bash
base=https://github.com/ryan-son/necto-map-local-plugin/releases/download/0.1.0
expected=<SHA-256 from the 0.1.0 release notes>             # pinned in your repository
curl -fsSL -O "$base/verify-release"
echo "$expected  verify-release" | shasum -a 256 -c      # verify-release: OK
bash verify-release build/App.xcarchive                  # our traces
bash verify-release --include-necto build/App.xcarchive  # Necto too
```

Place it between `xcodebuild archive` and the upload.

| Exit code | Meaning |
| --- | --- |
| 0 | Pass |
| 1 | Traces found (`FOUND [rule] path`) |
| 2 | Usage or read error. A file or folder that could not be read is not counted as a pass |

Two other places look right but cannot block:

- A build-phase Run Script cannot scan inside the `.app`, because of the sandbox.
- A scheme Archive post-action cannot block the archive even if it fails. It only displays.
