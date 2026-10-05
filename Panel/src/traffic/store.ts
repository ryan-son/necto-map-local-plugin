//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { NetworkDetail, NetworkState, NetworkSummary, RequestEvent, ResultKind, TrafficEntry } from "../types";
import { pairKey, splitURL } from "./keys";

type Result = Pick<TrafficEntry, "result" | "mockedBy">;
type Parts = ReturnType<typeof splitURL> & { url: string; key: string };

const windowMs = 50;
const staleMs = 10_000;
const rank: Record<NetworkState, number> = { pending: 0, completed: 1, failed: 1 };

/// Map Local answered with an error instead of a response.
function failedByUs(event: RequestEvent): boolean {
  const outcome = event.outcome;
  if ("mocked" in outcome) return outcome.mocked.error !== undefined;
  if ("unmocked" in outcome) return outcome.unmocked.error !== undefined;
  return false;
}

function resultOf(event: RequestEvent): Result {
  const outcome = event.outcome;
  if ("mocked" in outcome)
    return {
      result: "mocked",
      mockedBy: { rule: outcome.mocked.rule, response: outcome.mocked.response },
    };
  if ("unmocked" in outcome) return { result: "blocked" };
  return { result: "passthrough" };
}

/// State only moves forward, and a field with a value is never overwritten by a missing one.
function merge(prev: NetworkSummary, next: NetworkSummary): NetworkSummary {
  const merged: NetworkSummary = { ...prev };
  for (const [key, value] of Object.entries(next))
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  if (rank[prev.state] > rank[next.state]) merged.state = prev.state;
  return merged;
}

/// The first source of a result: X-Map-Local in the detail. Undefined when inconclusive,
/// leaving it to pairing or unknown.
function resultOfDetail(detail: NetworkDetail): Result | undefined {
  const tag = Object.entries(detail.responseHeaders).find(([name]) => name.toLowerCase() === "x-map-local")?.[1];
  if (tag === "unmocked") return { result: "blocked" };
  if (tag) {
    const slash = tag.indexOf("/");
    return {
      result: "mocked",
      mockedBy:
        slash < 0
          ? { rule: tag, response: "" }
          : { rule: tag.slice(0, slash), response: tag.slice(slash + 1) },
    };
  }
  // A failure without the header may be a mocked error.
  if (detail.state === "failed") return { result: "unknown" };
  if (detail.state === "completed" && detail.statusCode !== undefined) return { result: "passthrough" };
  return undefined;
}

/// Necto's records are the primary source; our own events annotate them with a result.
export class TrafficStore {
  static readonly capacity = 1000;
  private launch?: string;
  private net = new Map<string, NetworkSummary>();
  private ours = new Map<number, RequestEvent>();
  private pairedOurs = new Map<string, number>();
  private usedSeqs = new Set<number>();
  private details = new Map<string, Result>();
  private rechecked = new Set<string>();
  private lastListedSeq = 0;
  private pinned?: string;
  private snapshot?: TrafficEntry[];
  private snapshotKeys?: Set<string>;
  /// The list is read several times per render, so it is rebuilt only when records change.
  private memo?: TrafficEntry[];
  private index?: Map<string, TrafficEntry>;
  private parts = new Map<string, Parts>();
  /// When the panel first received each Necto record, on the panel's clock. Kept apart so
  /// it is never compared with the device clock (`startedAt`).
  private arrived = new Map<string, number>();
  private resetListeners: Array<() => void> = [];
  /// Our events whose key changed on pairing, `ours:<seq>` to a Necto id. When Necto's
  /// subscription attaches late, requests already on screen change key only, and the keys
  /// the view holds (selection, pin, paused list) must keep pointing at them.
  private aliases = new Map<string, string>();

  constructor(
    private readonly onChange: () => void,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  get paused() {
    return this.snapshot !== undefined;
  }
  get launchID() {
    return this.launch;
  }

  /// Called when a new launch clears the store. The view's selection and detail still hold
  /// keys from the previous launch, and `ours:<seq>` restarts from 1 on every launch.
  onReset(listener: () => void) {
    this.resetListeners.push(listener);
  }
  /// How many requests resuming would reveal. Our event paired with a Necto record counts
  /// as one request.
  get pendingWhilePaused() {
    return this.arrivedSincePause().length;
  }

  /// Requests that arrived while paused, current values, newest first. Empty when not
  /// paused.
  arrivedSincePause(): TrafficEntry[] {
    const keys = this.snapshotKeys;
    return keys ? this.live().filter((e) => !keys.has(e.key)) : [];
  }

  /// The paired key for an old `ours:<seq>` key, or the key unchanged.
  resolve(key: string): string {
    return this.aliases.get(key) ?? key;
  }

  reset(launchID: string) {
    if (this.launch === launchID) return;
    this.launch = launchID;
    this.aliases.clear();
    this.net.clear();
    this.ours.clear();
    this.pairedOurs.clear();
    this.usedSeqs.clear();
    this.details.clear();
    this.rechecked.clear();
    this.parts.clear();
    this.arrived.clear();
    this.changed();
    this.lastListedSeq = 0;
    this.snapshot = undefined;
    this.snapshotKeys = undefined;
    this.pinned = undefined;
    for (const listener of this.resetListeners) listener();
    this.onChange();
  }

  ingestNetwork(records: NetworkSummary[]) {
    this.changed();
    const now = this.clock();
    for (const r of records) {
      const prev = this.net.get(r.id);
      if (!prev) this.arrived.set(r.id, now);
      this.net.set(r.id, prev ? merge(prev, r) : r);
    }
    this.pair();
    this.trim();
    this.onChange();
  }

  ingestOurs(events: RequestEvent[], lastSeq?: number) {
    this.changed();
    for (const e of events) {
      if (lastSeq === undefined && e.seq <= this.lastListedSeq) continue;
      if (this.ours.has(e.seq)) continue;
      this.ours.set(e.seq, e);
    }
    if (lastSeq !== undefined) this.lastListedSeq = Math.max(this.lastListedSeq, lastSeq);
    this.pair();
    this.trim();
    this.onChange();
  }

  applyDetail(d: NetworkDetail) {
    const prev = this.net.get(d.id);
    if (!prev) return;
    this.changed();
    const { requestHeaders: _req, responseHeaders: _res, responseBody: _body, ...summary } = d;
    this.net.set(d.id, merge(prev, summary));
    const res = resultOfDetail(d);
    if (res) this.details.set(d.id, res);
    this.onChange();
  }

  pin(key: string | undefined) {
    this.pinned = key;
  }
  pause() {
    if (!this.snapshot) {
      this.snapshot = this.live();
      this.snapshotKeys = new Set(this.snapshot.map((e) => e.key));
      this.onChange();
    }
  }
  resume() {
    this.snapshot = undefined;
    this.snapshotKeys = undefined;
    this.onChange();
  }
  entries(): TrafficEntry[] {
    return this.snapshot ?? this.live();
  }
  /// Every request as it is now, newest first, regardless of pause: for what happened, not
  /// for what the paused list shows.
  allEntries(): TrafficEntry[] {
    return this.live();
  }
  /// The current value, regardless of pause.
  liveEntry(key: string): TrafficEntry | undefined {
    this.index ??= new Map(this.live().map((e) => [e.key, e]));
    return this.index.get(key);
  }

  /// Pending records still pending ten seconds after the panel received them. Each is
  /// rechecked once; an id is never returned again.
  stalePending(): string[] {
    const now = this.clock();
    const ids = [...this.net.values()]
      .filter(
        (r) =>
          r.state === "pending" &&
          now - (this.arrived.get(r.id) ?? now) > staleMs &&
          !this.rechecked.has(r.id),
      )
      .map((r) => r.id);
    for (const id of ids) this.rechecked.add(id);
    return ids;
  }

  /// In order of Necto start time, pairs each record with the closest unused event of ours
  /// that has the same key and comes 0–50 ms later.
  private pair() {
    const byKey = new Map<string, RequestEvent[]>();
    for (const e of this.ours.values()) {
      if (this.usedSeqs.has(e.seq)) continue;
      const key = pairKey(e.method, e.host, e.path, e.query);
      const list = byKey.get(key);
      if (list) list.push(e);
      else byKey.set(key, [e]);
    }
    const unpaired = [...this.net.values()]
      .filter((r) => !this.pairedOurs.has(r.id))
      .sort((a, b) => a.startedAtMilliseconds - b.startedAtMilliseconds);
    for (const r of unpaired) {
      const candidates = byKey.get(this.partsOf(r).key) ?? [];
      let best: RequestEvent | undefined;
      for (const e of candidates) {
        const gap = e.date - r.startedAtMilliseconds;
        if (gap < 0 || gap > windowMs || this.usedSeqs.has(e.seq)) continue;
        if (!best || gap < best.date - r.startedAtMilliseconds) best = e;
      }
      if (best) {
        this.pairedOurs.set(r.id, best.seq);
        this.usedSeqs.add(best.seq);
        this.rekey(`ours:${best.seq}`, r.id);
      }
    }
  }

  /// The row in a paused list takes the new key too. It is the same request before and
  /// after resuming, and must not count as new.
  private rekey(old: string, key: string) {
    this.aliases.set(old, key);
    if (this.pinned === old) this.pinned = key;
    if (!this.snapshot || !this.snapshotKeys?.has(old)) return;
    this.snapshot = this.snapshot.map((e) => (e.key === old ? { ...e, key } : e));
    this.snapshotKeys.add(key);
  }

  private changed() {
    this.memo = undefined;
    this.index = undefined;
  }

  private partsOf(record: NetworkSummary): Parts {
    const cached = this.parts.get(record.id);
    if (cached?.url === record.url) return cached;
    const split = splitURL(record.url);
    const parts = {
      ...split,
      url: record.url,
      key: pairKey(record.method, split.host, split.path, split.query),
    };
    this.parts.set(record.id, parts);
    return parts;
  }

  private live(): TrafficEntry[] {
    if (this.memo) return this.memo;
    const out: TrafficEntry[] = [];
    for (const r of this.net.values()) {
      const u = this.partsOf(r);
      const seq = this.pairedOurs.get(r.id);
      const fromOurs: Result =
        seq !== undefined ? resultOf(this.ours.get(seq)!) : { result: "unknown" as ResultKind };
      const detail = this.details.get(r.id);
      // A failure without X-Map-Local may be a mocked error or a request without a rule that
      // Map Local failed, so an inconclusive detail does not overrule a pair that says so.
      const res = detail && !(detail.result === "unknown" && fromOurs.result !== "passthrough") ? detail : fromOurs;
      out.push({
        key: r.id,
        networkID: r.id,
        method: r.method.toUpperCase(),
        host: u.host,
        path: u.path,
        query: u.query,
        url: r.url,
        startedAt: r.startedAtMilliseconds,
        durationMs: r.durationMilliseconds,
        status: r.statusCode,
        state: r.state,
        bytes: r.responseByteCount,
        ...res,
      });
    }
    for (const e of this.ours.values()) {
      if (this.usedSeqs.has(e.seq)) continue;
      out.push({
        key: `ours:${e.seq}`,
        method: e.method.toUpperCase(),
        host: e.host,
        path: e.path,
        query: e.query,
        startedAt: e.date,
        state: failedByUs(e) ? "failed" : "completed",
        status:
          "mocked" in e.outcome
            ? e.outcome.mocked.status
            : "unmocked" in e.outcome
              ? e.outcome.unmocked.status
              : undefined,
        ...resultOf(e),
      });
    }
    this.memo = out.sort((a, b) => b.startedAt - a.startedAt);
    return this.memo;
  }

  private trim() {
    const all = this.live();
    if (all.length <= TrafficStore.capacity) return;
    this.changed();
    for (const e of all.slice(TrafficStore.capacity)) {
      if (e.key === this.pinned) continue;
      if (e.networkID) {
        this.net.delete(e.networkID);
        this.details.delete(e.networkID);
        this.rechecked.delete(e.networkID);
        this.parts.delete(e.networkID);
        this.arrived.delete(e.networkID);
        const s = this.pairedOurs.get(e.networkID);
        this.pairedOurs.delete(e.networkID);
        if (s !== undefined) {
          this.ours.delete(s);
          this.usedSeqs.delete(s);
          this.aliases.delete(`ours:${s}`);
        }
      } else this.ours.delete(Number(e.key.slice("ours:".length)));
    }
  }
}
