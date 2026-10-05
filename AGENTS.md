# Map Local Agent Guide

A [Necto](https://github.com/toss/necto) device plugin that answers an app's requests
with responses defined in a panel. The engine is Swift and rides in the app; the panel is
a web plugin embedded in the Swift module. [README.md](README.md) covers the same project
from a user's view, and [docs/usage.md](docs/usage.md) has the detail.

Everything here is written in English: code, comments, test names, documentation and
commit messages. Korean appears only in the `-ko.md` copies of documents and in the values
of translation tables. Every Swift, TypeScript and CSS file starts with the copyright header
used throughout the repository:

```swift
//
// Copyright (c) 2026 necto-map-local-plugin contributors
//
```

The holder is the one in [LICENSE](LICENSE). Never copy Necto's own holder.

## Commands

| Task | Command |
| --- | --- |
| Everything CI runs | `script/ci` |
| Swift tests | `swift test` |
| Panel tests | `cd Panel && npx vitest run` |
| Panel typecheck | `cd Panel && npx tsc --noEmit` |
| Rebuild and embed the panel | `script/build-panel` |
| Check a release archive | `script/verify-release [--include-necto] <archive\|app\|ipa>` |
| Check a release tag and write its assets | `script/prepare-release <tag> <out-dir>` |
| Check that workflow actions are pinned to commits | `script/lint-workflows` |
| Check that each `X.md` and `X-ko.md` keep the same headings, code blocks and links | `script/check-doc-pairs` |
| Check that every relative link in the Markdown resolves | `script/check-doc-links` |

The panel must be built before the Swift package is committed, because its output rides
inside `NectoMapLocalPlugin` as `EmbeddedPanel.swift`. `script/build-panel` tests,
builds and embeds it in that order. CI fails when the committed file differs from a fresh
build, so commit the regenerated file with the panel change that caused it.

## Layout

```text
Sources/MapLocalCore            Configuration, matcher and engine. No Necto dependency
Sources/NectoMapLocalPlugin     The NectoPlugin, URLProtocol, installer and embedded panel
Tests/                          Swift Testing suites for both modules
Panel/                          The web panel (TypeScript, vite, vitest)
Fixtures/                       Cases shared by the Swift and TypeScript tests
Examples/                       QuickStart and SeparateProject sample apps, used by CI
script/                         Build, CI and release verification scripts
docs/usage.md                   Using the panel: matching, traffic, hosts, badge, keyboard
docs/recipes.md                 A short path for each common job
docs/troubleshooting.md         Symptoms, and why a request wasn't mocked
docs/release-builds.md          Keeping Necto out of release builds, and blocking in CI
docs/cli.md                     Import, export, necto-cli operations and the error model
docs/experience.md              What the panel is for and how it must behave
docs/design.md                  The design decisions in force, each with its reason
docs/verification-log.md        What each release was checked on, and what was not
docs/images/                    README screenshots, captured by hand
SECURITY.md                     How to report a vulnerability
```

## Rules that are easy to get wrong

- **Nothing ships in a release build.** Every Swift file in `Sources/` and `Tests/` is
  wrapped in `#if MAP_LOCAL_ENABLED` … `#endif`, and `Package.swift` defines that flag
  for the debug configuration only. After the copyright header, the first line must be
  `#if MAP_LOCAL_ENABLED` and the last line `#endif`; `script/lint-guard` checks it.
  `script/verify-controls` archives the example apps and proves the release archive
  carries no trace of the plugin. A change that weakens either check is a release bug.
- **`EmbeddedPanel.swift` is generated.** `script/embed-panel` writes it from
  `Panel/dist`. Do not edit it by hand.
- **Swift and TypeScript read the same fixtures.** `Fixtures/matcher-cases.json`,
  `Fixtures/path-cases.json` and `Fixtures/host-cases.json` are the single table for rule
  matching, rule path validation and host normalization. `Tests/MapLocalCoreTests/SharedFixtureTests.swift`,
  `Panel/tests/traffic/fixtures.test.ts` and `Panel/tests/hosts.test.ts` all read them.
  Change matching or host rules on both sides together, add the case to the fixture, and
  never fork a case into one side's tests.
- **`docs/experience.md` decides how the panel behaves.** It holds the intent, the
  principles and the scenarios a change must keep passing, with values measured in Necto.
  Read it before changing anything a user sees, and update it, with its Korean copy
  `docs/experience-ko.md`, when a decision changes.
- **Measure in Necto before claiming a fix.** jsdom is not WebKit, and the host keeps some
  keys (⌘Z, Esc) for itself. Say so when a behavior was verified only in tests.
- **A contract is a schema.** The panel and the app talk through the operations in
  `Panel/public/manifest.json`. Changing an operation's input or output is a wire change,
  not a refactor.
- **A document and its Korean copy change together.** Every `X.md` with an `X-ko.md`
  (README, CONTRIBUTING, SECURITY and the user and design docs in `docs/`) must keep the
  same headings, code blocks and links; `script/check-doc-pairs` fails otherwise. A Korean
  copy sits next to its document with the `-ko.md` suffix. `script/check-doc-links` fails
  on a relative link that does not resolve.
- **Test counts are a check.** A refactor keeps `swift test` and `npx vitest run` at the
  same number of tests. Report both when a change is meant to preserve behavior.

## Reference

- **Landing page**: [README.md](README.md)
- **Using the panel**: [docs/usage.md](docs/usage.md); **troubleshooting**: [docs/troubleshooting.md](docs/troubleshooting.md)
- **Release setup and CI blocking**: [docs/release-builds.md](docs/release-builds.md)
- **Import, export and the CLI contract**: [docs/cli.md](docs/cli.md)
- **Panel experience and measured host behavior**: [docs/experience.md](docs/experience.md)
- **Design decisions and their reasons**: [docs/design.md](docs/design.md)
- **Per-release verification**: [docs/verification-log.md](docs/verification-log.md)
- **Necto's own rules**, which this plugin follows: the Necto repository's `AGENTS.md`
  and `docs/plugin-manifest.md`
