//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { MapLocalAPI } from "./api";
import type { PanelModel } from "./model";
import type { OrderDetector } from "./traffic/order";
import type { TrafficStore } from "./traffic/store";
import type { View } from "./view";

/// Subscribes to state and request events. With no app, or once a subscription ends, the
/// panel shows that it is waiting and tries again; these are calls over Necto's loopback
/// bridge, not the network. When the app relaunches, Necto ends the old subscriptions with
/// PROVIDER_FAILED rather than TARGET_DISCONNECTED, or with no error at all (the
/// cancellation in `NectoAppModel` and `installDevice`). So any error code retries, and a
/// silent end is caught by the periodic health check.
export function connect(
  api: MapLocalAPI, model: PanelModel, view: View,
  traffic?: { store: TrafficStore; order: OrderDetector }, retryMs = 2000, healthMs = 5000,
): { stop: () => void; firstAttempt: Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribes: Array<() => Promise<void>> = [];
  /// Bumped on every retry. A late subscription, callback or health reply from an earlier
  /// attempt carries an older generation and is dropped.
  let generation = 0;
  /// The launch the subscription last reported. A health reply with a different one means
  /// the subscription is still hanging on to a previous launch.
  let subscribedLaunch: string | undefined;
  /// This generation's subscription to Necto's network records, kept apart from the rules
  /// connection: its failure or end does not drop the state and request subscriptions, and
  /// the health check reattaches only Necto's. Consecutive failures double the number of
  /// checks skipped before the next try.
  let networkSubscribed = false;
  let networkAttaching = false;
  let networkSkip = 0;
  let networkBackoff = 1;

  let attempting = false;

  /// Settles the launch before any record goes in. Any later, and the previous launch's
  /// lastSeq would drop new records and mix evidence from two launches.
  const adopt = (launchID: string) => { traffic?.store.reset(launchID); traffic?.order.reset(launchID); };

  const release = (unsubscribe: () => Promise<void>) => void unsubscribe().catch(() => undefined);

  const retry = () => {
    if (stopped || timer) return;
    generation += 1;
    subscribedLaunch = undefined;
    networkSubscribed = false;
    networkSkip = 0;
    networkBackoff = 1;
    view.connection = "waiting";
    view.render();
    for (const unsubscribe of unsubscribes) release(unsubscribe);
    unsubscribes = [];
    timer = setTimeout(() => { timer = undefined; void attempt(); }, retryMs);
  };

  const isCurrent = (mine: number) => !stopped && mine === generation;
  const keepIn = (mine: number, unsubscribe: () => Promise<void>) => {
    if (isCurrent(mine)) { unsubscribes.push(unsubscribe); return true; }
    release(unsubscribe);
    return false;
  };

  /// Subscribe first, then list, so a request finishing in between is not lost. The same
  /// holds when reattaching.
  const attachNetwork = async (t: NonNullable<typeof traffic>, mine: number) => {
    networkAttaching = true;
    try {
      let network: () => Promise<void>;
      try {
        network = await api.observeNetwork((record) => {
          if (!isCurrent(mine)) return;
          // The detector goes first so the warning redrawn by the store's onChange sees
          // this record.
          t.order.liveNetwork(record);
          t.store.ingestNetwork([record]);
        }, () => { if (isCurrent(mine)) networkSubscribed = false; });
      } catch {
        if (isCurrent(mine)) { networkSkip = networkBackoff; networkBackoff = Math.min(networkBackoff * 2, 12); }
        return;
      }
      if (!keepIn(mine, network)) return;
      networkSubscribed = true;
      networkBackoff = 1;
      t.order.networkStarted();
      const records = await api.networkRecords().catch(() => []);
      if (isCurrent(mine)) t.store.ingestNetwork(records);
    } finally { networkAttaching = false; }
  };

  const attempt = async () => {
    attempting = true;
    try { await subscribe(); } finally { attempting = false; }
  };

  const subscribe = async () => {
    const mine = generation;
    const current = () => isCurrent(mine);
    const keep = (unsubscribe: () => Promise<void>) => keepIn(mine, unsubscribe);
    try {
      const state = await api.observeState((next) => {
        if (!current()) return;
        subscribedLaunch = next.launchID;
        adopt(next.launchID);
        view.connection = "connected";
        model.receiveState(next);
      }, () => { if (current()) retry(); });
      if (!keep(state)) return;
      if (traffic && subscribedLaunch === undefined) {
        const first = await api.state();
        if (!current()) return;
        if (subscribedLaunch === undefined) { subscribedLaunch = first.launchID; adopt(first.launchID); }
      }
      const requests = await api.observeRequests((event) => {
        if (!current()) return;
        model.receiveRequest(event);
        // The order detector can only pair evidence gathered while Necto's subscription
        // is alive.
        if (networkSubscribed) traffic?.order.liveOurs(event);
        traffic?.store.ingestOurs([event]);
      }, () => { if (current()) retry(); });
      if (!keep(requests)) return;
      if (traffic) {
        const { available, reason } = await api.networkAvailability().catch(() => ({ available: false, reason: undefined }));
        if (!current()) return;
        view.networkAvailable = available;
        view.networkUnavailableReason = reason;
        if (available) await attachNetwork(traffic, mine);
        if (!current()) return;
        const listed = await api.requestsList().catch(() => undefined);
        if (!current()) return;
        if (listed) traffic.store.ingestOurs(listed.events, listed.lastSeq);
      }
      // The host can lose the first event, the replay of the current state, when it
      // arrives before ready(). Read the state directly so connecting does not depend on it.
      const latest = await api.state();
      if (!current()) return;
      if (subscribedLaunch === undefined) subscribedLaunch = latest.launchID;
      view.connection = "connected";
      const known = model.state;
      if (
        known === undefined ||
        known.launchID !== latest.launchID ||
        latest.revision > known.revision
      )
        model.receiveState(latest);
      else view.render();
    } catch {
      if (current()) retry();
    }
  };

  const health = setInterval(() => {
    if (stopped) return;
    if (view.connection !== "connected") {
      if (timer || attempting) return;
      api.state().then(() => { if (!stopped && !timer && !attempting) void attempt(); }, () => undefined);
      return;
    }
    const mine = generation;
    api.state().then((state) => {
      if (stopped || mine !== generation) return;
      if (subscribedLaunch !== undefined && state.launchID !== subscribedLaunch) { retry(); return; }
      if (state.revision > (model.state?.revision ?? -1)) model.receiveState(state);
    }, () => { if (!stopped && mine === generation) retry(); });
    if (!traffic || attempting) return;
    if (!networkSubscribed && !networkAttaching) {
      if (networkSkip > 0) networkSkip -= 1;
      else {
        networkAttaching = true;
        void api.networkAvailability().catch(() => ({ available: false, reason: undefined })).then(async ({ available, reason }) => {
          networkAttaching = false;
          if (isCurrent(mine) && (view.networkAvailable !== available || view.networkUnavailableReason !== reason)) {
            view.networkAvailable = available;
            view.networkUnavailableReason = reason;
            view.render();
          }
          if (
            available &&
            isCurrent(mine) &&
            !networkSubscribed &&
            !networkAttaching &&
            !attempting
          )
            await attachNetwork(traffic, mine);
        });
      }
    }
    // A new launch can keep the generation, when the state subscription reported it, and
    // the same id can then name a different record. Check the launch, not just the
    // generation.
    const launch = traffic.store.launchID;
    for (const id of traffic.store.stalePending()) {
      api.networkDetail(id).then((detail) => {
        if (stopped || mine !== generation || traffic.store.launchID !== launch) return;
        traffic.store.ingestNetwork([detail]);
        traffic.store.applyDetail(detail);
      }, () => undefined);
    }
  }, healthMs);

  const firstAttempt = attempt();
  const stop = () => {
    stopped = true;
    generation += 1;
    if (timer) clearTimeout(timer);
    clearInterval(health);
    for (const unsubscribe of unsubscribes) release(unsubscribe);
    unsubscribes = [];
  };
  return { stop, firstAttempt };
}
