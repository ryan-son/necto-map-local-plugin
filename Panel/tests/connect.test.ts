//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { connect } from "../src/connect";
import { PanelModel } from "../src/model";
import { OrderDetector } from "../src/traffic/order";
import { TrafficStore } from "../src/traffic/store";
import type { NetworkSummary, RequestEvent } from "../src/types";
import { View } from "../src/view";
import { engineState, FakeAPI } from "./fake-api";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(api: FakeAPI) {
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: { get: () => undefined, set: () => undefined, clear: () => undefined },
    copy: async () => true,
    copyField: () => true,
    prefs: { get: () => undefined, set: () => undefined },
  });
  return { model, view };
}

/** Subscribing succeeds but delivers no replay event (the host dropped it before ready()). */
function silentSubscription(api: FakeAPI) {
  api.observeState = async (_on, onError) => {
    api.stateErrorHandler = onError;
    return async () => undefined;
  };
}

test("connects by reading the state directly when the subscription delivers no replay event", async () => {
  const api = new FakeAPI();
  silentSubscription(api);
  const { model, view } = setup(api);
  const { firstAttempt } = connect(api, model, view, undefined, 2000);
  await firstAttempt;
  expect(view.connection).toBe("connected");
  expect(model.state).toBe(api.current);
});

test("ready can be called only after the first attempt finishes", async () => {
  const api = new FakeAPI();
  const order: string[] = [];
  let release!: (u: () => Promise<void>) => void;
  api.observeState = () => new Promise((resolve) => { release = resolve; });
  const { model, view } = setup(api);
  const { firstAttempt } = connect(api, model, view, undefined, 2000);
  const bootstrapped = firstAttempt.then(() => order.push("ready"));
  await vi.advanceTimersByTimeAsync(0);
  order.push("subscribing");
  release(async () => undefined);
  await bootstrapped;
  expect(order).toEqual(["subscribing", "ready"]);
});

test("firstAttempt finishes even when the first attempt fails", async () => {
  const api = new FakeAPI();
  api.stateError = new Error("no app");
  const { model, view } = setup(api);
  await connect(api, model, view, undefined, 2000).firstAttempt;
  expect(view.connection).toBe("waiting");
});

test("the periodic check subscribes again while waiting when no retry is scheduled and the state can be read", async () => {
  const api = new FakeAPI();
  silentSubscription(api);
  const { model, view } = setup(api);
  const subscribe = vi.spyOn(api, "observeState");
  const { firstAttempt, stop } = connect(api, model, view, undefined, 2000, 5000);
  await firstAttempt;
  view.connection = "waiting";
  api.current = engineState();
  await vi.advanceTimersByTimeAsync(5000);
  expect(subscribe).toHaveBeenCalledTimes(2);
  expect(view.connection).toBe("connected");
  stop();
});

const ours = (seq: number, path = "/a"): RequestEvent =>
  ({ seq, date: 1, method: "GET", host: "maplocal.invalid", path, query: {}, outcome: { passthrough: {} } });
const record = (
  id: string,
  startedAtMilliseconds = 1,
  state: NetworkSummary["state"] = "completed",
): NetworkSummary => ({
  id,
  method: "GET",
  url: `https://maplocal.invalid/${id}`,
  host: "maplocal.invalid",
  startedAtMilliseconds,
  state,
});

function connectionsSeen(view: View): string[] {
  const seen: string[] = [];
  const render = view.render.bind(view);
  view.render = () => { seen.push(view.connection); render(); };
  return seen;
}

function traffic() {
  const store = new TrafficStore(() => undefined);
  const order = new OrderDetector();
  return { store, order };
}

test("lists Necto records after attaching the subscription, and drops streamed records at or below the lastSeq of our record list", async () => {
  const api = new FakeAPI();
  api.network = true;
  api.listed = { events: [ours(1)], lastSeq: 1 };
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: { get: () => undefined, set: () => undefined, clear: () => undefined },
    copy: async () => true,
    copyField: () => true,
    prefs: { get: () => undefined, set: () => undefined },
  });
  const store = new TrafficStore(() => undefined);
  connect(api, model, view, { store, order: new OrderDetector() }, 2000);
  await vi.advanceTimersByTimeAsync(0);
  expect(api.calls.indexOf("observeNetwork")).toBeLessThan(api.calls.indexOf("networkRecords"));
  expect(view.networkAvailable).toBe(true);
  api.onRequest!(ours(1));
  expect(store.entries()).toHaveLength(1);
});

test("keeps Necto's reason when the network plugin is unavailable, and drops it once it is available", async () => {
  const api = new FakeAPI();
  api.networkReason = "The selected app does not provide this operation";
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: { get: () => undefined, set: () => undefined, clear: () => undefined },
    copy: async () => true,
    copyField: () => true,
    prefs: { get: () => undefined, set: () => undefined },
  });
  connect(api, model, view, traffic(), 2000);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.networkAvailable).toBe(false);
  expect(view.networkUnavailableReason).toBe("The selected app does not provide this operation");
  api.network = true;
  await vi.advanceTimersByTimeAsync(2000 * 3);
  expect(view.networkAvailable).toBe(true);
  expect(view.networkUnavailableReason).toBeUndefined();
});

test("the periodic check re-reads the detail of a row pending for more than 10 seconds", async () => {
  const api = new FakeAPI();
  api.network = true;
  api.networkList = [
    {
      id: "p",
      method: "GET",
      url: "https://maplocal.invalid/a",
      host: "maplocal.invalid",
      startedAtMilliseconds: Date.now(),
      state: "pending",
    },
  ];
  api.detailFor = (id) => ({
    ...api.networkList[0],
    id,
    state: "completed",
    statusCode: 200,
    requestHeaders: {},
    responseHeaders: {},
  });
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: { get: () => undefined, set: () => undefined, clear: () => undefined },
    copy: async () => true,
    copyField: () => true,
    prefs: { get: () => undefined, set: () => undefined },
  });
  const store = new TrafficStore(() => undefined);
  connect(api, model, view, { store, order: new OrderDetector() }, 2000, 5000);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(store.entries()[0]).toMatchObject({ state: "completed", status: 200 });
});

test("clears the previous launch's records before adding records even when the state subscription loses its first event", async () => {
  const api = new FakeAPI();
  silentSubscription(api);
  api.listed = { events: [ours(1, "/new")], lastSeq: 1 };
  const { model, view } = setup(api);
  const t = traffic();
  t.store.reset("launch-0");
  t.store.ingestOurs([ours(5, "/old")], 5);
  await connect(api, model, view, t, 2000).firstAttempt;
  api.onRequest!(ours(2, "/b"));
  expect(t.store.entries().map((e) => e.path).sort()).toEqual(["/b", "/new"]);
});

test("clears the previous launch's records when the app launches again", async () => {
  const api = new FakeAPI();
  api.listed = { events: [ours(1)], lastSeq: 1 };
  const { model, view } = setup(api);
  const t = traffic();
  await connect(api, model, view, t, 2000).firstAttempt;
  expect(t.store.entries()).toHaveLength(1);
  api.onState!({ ...engineState(), launchID: "launch-2" });
  expect(t.store.entries()).toHaveLength(0);
});

test("does not add records the previous subscription delivers late after a retry", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  await connect(api, model, view, t, 2000).firstAttempt;
  const oldOurs = api.onRequest!;
  const oldNetwork = api.onNetwork!;
  api.stateErrorHandler!(new Error("ended"));
  oldOurs(ours(5));
  oldNetwork(record("late"));
  expect(t.store.entries()).toHaveLength(0);
});

test("judges the registration-order warning only after the Necto network subscription is attached", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const started = vi.spyOn(t.order, "networkStarted");
  await connect(api, model, view, t, 2000).firstAttempt;
  expect(started).toHaveBeenCalledTimes(1);
  expect(api.calls.indexOf("observeNetwork")).toBeGreaterThanOrEqual(0);
});

test("without the network plugin, does not report the Necto subscription as started and adds only our records", async () => {
  const api = new FakeAPI();
  api.listed = { events: [ours(1)], lastSeq: 1 };
  const { model, view } = setup(api);
  const t = traffic();
  const started = vi.spyOn(t.order, "networkStarted");
  await connect(api, model, view, t, 2000).firstAttempt;
  expect(started).not.toHaveBeenCalled();
  expect(api.calls).toEqual(["requestsList"]);
  expect(t.store.entries()).toHaveLength(1);
});

test("our record stream and the Necto record stream flow into the store and the order detector", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const liveOurs = vi.spyOn(t.order, "liveOurs");
  const liveNetwork = vi.spyOn(t.order, "liveNetwork");
  await connect(api, model, view, t, 2000).firstAttempt;
  api.onRequest!(ours(2, "/b"));
  api.onNetwork!(record("n"));
  expect(model.requests).toHaveLength(1);
  expect(liveOurs).toHaveBeenCalledTimes(1);
  expect(liveNetwork).toHaveBeenCalledTimes(1);
  expect(t.store.entries().map((e) => e.key).sort()).toEqual(["n", "ours:2"]);
});

test("when the network plugin appears later, the periodic check subscribes to Necto only and keeps the rules screen connected", async () => {
  const api = new FakeAPI();
  const { model, view } = setup(api);
  const t = traffic();
  const seen = connectionsSeen(view);
  const observeState = vi.spyOn(api, "observeState");
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 5000);
  await firstAttempt;
  api.network = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.calls).toContain("observeNetwork");
  expect(observeState).toHaveBeenCalledTimes(1);
  expect(seen).not.toContain("waiting");
  stop();
});

test("does not subscribe again when the Necto subscription ends and the plugin is gone", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 5000);
  await firstAttempt;
  api.network = false;
  api.networkErrorHandler!(new Error("ended"));
  await vi.advanceTimersByTimeAsync(5000 * 3);
  expect(api.calls.filter((c) => c === "observeNetwork")).toHaveLength(1);
  expect(view.connection).toBe("connected");
  stop();
});

test("when the Necto subscription ends and the plugin is still there, the periodic check resubscribes to Necto only and recovers records finished in between from the list", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const seen = connectionsSeen(view);
  const observeState = vi.spyOn(api, "observeState");
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 5000);
  await firstAttempt;
  api.networkErrorHandler!(new Error("ended"));
  api.networkList = [record("gap")];
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.calls.filter((c) => c === "observeNetwork")).toHaveLength(2);
  expect(t.store.entries().map((e) => e.key)).toContain("gap");
  expect(observeState).toHaveBeenCalledTimes(1);
  expect(seen).not.toContain("waiting");
  stop();
});

test("the rules screen stays connected when the Necto subscription fails", async () => {
  const api = new FakeAPI();
  api.network = true;
  api.observeNetwork = async () => { api.calls.push("observeNetwork"); throw new Error("PROVIDER_FAILED"); };
  const { model, view } = setup(api);
  const t = traffic();
  const seen = connectionsSeen(view);
  const observeState = vi.spyOn(api, "observeState");
  const started = vi.spyOn(t.order, "networkStarted");
  await connect(api, model, view, t, 2000, 60_000).firstAttempt;
  await vi.advanceTimersByTimeAsync(2000 * 3);
  expect(view.connection).toBe("connected");
  expect(observeState).toHaveBeenCalledTimes(1);
  expect(seen).not.toContain("waiting");
  expect(started).not.toHaveBeenCalled();
  expect(api.calls).not.toContain("networkRecords");
});

test("backs off instead of retrying on every periodic check when the Necto subscription keeps failing", async () => {
  const api = new FakeAPI();
  api.network = true;
  api.observeNetwork = async () => { api.calls.push("observeNetwork"); throw new Error("PROVIDER_FAILED"); };
  const { model, view } = setup(api);
  const t = traffic();
  const observeState = vi.spyOn(api, "observeState");
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 5000);
  await firstAttempt;
  await vi.advanceTimersByTimeAsync(5000 * 8);
  // Once at first, once after skipping 1 interval, once after skipping 2 (the next comes after 4)
  expect(api.calls.filter((c) => c === "observeNetwork")).toHaveLength(3);
  expect(observeState).toHaveBeenCalledTimes(1);
  stop();
});

test("does not add a pending re-check detail that arrives late after a retry", async () => {
  const api = new FakeAPI();
  api.network = true;
  api.networkList = [record("p", Date.now(), "pending")];
  let resolve!: () => void;
  api.networkDetail = (id) =>
    new Promise((r) => {
      resolve = () =>
        r({
          ...record(id, api.networkList[0].startedAtMilliseconds),
          statusCode: 200,
          requestHeaders: {},
          responseHeaders: {},
        });
    });
  const { model, view } = setup(api);
  const t = traffic();
  const { stop } = connect(api, model, view, t, 2000, 5000);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(t.store.entries()[0]).toMatchObject({ state: "pending" });
  api.stateErrorHandler!(new Error("ended"));
  resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(t.store.entries().find((e) => e.key === "p")?.state).not.toBe("completed");
  stop();
});

test("keeps the connection and leaves the row pending when the pending re-check fails", async () => {
  const api = new FakeAPI();
  api.network = true;
  api.networkList = [record("p", Date.now(), "pending")];
  const { model, view } = setup(api);
  const t = traffic();
  const { stop } = connect(api, model, view, t, 2000, 5000);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(t.store.entries()[0]).toMatchObject({ key: "p", state: "pending" });
  expect(view.connection).toBe("connected");
  stop();
});

test("does not attach a new subscription again when the previous Necto subscription reports its end after a retry", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 5000);
  await firstAttempt;
  const oldError = api.networkErrorHandler!;
  api.stateErrorHandler!(new Error("ended"));
  await vi.advanceTimersByTimeAsync(2000);
  oldError(new Error("ended"));
  await vi.advanceTimersByTimeAsync(5000 * 2);
  expect(api.calls.filter((c) => c === "observeNetwork")).toHaveLength(2);
  stop();
});

test("does not count mock records that arrive before the Necto subscription is attached toward the registration-order warning", async () => {
  const api = new FakeAPI();
  api.network = true;
  let release!: () => void;
  const observe = api.observeNetwork.bind(api);
  api.observeNetwork = (on, onError) => new Promise((resolve) => { release = () => resolve(observe(on, onError)); });
  const { model, view } = setup(api);
  const t = traffic();
  const liveOurs = vi.spyOn(t.order, "liveOurs");
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 60_000);
  await vi.advanceTimersByTimeAsync(0);
  const now = Date.now();
  for (const seq of [1, 2, 3])
    api.onRequest!({
      ...ours(seq, `/m${seq}`),
      date: now,
      outcome: { mocked: { rule: "r", response: "ok", status: 200 } },
    });
  release();
  await firstAttempt;
  await vi.advanceTimersByTimeAsync(2000);
  expect(liveOurs).not.toHaveBeenCalled();
  expect(t.order.warning()).toBe(false);
  stop();
});

test("does not count our records that arrive after the Necto subscription ends toward the registration-order warning", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const liveOurs = vi.spyOn(t.order, "liveOurs");
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 60_000);
  await firstAttempt;
  api.networkErrorHandler!(new Error("ended"));
  api.onRequest!(ours(1));
  expect(liveOurs).not.toHaveBeenCalled();
  stop();
});

test("tells the screen when the Necto network plugin is missing", async () => {
  const api = new FakeAPI();
  const { model, view } = setup(api);
  view.networkAvailable = true;
  connect(api, model, view, { store: new TrafficStore(() => undefined), order: new OrderDetector() }, 2000);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.networkAvailable).toBe(false);
});

test.each([60_000, -60_000])("re-checks a pending row once, 10 seconds after the panel received it, even when the device clock is %ims off from the Mac", async (skew) => {
  const api = new FakeAPI();
  api.network = true;
  api.networkList = [record("p", Date.now() + skew, "pending")];
  const detail = vi.fn(async (id: string) => ({
    ...record(id, Date.now() + skew),
    statusCode: 200,
    requestHeaders: {},
    responseHeaders: {},
  }));
  api.networkDetail = detail;
  const { model, view } = setup(api);
  const t = traffic();
  const { stop } = connect(api, model, view, t, 2000, 5000);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(detail).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(detail).toHaveBeenCalledTimes(1);
  expect(t.store.entries()[0]).toMatchObject({ state: "completed" });
  stop();
});

const mockedEvent = (seq: number): RequestEvent => ({
  seq,
  date: Date.now(),
  method: "GET",
  host: "maplocal.invalid",
  path: `/m${seq}`,
  query: {},
  outcome: { mocked: { rule: "r", response: "ok", status: 200 } },
});

test("three mocks arriving together right after the Necto subscription do not raise the order warning without Necto records (records queued before ready)", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 60_000);
  await firstAttempt;
  for (const seq of [1, 2, 3]) api.onRequest!(mockedEvent(seq));
  await vi.advanceTimersByTimeAsync(5000);
  expect(t.order.warning()).toBe(false);
  stop();
});

test("three unpaired mocks arriving after the grace period raise the order warning", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 60_000);
  await firstAttempt;
  await vi.advanceTimersByTimeAsync(2000);
  for (const seq of [1, 2, 3]) api.onRequest!(mockedEvent(seq));
  await vi.advanceTimersByTimeAsync(1000);
  expect(t.order.warning()).toBe(true);
  stop();
});

test("does not add a previous launch's pending re-check detail that arrives after a relaunch to the same id in the new launch", async () => {
  const api = new FakeAPI();
  api.network = true;
  api.networkList = [record("p", 1, "pending")];
  let resolve!: () => void;
  api.networkDetail = (id) =>
    new Promise((r) => {
      resolve = () =>
        r({
          ...record(id, 1),
          state: "completed",
          statusCode: 200,
          requestHeaders: {},
          responseHeaders: {},
        });
    });
  const { model, view } = setup(api);
  const t = traffic();
  const { stop } = connect(api, model, view, t, 2000, 5000);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(resolve).toBeDefined();
  api.onState!({ ...engineState(), launchID: "launch-2" });
  api.onNetwork!(record("p", 1, "pending"));
  resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(t.store.entries()[0]).toMatchObject({ key: "p", state: "pending" });
  stop();
});

test("keeps the order warning and the records when a state notification repeats the same launch, and clears the warning too on a new launch", async () => {
  const api = new FakeAPI();
  api.network = true;
  const { model, view } = setup(api);
  const t = traffic();
  const { firstAttempt, stop } = connect(api, model, view, t, 2000, 60_000);
  await firstAttempt;
  await vi.advanceTimersByTimeAsync(2000);
  for (const seq of [1, 2, 3]) api.onRequest!(mockedEvent(seq));
  await vi.advanceTimersByTimeAsync(1000);
  expect(t.order.warning()).toBe(true);
  api.onState!({ ...engineState() });
  expect(t.order.warning()).toBe(true);
  expect(t.store.entries()).toHaveLength(3);
  api.onState!({ ...engineState(), launchID: "launch-2" });
  expect(t.order.warning()).toBe(false);
  expect(t.store.entries()).toHaveLength(0);
  stop();
});
