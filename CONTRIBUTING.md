# Contributing to Map Local

English | [한국어](CONTRIBUTING-ko.md)

Thank you for your interest in Map Local for Necto.

## Reference

- The rules every change must follow — [AGENTS.md](AGENTS.md)
- How the panel must behave — [docs/experience.md](docs/experience.md)
- Why the plugin is built the way it is — [docs/design.md](docs/design.md)
- Using the plugin — [docs/usage.md](docs/usage.md)
- Keeping it out of release builds — [docs/release-builds.md](docs/release-builds.md)
- Import, export and the CLI contract — [docs/cli.md](docs/cli.md)
- Reporting a vulnerability — [SECURITY.md](SECURITY.md)

## Write in English

Write code, comments, test names, documentation and commit messages in English.
Documentation may include a Korean translation.

A Korean copy is next to its document as `X-ko.md`, and the two change together.
`script/check-doc-pairs` fails when a pair differs in its headings (count and levels), its
number of code blocks, or its link targets. A Korean copy links to Korean copies where the
English links to English ones; the check reads them as the same target.
`script/check-doc-links` fails on a relative link that does not resolve, or whose
`#fragment` names no heading in the target document.

Write Korean documents in 해요체, the polite informal style, in short, plain sentences, as
Necto's Korean documents are. Korean UI strings (the panel's dictionary and the in-app
badge) use 합니다체, the formal style, as Necto's built-in plugins do.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), as
Necto's do: a lowercase imperative summary with an optional scope, such as
`fix(panel): keep the selection when a filter hides it` or `test(engine): cover query
specificity`.

## Issues

Use issues to report bugs or propose features; the templates ask for what is needed. A
bug report needs the Necto version, the plugin version, how the app was connected (USB
device or simulator), and steps to reproduce. Report a vulnerability privately, as
[SECURITY.md](SECURITY.md) describes.

## Pull requests

1. Fork this repository, then clone your fork to your computer.

2. Create a branch from `main`. Name it by intent, like `feature/<topic>`,
   `fix/<topic>` or `docs/<topic>`.

3. Make the change, and run the full verification:

   ```bash
   script/ci
   ```

   It runs every check that continuous integration (CI) runs, in this order:

   - Every Swift file under `Sources/` and `Tests/` is wrapped in `#if MAP_LOCAL_ENABLED`,
     so Release builds compile none of it (`script/lint-guard`).
   - Every action the workflows use is pinned to a full commit SHA
     (`script/lint-workflows`).
   - Each document and its Korean copy match, and their relative links and heading anchors
     resolve
     (`script/check-doc-pairs`, `script/check-doc-links`).
   - The panel's tests pass and the panel builds (`script/build-panel`). Then `script/ci`
     checks that the committed `EmbeddedPanel.swift` is unchanged by that build, so
     running `script/build-panel` alone rewrites the file and does not check it.
   - `swift test` passes.
   - The check scripts themselves pass their tests against fake apps and repositories
     (`script/test-verify-release`).
   - The example apps are archived, and each archive passes or fails
     `script/verify-release` as expected, so a Release build is proven to carry no trace
     of the plugin (`script/verify-controls`).

   If you changed the panel, run `script/build-panel` and commit the regenerated
   `Sources/NectoMapLocalPlugin/EmbeddedPanel.swift`.

4. Push the branch to your fork, and open a pull request against `main` of this
   repository. Fill in the Test Plan section of the template.

### Building from source

```bash
cd Panel && npm ci && cd ..   # Node 22.12+; installs @necto/bridge from Necto's release
script/build-panel            # tests the panel, builds it and embeds it into EmbeddedPanel.swift
swift test                    # Swift tests (macOS)
script/ci                     # everything CI runs, including the release archive checks (Xcode 26 or later)
```

The panel is embedded in the Swift module as base64 strings. It is not shipped as a
resource bundle, so a release build carries no trace of it, and `script/verify-release`
can prove that. [docs/design.md](docs/design.md) explains why, under "The panel rides
inside the Swift module".

### Dependencies are not pinned

`Package.resolved` is not committed, as in Necto's device plugin template. This is a
library, and Swift Package Manager (SwiftPM) ignores a dependency's `Package.resolved`. An
app resolves `necto` from the range in `Package.swift`, even if this repository committed a
`Package.resolved`. It does not fetch `swift-clocks` at all, because only the tests use it. Without a committed file, `swift test` here
resolves the same way an app does, so CI tests what apps get. The weekly
`script/check-necto-latest` job covers Necto releases beyond the declared range.

The panel is different: `Panel/package-lock.json` is committed, and `npm ci` installs from
it. The built panel ships inside the package, so its build must be reproducible.

Locally, SwiftPM still writes a `Package.resolved` (ignored by git) and keeps using it, so
a local `script/ci` can test an older Necto than CI resolves. Run `swift package update`
first if the local result must match what CI resolves.

### Releasing

To release a version such as `0.1.1`:

1. Set the version in `Panel/public/manifest.json` to `0.1.1`.
2. Add one `## 0.1.1` section to `CHANGELOG.md`, and say in it what changed.
3. Point the download URL in
   [docs/release-builds.md](docs/release-builds.md#block-a-release-in-ci) and
   `docs/release-builds-ko.md` at `0.1.1`.
4. Push the tag `0.1.1`. Use the bare version number, without a `v` prefix (`0.1.1`, not
   `v0.1.1`).

`script/prepare-release` refuses the tag when any of steps 1 to 3 is missing. The release notes
end with the SHA-256 of `verify-release`, which users pin in their CI.

Turn on GitHub's immutable releases in the repository settings before the first tag.
Without them a published asset can be replaced, and the pinned hash is then the only thing
that notices.

### Discuss large changes in an issue first

Open an issue and agree on an approach with a maintainer before you start work on a
change that:

- adds an operation to `Panel/public/manifest.json`, or changes an existing operation's
  input or output. The panel, the CLI and saved configuration files depend on these
  operations;

- changes the configuration file format or how rules match a request;

- changes how the plugin is kept out of release builds;

- changes a principle or scenario in [docs/experience.md](docs/experience.md).

Everything else needs no issue — a bug fix with a reproduction, a documentation fix,
added tests, a small improvement inside one module. Open the pull request directly.

## License

Contributing means agreeing that your contributions are distributed under the
[MIT License](LICENSE).
