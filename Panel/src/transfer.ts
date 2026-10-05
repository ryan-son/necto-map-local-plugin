//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "./localization";
import { readJSON } from "./json";
import type { Configuration } from "./types";

const looksLikeConfiguration = (value: unknown): value is Configuration =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as Configuration).version === "number";

/// Accepts both the bare configuration and the `{"configuration": …}` envelope, so a paste
/// into the panel and `necto-cli --input-file` take the same file. The app validates it.
export function parseImport(text: string): { configuration: Configuration } | { error: string } {
  const read = readJSON(text);
  if (!read.ok) return { error: t("Not JSON: {message}", { message: read.message }) };
  const value = read.value;
  if (typeof value === "object" && value !== null && "configuration" in value) {
    const inner = (value as { configuration: unknown }).configuration;
    return looksLikeConfiguration(inner) ? { configuration: inner } : { error: t("The configuration has no version") };
  }
  return looksLikeConfiguration(value)
    ? { configuration: value }
    : { error: t('Not a configuration (an object with a version) or a {"configuration": …} envelope') };
}

export function exportText(configuration: Configuration): string {
  return JSON.stringify({ force: true, configuration }, null, 2);
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jwtLike = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/;
const credentialHeaders = new Set(["authorization", "cookie", "set-cookie"]);
const secretName = /token|secret|password|api[-_]?key|session/i;

const filled = (value: unknown) => (typeof value === "string" ? value.trim() !== "" : typeof value === "number");

/// Whether a key named like a secret holds a value anywhere in the JSON, arrays and nested
/// objects included.
function hasSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretKey);
  if (!isObj(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => (secretName.test(key) && filled(nested)) || hasSecretKey(nested),
  );
}

const parsedBody = (body: unknown) => {
  if (typeof body !== "string") return undefined;
  try { return JSON.parse(body) as unknown; } catch { return undefined; }
};

function ruleLooksSecret(rule: Record<string, unknown>): boolean {
  // A rule the user tagged as auth carries a token by definition; an opaque token cannot
  // be recognised by its shape.
  if (Array.isArray(rule.tags) && rule.tags.includes("auth")) return true;
  const match = isObj(rule.match) ? rule.match : {};
  if (hasSecretKey(match.query)) return true;
  return Object.values(isObj(rule.responses) ? rule.responses : {}).filter(isObj).some((spec) => {
    const headers = Object.entries(isObj(spec.headers) ? spec.headers : {});
    if (
      headers.some(
        ([name, value]) =>
          (credentialHeaders.has(name.toLowerCase()) || secretName.test(name)) && filled(value),
      )
    )
      return true;
    return hasSecretKey(spec.json) || hasSecretKey(parsedBody(spec.body));
  });
}

/// Copying the configuration copies values as they are. When something looks like a token,
/// one line asks for a look before sharing; the values themselves are never touched.
/// Looks like a token: JWT-shaped text, a rule tagged auth, a non-empty Authorization,
/// Cookie or Set-Cookie response header, and a response header, query condition key or
/// JSON body key named token, secret, password, api key or session.
export function secretWarning(configuration: Configuration): string | undefined {
  const named = (configuration.rules as unknown[]).filter(isObj).some(ruleLooksSecret);
  if (named || jwtLike.test(JSON.stringify(configuration))) return t("It contains values that look like tokens — check before you share it");
  return undefined;
}
