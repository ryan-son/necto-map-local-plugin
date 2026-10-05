//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "../localization";
import type { NetworkSummary, RequestEvent } from "../types";
import { pairKey, splitURL } from "./keys";

export const orderWarningText = () =>
  t(
    "Mocked requests don't appear in Necto's records. Either Necto's network plugin was registered before Map Local, or the app uses a session other than URLSession.shared. Put NectoSDK.register(NectoMapLocalPlugin()) first",
  );
const settleMs = 1000;
const nearMs = 50;
const threshold = 3;
/// The host queues records from before ready() and flushes them right after subscribing.
/// That burst looks mispaired, so it is not counted.
const graceMs = 2000;
/// Our events can arrive after Necto's record, since they are sent when the response
/// finishes, so candidates for mocks are kept for a generous while.
const candidateMs = 10_000;
/// `at` is the device clock, used only for how close a pair is; `arrived` is the panel's
/// clock, used for settling and pruning. The two are never compared.
type Item = { key: string; at: number; arrived: number };

/// Inserts in device-time order; usually that is the end.
function insert(list: Item[], item: Item) {
  let i = list.length;
  while (i > 0 && list[i - 1].at > item.at) i -= 1;
  list.splice(i, 0, item);
}

/// Removes and returns the earliest item within ±nearMs.
function takeNear(list: Item[] | undefined, at: number): Item | undefined {
  if (!list) return undefined;
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].at < at - nearMs) lo = mid + 1; else hi = mid; }
  if (lo >= list.length || list[lo].at > at + nearMs) return undefined;
  return list.splice(lo, 1)[0];
}

function push(buckets: Map<string, Item[]>, item: Item) {
  const list = buckets.get(item.key);
  if (list) insert(list, item); else buckets.set(item.key, [item]);
}

/// Lists are in device-time order, which can disagree with arrival order, so filter rather
/// than cut from the front.
function prune(buckets: Map<string, Item[]>, before: number) {
  for (const [key, list] of buckets) {
    if (!list.some((i) => i.arrived < before)) continue;
    const kept = list.filter((i) => i.arrived >= before);
    if (kept.length === 0) buckets.delete(key); else buckets.set(key, kept);
  }
}

/// Detects the Necto network plugin registered ahead of Map Local, from evidence that arrives
/// live after subscribing during this launch. Each pair is consumed once. Judged evidence is
/// dropped and the warning latches until the next launch, so judging never slows down as
/// records pile up.
export class OrderDetector {
  private launch?: string;
  private started = false;
  private startedAt = 0;
  private latched = false;
  private seenNet = new Set<string>();
  private seenOurs = new Set<number>();
  /// Mocks and Necto records not judged yet, in arrival order.
  private mocks: Item[] = [];
  private nets: Item[] = [];
  /// Necto records already paired whose leftover passthroughs are still to be looked for.
  private owned: Item[] = [];
  /// Pairing candidates: Necto records for mocks, and passthroughs for Necto records. By key,
  /// in time order.
  private netsForMocks = new Map<string, Item[]>();
  private passes = new Map<string, Item[]>();
  private unmatched = 0;
  private doubled = 0;

  constructor(private readonly clock: () => number = () => Date.now()) {}

  reset(launchID: string) {
    if (this.launch === launchID) return;
    this.launch = launchID; this.started = false; this.latched = false;
    this.seenNet = new Set(); this.seenOurs = new Set();
    this.mocks = []; this.nets = []; this.owned = []; this.netsForMocks = new Map(); this.passes = new Map();
    this.unmatched = 0; this.doubled = 0;
  }

  /// Reattaching replays the list in a burst too, so the grace period starts again.
  networkStarted() { this.started = true; this.startedAt = this.clock(); }

  private inGrace(now: number) { return now - this.startedAt < graceMs; }

  liveNetwork(record: NetworkSummary) {
    if (!this.started || this.latched || this.seenNet.has(record.id)) return;
    this.seenNet.add(record.id);
    const split = splitURL(record.url);
    const arrived = this.clock();
    const item = {
      key: pairKey(record.method, split.host, split.path, split.query),
      at: record.startedAtMilliseconds,
      arrived,
    };
    // A Necto record during the grace period only covers mocks: it can keep the warning off
    // but never turn it on.
    if (!this.inGrace(arrived)) this.nets.push(item);
    push(this.netsForMocks, item);
  }

  liveOurs(event: RequestEvent) {
    const mocked = "mocked" in event.outcome;
    if (
      !this.started ||
      this.latched ||
      this.seenOurs.has(event.seq) ||
      (!mocked && !("passthrough" in event.outcome))
    )
      return;
    this.seenOurs.add(event.seq);
    const arrived = this.clock();
    if (this.inGrace(arrived)) return;
    const item = { key: pairKey(event.method, event.host, event.path, event.query), at: event.date, arrived };
    if (mocked) this.mocks.push(item); else push(this.passes, item);
  }

  warning(): boolean {
    if (!this.started) return false;
    if (this.latched) return true;
    const now = this.clock();

    // One Necto record covers one mock. It takes three missing to warn; a single miss is
    // noise.
    let m = 0;
    while (m < this.mocks.length && now - this.mocks[m].arrived >= settleMs) {
      const e = this.mocks[m++];
      if (!takeNear(this.netsForMocks.get(e.key), e.at)) this.unmatched += 1;
    }
    this.mocks.splice(0, m);

    // A passthrough counts as recorded twice only if one is still left beside a Necto record
    // after pairing them one to one. Pairing waits until the passthroughs nearby are a
    // second old; looking for leftovers waits until every neighbouring record that could
    // claim the same passthrough has paired.
    const paired = now - settleMs - nearMs;
    let n = 0;
    while (n < this.nets.length && this.nets[n].arrived <= paired) {
      const net = this.nets[n++];
      takeNear(this.passes.get(net.key), net.at);
      this.owned.push(net);
    }
    this.nets.splice(0, n);
    n = 0;
    while (n < this.owned.length && this.owned[n].arrived <= paired - 2 * nearMs) {
      const net = this.owned[n++];
      if (takeNear(this.passes.get(net.key), net.at)) this.doubled += 1;
    }
    this.owned.splice(0, n);

    // Anything that could pair with older evidence has already been judged.
    prune(this.netsForMocks, now - candidateMs);
    prune(this.passes, paired - 3 * nearMs);

    this.latched = this.unmatched >= threshold || this.doubled >= threshold;
    return this.latched;
  }
}
