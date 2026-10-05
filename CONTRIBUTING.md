# Contributing to Map Local

English | [한국어](CONTRIBUTING-ko.md)

Thank you for your interest in Map Local for Necto.

## Reference

- The rules a change must survive — [AGENTS.md](AGENTS.md)
- How the panel must behave — [docs/experience.md](docs/experience.md)
- Why the plugin is built the way it is — [docs/design.md](docs/design.md)
- Using the plugin — [docs/usage.md](docs/usage.md)
- Keeping it out of release builds — [docs/release-builds.md](docs/release-builds.md)
- Import, export and the CLI contract — [docs/cli.md](docs/cli.md)
- Reporting a vulnerability — [SECURITY.md](SECURITY.md)

## Write in English

Write code, comments, test names, documentation and commit messages in English.
Documentation may include a Korean translation.

A Korean copy sits next to its document as `X-ko.md`, and the two change together.
`script/check-doc-pairs` fails when a pair differs in its headings (count and levels), its
number of code blocks, or its link targets. A Korean copy links to Korean copies where the
English links to English ones; the check reads them as the same target. Korean documents
are written in 해요체, in short, plain sentences, as Necto's Korean documents are; Korean UI
strings (the panel's dictionary and the in-app badge) use 합니다체, as Necto's built-in
plugins do. `script/check-doc-links` fails on a relative link that does not resolve.

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

   It checks the release-exclusion guard, that workflow actions are pinned to commits,
   and that documents and their Korean copies match and their links resolve. It tests and
   builds the panel, checks that the committed `EmbeddedPanel.swift`
   matches the panel source, runs `swift test`, and archives the example apps to prove
   the release build carries no trace of the plugin.
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

The panel is embedded in the Swift module as base64 strings, not shipped as a resource
bundle, so a release build carries no trace of it and `script/verify-release` can prove
that. [docs/design.md](docs/design.md) explains why, under "The panel rides inside the
Swift module".

### Dependencies are not pinned

`Package.resolved` is not committed, as in Necto's device plugin template. This is a
library: SwiftPM ignores a dependency's `Package.resolved`, so an app resolves `necto` and
`swift-clocks` from the ranges in `Package.swift`, whatever this repository pins. Leaving
the file out makes `swift test` here resolve the same way an app does, so CI tests what
apps get. The weekly `script/check-necto-latest` job covers Necto releases beyond the
declared range. The panel is different: `Panel/package-lock.json` is committed and
`npm ci` installs from it, because the built panel ships inside the package and must be
reproducible.

Locally, SwiftPM still writes a `Package.resolved` (ignored by git) and keeps using it, so
a local `script/ci` can test an older Necto than CI resolves. Run `swift package update`
first when a local result has to stand for CI's.

### Releasing

Push a bare semver tag (`0.1.1`, not `v0.1.1`) after setting the version in
`Panel/public/manifest.json`, adding a `## 0.1.1` section to `CHANGELOG.md` and pointing
the download URL in [docs/release-builds.md](docs/release-builds.md) and
`docs/release-builds-ko.md` at the new version; `script/prepare-release` refuses the tag
otherwise. The release notes end with the
SHA-256 of `verify-release`, which users pin in their CI.

Turn on GitHub's immutable releases in the repository settings before the first tag.
Without them a published asset can be replaced, and the pinned hash is then the only thing
that notices.

### Discuss large changes in an issue first

For the following changes, agree on an approach with a maintainer in an issue before
starting work:

- adds an operation to `Panel/public/manifest.json`, or changes an existing operation's
  input or output — the panel, the CLI and saved configuration files depend on them;

- changes the configuration file format or how rules match a request;

- changes how the plugin is kept out of release builds;

- changes a principle or scenario in [docs/experience.md](docs/experience.md).

Everything else needs no issue — a bug fix with a reproduction, a documentation fix,
added tests, a small improvement inside one module. Open the pull request directly.

## License

Contributing means agreeing that your contributions are distributed under the
[MIT License](LICENSE).
