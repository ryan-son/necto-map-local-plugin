//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "./localization";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/// Looks at one grapheme, as Swift's `Character` does: `.`, `-`, `_`, or a first code point
/// that is alphabetic or numeric. A decomposed é (e + U+0301) or a Devanagari vowel sign is
/// then accepted exactly as the engine accepts it.
const hostCharacter = (grapheme: string) =>
  grapheme === "." || grapheme === "-" || grapheme === "_" || /^[\p{Alphabetic}\p{N}]/u.test(grapheme);

/// The same rule as the engine's `HostName.normalize` in
/// Sources/MapLocalCore/Configuration.swift: trim, lowercase, drop the scheme, the path, an
/// ASCII numeric port and trailing dots, and what is left is a host if it holds only
/// letters, digits and `.-_`. Both sides test against Fixtures/host-cases.json. This is the
/// only host normalisation in the panel.
export function normalizeHost(raw: string): string | undefined {
  let text = raw.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "").toLowerCase();
  const scheme = text.indexOf("://");
  if (scheme >= 0) text = text.slice(scheme + 3);
  const slash = text.indexOf("/");
  if (slash >= 0) text = text.slice(0, slash);
  const colon = text.lastIndexOf(":");
  if (colon >= 0 && /^[0-9]*$/.test(text.slice(colon + 1))) text = text.slice(0, colon);
  text = text.replace(/\.+$/, "");
  if (!text) return undefined;
  for (const { segment } of graphemes.segment(text)) if (!hostCharacter(segment)) return undefined;
  return text;
}

/// Reads an allowed host typed by the user. The engine would accept a Unicode host, but
/// `URL.host()` percent-encodes it on the request side and nothing would ever match, so a
/// host with Unicode left in it is refused with a pointer to punycode.
export function readHostInput(raw: string): { host: string } | { problem: string } {
  const host = normalizeHost(raw);
  if (host === undefined) return { problem: t("Can't read this as a host (e.g. api.example.com)") };
  if (/[^\x00-\x7f]/.test(host)) return { problem: t("Enter a Unicode host as punycode (xn--…)") };
  return { host };
}
