//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { Configuration, Rule } from "../types";
import { normalizeHost } from "../hosts";

/// As in `PathTemplate.swift`: the segment counts must agree, and a `{…}` segment matches
/// any non-empty segment.
export function pathMatches(template: string, path: string): boolean {
  const templateSegments = template.split("/");
  const pathSegments = path.split("/");
  if (templateSegments.length !== pathSegments.length) return false;
  return templateSegments.every((segment, i) =>
    segment.startsWith("{") && segment.endsWith("}")
      ? pathSegments[i] !== ""
      : segment === pathSegments[i],
  );
}

/// As `URLComponents.queryItems` reads it: `+` stays as it is, only percent escapes are
/// decoded, and a repeated key keeps its last value.
export function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const part of search.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const name = decode(eq < 0 ? part : part.slice(0, eq));
    out[name] = eq < 0 ? "" : decode(part.slice(eq + 1));
  }
  return out;
}

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

interface Target { method: string; host: string; path: string; query: Record<string, string> }

function target(method: string, url: string): Target | undefined {
  try {
    const parsed = new URL(url);
    return {
      method: method.toUpperCase(),
      host: normalizeHost(parsed.host) ?? parsed.hostname,
      path: parsed.pathname,
      query: parseQuery(parsed.search),
    };
  } catch {
    return undefined;
  }
}

const pathSegment = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})*$/;

/// As `PathTemplate.isEncoded`: every segment is a `{…}` template or holds only RFC 3986
/// path characters and `%` escapes, because requests are matched percent-encoded and any
/// other path could never match.
export function isEncodedPath(path: string): boolean {
  return path.split("/").every((segment) =>
    (segment.startsWith("{") && segment.endsWith("}")) || pathSegment.test(segment),
  );
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (o: Obj, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));
const isInt = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isStrings = (o: unknown) => isObj(o) && Object.values(o).every((v) => typeof v === "string");
const mockErrors = ["notConnectedToInternet", "connectionLost", "timedOut"];
const responseKeys = ["status", "headers", "body", "json", "delayMs", "error"];

function strictResponse(response: unknown): boolean {
  if (!isObj(response) || !onlyKeys(response, responseKeys)) return false;
  if (response.status !== undefined && !isInt(response.status, 100, 599)) return false;
  if (response.headers !== undefined && !isStrings(response.headers)) return false;
  if (response.body !== undefined && typeof response.body !== "string") return false;
  if (response.delayMs !== undefined && !isInt(response.delayMs, 0, 60_000)) return false;
  if (
    response.error !== undefined &&
    !(typeof response.error === "string" && mockErrors.includes(response.error))
  )
    return false;
  return response.status !== undefined || response.error !== undefined;
}

/// As `ConfigurationCodec.strictRule`. An entry the engine could not read and returned
/// verbatim is not a rule.
function strictRule(entry: unknown): Rule | undefined {
  if (!isObj(entry) || !onlyKeys(entry, ["id", "enabled", "tags", "match", "active", "responses"])) return undefined;
  if (typeof entry.id !== "string" || entry.id === "") return undefined;
  const match = entry.match;
  if (!isObj(match) || !onlyKeys(match, ["method", "host", "path", "query"])) return undefined;
  if (typeof match.method !== "string" || typeof match.path !== "string") return undefined;
  if (!match.path.startsWith("/") || match.path.includes("?") || match.path.includes("#")) return undefined;
  if (!isEncodedPath(match.path)) return undefined;
  if (
    match.host !== undefined &&
    !(typeof match.host === "string" && normalizeHost(match.host) !== undefined)
  )
    return undefined;
  if (
    entry.tags !== undefined &&
    !(Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === "string"))
  )
    return undefined;
  if (match.query !== undefined && !(isObj(match.query) && isStrings(match.query))) return undefined;
  if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") return undefined;
  const responses = entry.responses;
  if (
    !isObj(responses) ||
    Object.keys(responses).length === 0 ||
    !Object.values(responses).every(strictResponse)
  )
    return undefined;
  if (typeof entry.active !== "string" || !Object.hasOwn(responses, entry.active)) return undefined;
  return entry as unknown as Rule;
}

/// Only the rules the engine applies: unreadable entries and later entries with a repeated
/// id (`deduplicated`) are left out.
function liveRules(rules: Configuration["rules"]): Rule[] {
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const entry of rules as unknown[]) {
    const id = isObj(entry) && typeof entry.id === "string" ? entry.id : undefined;
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const rule = strictRule(entry);
    if (rule) out.push(rule);
  }
  return out;
}

function fits(rule: Rule, request: Target): boolean {
  if (rule.match.method.toUpperCase() !== request.method) return false;
  if (rule.match.host !== undefined && normalizeHost(rule.match.host) !== request.host) return false;
  if (!pathMatches(rule.match.path, request.path)) return false;
  return Object.entries(rule.match.query ?? {}).every(([key, value]) => request.query[key] === value);
}

const conditionCount = (r: Rule) => Object.keys(r.match.query ?? {}).length;

export interface QueryMiss {
  key: string;
  expected: string;
  /// Absent when the request has no such key.
  actual?: string;
}

/// The query conditions `rule` failed on, for a request whose method, host and path it fits,
/// read as the engine reads them. Empty when every condition holds; undefined when the rule
/// doesn't fit the request apart from its query.
export function queryMisses(rule: Rule, method: string, url: string): QueryMiss[] | undefined {
  const request = target(method, url);
  if (!request || !fits({ ...rule, match: { ...rule.match, query: {} } }, request)) return undefined;
  return Object.entries(rule.match.query ?? {})
    .filter(([key, value]) => request.query[key] !== value)
    .map(([key, expected]) => (key in request.query ? { key, expected, actual: request.query[key] } : { key, expected }));
}

/// Every rule the engine would consider for this request, on or off as `enabled` says, in
/// list order. Allowed hosts and the master switch are ignored.
export function matchingRules(rules: Configuration["rules"], method: string, url: string, enabled: boolean): Rule[] {
  const request = target(method, url);
  if (!request) return [];
  return liveRules(rules).filter((rule) => (rule.enabled !== false) === enabled && fits(rule, request));
}

/// The matching rule with the most query conditions, the earlier one on a tie, as
/// `Matcher.decide` picks.
function mostSpecific(rules: Configuration["rules"], method: string, url: string, enabled: boolean): Rule | undefined {
  let best: Rule | undefined;
  for (const rule of matchingRules(rules, method, url, enabled))
    if (!best || conditionCount(rule) > conditionCount(best)) best = rule;
  return best;
}

/// The same decision as `Matcher.decide`, ignoring allowed hosts and the master switch;
/// capturing adds the host anyway.
export function pickRule(rules: Configuration["rules"], method: string, url: string): Rule | undefined {
  return mostSpecific(rules, method, url, true);
}

/// The disabled rule that would answer this request if turned on, chosen the way the
/// engine would choose.
export function matchingDisabledRule(rules: Configuration["rules"], method: string, url: string): Rule | undefined {
  return mostSpecific(rules, method, url, false);
}

export interface Overlap {
  rule: Rule;
  /// Which of the two answers a request both match.
  answers: "this" | "other";
  reason: "conditions" | "order";
}

/// Whether one request can fit both: the same method, hosts that agree or one left empty,
/// paths that agree segment by segment where neither is a `{…}`, and no query key asked to
/// hold two values.
function canShare(a: Rule, b: Rule): boolean {
  if (a.match.method.toUpperCase() !== b.match.method.toUpperCase()) return false;
  if (a.match.host !== undefined && b.match.host !== undefined && normalizeHost(a.match.host) !== normalizeHost(b.match.host))
    return false;
  const as = a.match.path.split("/");
  const bs = b.match.path.split("/");
  if (as.length !== bs.length) return false;
  if (!as.every((s, i) => s === bs[i] || (isParam(s) && bs[i] !== "") || (isParam(bs[i]) && s !== ""))) return false;
  const bq = b.match.query ?? {};
  return Object.entries(a.match.query ?? {}).every(([key, value]) => !Object.hasOwn(bq, key) || bq[key] === value);
}

const isParam = (s: string) => s.startsWith("{") && s.endsWith("}");

/// The most specific request both fit: each fixed segment from whichever rule has one, both
/// rules' query conditions, and their host.
function sharedRequest(a: Rule, b: Rule): Target {
  const bs = b.match.path.split("/");
  const path = a.match.path.split("/").map((s, i) => (!isParam(s) ? s : !isParam(bs[i]) ? bs[i] : "x")).join("/");
  const host = a.match.host ?? b.match.host;
  return {
    method: a.match.method.toUpperCase(),
    host: (host !== undefined ? normalizeHost(host) : undefined) ?? "",
    path,
    query: { ...(b.match.query ?? {}), ...(a.match.query ?? {}) },
  };
}

/// For each rule that is on and can match a request `rule` also matches, which rule the
/// engine (`Matcher.decide`) gives such a request to: more query conditions, then the earlier
/// in the list, across all rules, so a third rule that shadows both is named instead.
/// `rule` is taken as it is now and keeps its place in the list even while an edit is
/// invalid; a draft not yet in the list counts as last.
export function overlaps(rules: Configuration["rules"], rule: Rule): Overlap[] {
  if (rule.enabled === false || !rule.match.path.startsWith("/") || !isEncodedPath(rule.match.path)) return [];
  const seen = new Set<string>();
  const ordered: Rule[] = [];
  let placed = false;
  for (const entry of rules as unknown[]) {
    const id = isObj(entry) && typeof entry.id === "string" ? entry.id : undefined;
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    if (id === rule.id) { ordered.push(rule); placed = true; continue; }
    const live = strictRule(entry);
    if (live && live.enabled !== false) ordered.push(live);
  }
  if (!placed) ordered.push(rule);
  const found: Overlap[] = [];
  const named = new Set<string>();
  for (const other of ordered) {
    if (other === rule || !canShare(rule, other)) continue;
    const request = sharedRequest(rule, other);
    let winner: Rule | undefined;
    for (const candidate of ordered)
      if (fits(candidate, request) && (!winner || conditionCount(candidate) > conditionCount(winner))) winner = candidate;
    if (!winner || named.has(winner.id)) continue;
    const loser = winner === rule ? other : rule;
    const reason = conditionCount(winner) > conditionCount(loser) ? "conditions" : "order";
    if (winner === rule) found.push({ rule: other, answers: "this", reason });
    else { named.add(winner.id); found.push({ rule: winner, answers: "other", reason }); }
  }
  return found;
}
