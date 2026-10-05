# Import, export and the CLI

[한국어](cli-ko.md)

`necto-cli` is Necto's command-line interface (CLI). It can do everything the panel does
to the configuration. This page covers the shared file format, the operations, and how
they fail.

## Sharing a configuration

The panel and the CLI use the same file:

```json
{"force": true, "configuration": { … }}
```

The panel's "Paste configuration" reads this format, and "Copy configuration" produces it.
A copied configuration contains every value unmasked, tokens included; see
[What the panel can see](usage.md#what-the-panel-can-see).

A shared configuration carries rules, not data on a server. If a site, account or record
exists only in a mocked response, another device shows it only when the rule that mocks it
is shared too. For example, a site that a mocked search returns.

## necto-cli operations

`necto-cli` controls the running Necto app, so keep Necto open with your app connected.
First find the IDs that every command needs:

```bash
necto-cli device list --json
necto-cli plugin help io.github.ryan-son.maplocal --device <id> --app <bundle>
```

1. `device list --json` lists each connected device with its `id`, and the apps on it with
   their `bundleID`. Use them as `<id>` and `<bundle>`.
2. `plugin help` without an operation lists Map Local's operations.

The plugin ID is `io.github.ryan-son.maplocal`, and it will not change. Necto treats a
different ID as a different plugin, with its own permissions and storage.

| Operation | Call with | What it does |
| --- | --- | --- |
| `maplocal.state` | `plugin send` | Returns the configuration, its `revision` and the engine status |
| `maplocal.state.observe` | `plugin subscribe` | Sends the same value as `maplocal.state` now, and again after every change |
| `maplocal.configuration.export` | `plugin send` | Returns the whole configuration with every value as-is, tokens included |
| `maplocal.configuration.replace` | `plugin send` | Replaces the whole configuration |
| `maplocal.configuration.patch` | `plugin send` | Changes some top-level settings (`enabled`, `allowedHosts`, `unmatched`, `order`, or `authMocked:false` alone to clear the mocked-session warning) and keeps the rest |
| `maplocal.rule.upsert` | `plugin send` | Adds a rule, or replaces the rule with the same `id` |
| `maplocal.rule.delete` | `plugin send` | Deletes a rule |
| `maplocal.rule.setActive` | `plugin send` | Switches the response a rule answers with |
| `maplocal.requests.list` | `plugin send` | Returns the most recent requests since launch, up to 500 |
| `maplocal.requests.observe` | `plugin subscribe` | Sends one event for every request the app makes from now on |

`network.list`, `network.detail` and `network.observe` return what Necto's network plugin
recorded. They are available only when the app registers that plugin.

`maplocal.configuration.export` returns `{"configuration": …}`. With `"force": true` added,
that object is the shared file above.

For example, these commands replace the configuration from a file, switch a rule's
response, and turn Map Local on:

```bash
necto-cli plugin send io.github.ryan-son.maplocal maplocal.configuration.replace --device <id> --app <bundle> --input-file mocks.json
necto-cli plugin send io.github.ryan-son.maplocal maplocal.rule.setActive --device <id> --app <bundle> --input '{"baseRevision":3,"id":"login","response":"ok"}'
necto-cli plugin send io.github.ryan-son.maplocal maplocal.configuration.patch --device <id> --app <bundle> --input '{"baseRevision":3,"enabled":true}'
```

Every operation declares its input and output in `Panel/public/manifest.json`: required
keys, types, enums and limits. This prints them:

```bash
necto-cli plugin help io.github.ryan-son.maplocal <operation> --device <id> --app <bundle>
```

Build the input from the schema, not from the operation's description.

Every write needs `baseRevision`: the `revision` from `maplocal.state`, or from the last
successful write. Only `maplocal.configuration.replace` can send `"force":true` instead.

Necto's [control socket documentation](https://github.com/toss/necto/blob/0.2.0/docs/control-socket.md)
covers every `necto-cli` command, such as `plugin subscribe` with its `--limit` and
`--timeout` options.

## Errors

Only two failures come back as a result, with `"ok":false`:

| Answer | Meaning | What to do |
| --- | --- | --- |
| `"reason":"conflict"` | The `baseRevision` is stale | Read `maplocal.state` and try again |
| `"reason":"readOnly"` | The configuration can't be written | `issues` in `maplocal.state` says why |

Everything else fails the call, so the CLI exits with a nonzero exit code:

| Code | When |
| --- | --- |
| `INVALID_INPUT` | Malformed input. Necto checks the schema first, then the app checks again |
| `OPERATION_UNAVAILABLE` | A rule or response that doesn't exist |
| `PROVIDER_FAILED` | A failed save |

An error from the app carries `reason`, `code`, `params`, an English `message` and
`revision` in `details`. The codes are stable, and are listed in
[Fixtures/message-codes.json](../Fixtures/message-codes.json).

## Binding versions

Each operation in the manifest names its binding: the bridge in the app that answers it,
such as `necto.device.maplocal.state`. Every `necto.device.maplocal.*` binding is version 1.

A change that breaks an existing caller ships under a new binding version. That includes
removing or renaming a key, a stricter schema, and a result that changes from success to
an error, or from an error to success. Adding an optional input key or an output field
does not need a new version.
