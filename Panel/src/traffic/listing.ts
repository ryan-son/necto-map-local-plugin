//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { ResultKind, TrafficEntry } from "../types";
import { endpointTemplate, groupKey, sentQuery } from "./keys";
import { parseQuery } from "./match";

export type StatusChip = "2xx" | "3xx" | "4xx" | "5xx" | "failed";
export interface Filters { search: string; allowedOnly: boolean; statuses: Set<StatusChip>; results: Set<ResultKind> }
export const emptyFilters = (): Filters => ({ search: "", allowedOnly: true, statuses: new Set(), results: new Set() });

export function statusClass(e: TrafficEntry): StatusChip | undefined {
  if (e.state === "failed") return "failed";
  if (e.status === undefined) return undefined;
  return e.status >= 500 ? "5xx" : e.status >= 400 ? "4xx" : e.status >= 300 ? "3xx" : "2xx";
}

/// The text searched: method, host and path plus the query as the detail pane shows it. A
/// percent-encoded query is appended once more decoded, so either form finds it.
function searchText(e: TrafficEntry): string {
  const sent = sentQuery(e);
  const plain = Object.entries(parseQuery(sent)).map(([k, v]) => `${k}=${v}`).join("&");
  const decoded = plain && `?${plain}` !== sent ? `\n?${plain}` : "";
  return `${e.method} ${e.host}${e.path}${sent}${decoded}`.toLowerCase();
}

/// With no allowed hosts there is no host filter, so the list is not empty on first run.
export function visible(
  entries: TrafficEntry[],
  filters: Filters,
  allowedHosts: string[],
): { shown: TrafficEntry[]; hiddenByHost: number } {
  const byHost = filters.allowedOnly && allowedHosts.length > 0;
  const search = filters.search.trim().toLowerCase();
  let hiddenByHost = 0;
  const shown = entries.filter((entry) => {
    if (byHost && !allowedHosts.includes(entry.host)) {
      hiddenByHost += 1;
      return false;
    }
    if (search && !searchText(entry).includes(search)) return false;
    const status = statusClass(entry);
    if (filters.statuses.size > 0 && (status === undefined || !filters.statuses.has(status)))
      return false;
    if (filters.results.size > 0 && !filters.results.has(entry.result)) return false;
    return true;
  });
  return { shown, hiddenByHost };
}

export interface Group {
  key: string;
  method: string;
  host: string;
  template: string;
  samples: TrafficEntry[];
  firstSeen: number;
}

/// `entries` is newest first. `order` is the group order seen so far; only new groups are
/// appended.
export function groups(entries: TrafficEntry[], order: string[]): { groups: Group[]; order: string[] } {
  const byKey = new Map<string, Group>();
  for (const entry of entries) {
    const key = groupKey(entry);
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        method: entry.method.toUpperCase(),
        host: entry.host,
        template: endpointTemplate(entry.path),
        samples: [],
        firstSeen: entry.startedAt,
      };
      byKey.set(key, group);
    }
    group.samples.push(entry);
    group.firstSeen = Math.min(group.firstSeen, entry.startedAt);
  }
  const next = [...order];
  for (const e of [...entries].reverse()) { const k = groupKey(e); if (!next.includes(k)) next.push(k); }
  return { groups: next.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!), order: next };
}
