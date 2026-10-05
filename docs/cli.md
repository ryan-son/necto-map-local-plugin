# Import, export and the CLI

[한국어](cli-ko.md)

Everything the panel does to the configuration, `necto-cli` can do too. This page covers
the shared file format, the operations, and how they fail.

## Sharing a configuration

The panel and the CLI use the same file:

```json
{"force": true, "configuration": { … }}
```

"Paste configuration" in the panel reads it, and "Copy configuration" writes it. Copying
keeps values as they are, tokens included; see
[What the panel can see](usage.md).

A shared configuration carries rules, not data on a server. A site, account or record that
exists only in a mocked response is there on another device only if the rule that mocks it
is shared too. For example, a site returned by a mocked search.

## necto-cli operations

```bash
necto-cli plugin send io.github.ryan-son.maplocal maplocal.configuration.replace --device <id> --app <bundle> --input-file mocks.json
necto-cli plugin send io.github.ryan-son.maplocal maplocal.rule.setActive --device <id> --app <bundle> --input '{"baseRevision":3,"id":"login","response":"ok"}'
```

The plugin ID is `io.github.ryan-son.maplocal`, and it will not change. Necto treats a
different ID as a different plugin, with its own approval and storage.

Every operation declares its input and output in `Panel/public/manifest.json`: required
keys, types, enums and limits. This prints them:

```bash
necto-cli plugin help io.github.ryan-son.maplocal <operation> --device <id> --app <bundle>
```

Build input from the schema, not from prose.

Ordinary writes need `baseRevision`: the `revision` from `maplocal.state`.
`maplocal.configuration.replace` may send `"force":true` instead.

## Errors

Only two outcomes answer as data, with `"ok":false`:

| Answer | Meaning | What to do |
| --- | --- | --- |
| `"reason":"conflict"` | The `baseRevision` is stale | Read `maplocal.state` and try again |
| `"reason":"readOnly"` | The configuration can't be written | `issues` says why |

Everything else fails the call, so the CLI exits nonzero:

| Code | When |
| --- | --- |
| `INVALID_INPUT` | Malformed input. Necto checks the schema first, then the app checks again |
| `OPERATION_UNAVAILABLE` | A rule or response that doesn't exist |
| `PROVIDER_FAILED` | A failed save |

An error from the app carries `reason`, `code`, `params`, an English `message` and
`revision` in `details`. The codes are stable, and are listed in
[Fixtures/message-codes.json](../Fixtures/message-codes.json).

## Binding versions

Every `necto.device.maplocal.*` binding is version 1.

A change that breaks a caller ships under a new binding version. That includes removing or
renaming a key, a stricter schema, and a result that becomes an error, or the reverse.
Adding an optional input key or an output field does not.
