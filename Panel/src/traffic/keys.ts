//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { normalizeHost } from "../hosts";
import { parseQuery } from "./match";
import type { TrafficEntry } from "../types";

export function splitURL(url: string): { host: string; path: string; query: Record<string, string> } {
  try {
    const parsed = new URL(url);
    return {
      host: normalizeHost(parsed.host) ?? parsed.hostname,
      path: parsed.pathname,
      query: parseQuery(parsed.search),
    };
  } catch {
    return { host: "", path: url, query: {} };
  }
}

/// Makes both sides produce the same key for the same request. Swift's `url.host()` can
/// keep brackets and a trailing dot, and `url.path()` gives "" for an empty path.
function pairHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (normalized.startsWith("["))
    return normalized.slice(1, normalized.indexOf("]") >= 0 ? normalized.indexOf("]") : undefined);
  if (normalized.split(":").length > 2) return normalized;
  return normalizeHost(normalized) ?? normalized;
}

const queryText = (query: Record<string, string>) =>
  Object.entries(query)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

/// The query the detail pane shows: exactly as the app sent it (`?a=1&b=2`) when there is a
/// Necto record, otherwise the engine's key=value pairs, or an empty string.
export function sentQuery(e: Pick<TrafficEntry, "url" | "query">): string {
  if (e.url !== undefined) {
    try { return new URL(e.url).search; } catch { /* fall through */ }
  }
  return Object.keys(e.query).length ? `?${queryText(e.query)}` : "";
}

export const fullURL = (e: TrafficEntry) => e.url ?? `https://${e.host}${e.path}${sentQuery(e)}`;

export const pairKey = (method: string, host: string, path: string, query: Record<string, string>) =>
  [
    method.toUpperCase(),
    pairHost(host),
    path || "/",
    ...Object.keys(query)
      .sort()
      .map((k) => `${k}=${query[k]}`),
  ].join(" ");

const idSegment = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;
export const endpointTemplate = (path: string) =>
  path
    .split("/")
    .map((s) => (idSegment.test(s) ? "{id}" : s))
    .join("/");
export const groupKey = (e: Pick<TrafficEntry, "method" | "host" | "path">) =>
  `${e.method.toUpperCase()} ${e.host} ${endpointTemplate(e.path)}`;
