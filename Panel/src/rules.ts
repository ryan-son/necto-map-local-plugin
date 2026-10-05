//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "./localization";
import type { RequestEvent, ResponseSpec, Rule } from "./types";

export function isRule(entry: unknown): entry is Rule {
  if (typeof entry !== "object" || entry === null) return false;
  const candidate = entry as Partial<Rule>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.match === "object" &&
    typeof candidate.active === "string" &&
    typeof candidate.responses === "object"
  );
}

export function uniqueId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/// Response names are read by people, so duplicates count up: `base`, `base 2`, `base 3`.
export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

const slug = (method: string, path: string) =>
  `${method}-${path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rule";

/// An empty JSON 200, written as body text with its content type like every response the
/// panel writes, so a configuration does not mix in the legacy `json` key.
export const emptyJSONResponse = (): ResponseSpec => ({
  status: 200,
  headers: { "Content-Type": "application/json" },
  body: "{}",
});

export function newRule(
  existingIds: string[],
  seed?: { method: string; host?: string; path: string; query?: Record<string, string> },
): Rule {
  const match = seed ?? { method: "GET", path: "/" };
  return {
    id: uniqueId(slug(match.method, match.path), existingIds),
    enabled: true,
    tags: [],
    match: { ...match },
    active: "ok",
    responses: { ok: emptyJSONResponse() },
  };
}

/// The real response is not carried over; capturing (`traffic/capture`) is the only way to
/// do that. The query becomes a condition only when the user asks for it.
export function ruleFromRequest(event: RequestEvent, existingIds: string[], withQuery = false): Rule {
  const query = withQuery && Object.keys(event.query).length > 0 ? { query: { ...event.query } } : {};
  return newRule(existingIds, { method: event.method.toUpperCase(), host: event.host, path: event.path, ...query });
}

/// `?key=value&key=value` in insertion order, or an empty string.
export function queryLabel(query: Record<string, string> | undefined): string {
  const pairs = Object.entries(query ?? {});
  return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
}

/// A rule as the user knows it: method, path and query conditions rather than its internal
/// id. The conditions are what tell rules on the same path apart.
export function ruleLabel(rule: Rule): string {
  const query = queryLabel(rule.match.query);
  return `${rule.match.method} ${rule.match.path}${query ? ` ${query}` : ""}`;
}

export interface QueryRow { key: string; value: string }

/// Reads the condition rows being edited into the engine's `match.query` (string to string),
/// skipping rows that are entirely empty. An empty or repeated key would silently merge or
/// lose its meaning once in an object, so such a row gets a problem instead.
export function readQuery(
  rows: QueryRow[],
):
  { ok: true; query: Record<string, string> } | { ok: false; problems: Array<string | undefined> } {
  // Without a prototype, a `__proto__` key stays a condition.
  const query: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  const problems = rows.map((row) => {
    if (row.key === "" && row.value === "") return undefined;
    // Untrimmed, two keys differing only in whitespace would both be required, and no
    // request could match.
    const key = row.key.trim();
    if (key === "") return t("Enter a key");
    // The engine splits the request's query on & and = before comparing keys, so a key
    // containing them can never match.
    if (/[=&?#]/.test(key)) return t("A key can't contain = & ? #");
    if (seen.has(key)) return t("The same key already exists");
    seen.add(key);
    query[key] = row.value;
    return undefined;
  });
  return problems.some(Boolean) ? { ok: false, problems } : { ok: true, query };
}

/// The engine percent-decodes a request's query values before comparing them, so a value
/// written as %XX cannot match as written. This suggests the decoded form without blocking
/// the save.
export function queryValueHint(value: string): string | undefined {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return undefined; }
  return decoded === value ? undefined : t("%XX is decoded before matching — type the original characters (“{decoded}”)", { decoded });
}
