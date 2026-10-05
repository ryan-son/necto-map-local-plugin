# Security

English | [한국어](SECURITY-ko.md)

Report ordinary bugs and feature requests in
[Issues](https://github.com/ryan-son/necto-map-local-plugin/issues).

For a potential vulnerability, use **Security → Advisories → Report a vulnerability** on
[ryan-son/necto-map-local-plugin](https://github.com/ryan-son/necto-map-local-plugin/security/advisories/new).
This opens a private advisory that only the maintainers can see. Do not open a public issue
for it.

Do not include captured traffic, tokens, cookies, passwords or a copied configuration that
holds them. The panel keeps these values as they are, so a capture or an export from a real
app can carry live credentials. Describe the problem with made-up values instead.

Include the plugin version, the Necto version (Mac app and SDK), Xcode and iOS versions,
and whether the app runs on a simulator or a device over USB. Check the latest release when
it is safe to do so; support for older releases is not guaranteed.

Map Local is a debug tool, not for production. Keep it out of the builds you ship:

- Linking the package grants its panel full access to the plugin's device bridges,
  including every request record. Add it only to builds you control.
- Rules apply whenever Map Local is on, with or without Necto.
- `blockedHosts` keeps production from being mocked. It does not keep requests from
  reaching production.

See [What the panel can see](docs/usage.md) and
[Keeping Map Local out of release builds](docs/release-builds.md).
