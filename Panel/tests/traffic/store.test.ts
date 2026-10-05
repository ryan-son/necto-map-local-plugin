//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { describe, expect, test } from "vitest";
import { TrafficStore } from "../../src/traffic/store";
import type { NetworkSummary, RequestEvent } from "../../src/types";

const net = (id: string, over: Partial<NetworkSummary> = {}): NetworkSummary => ({
  id,
  method: "GET",
  url: "https://api.invalid/a",
  host: "api.invalid",
  startedAtMilliseconds: 1000,
  state: "completed",
  statusCode: 200,
  ...over,
});
const ours = (seq: number, over: Partial<RequestEvent> = {}): RequestEvent => ({
  seq, date: 1001, method: "GET", host: "api.invalid", path: "/a", query: {}, outcome: { passthrough: {} }, ...over,
});
/** The panel clock — it moves independently of device time (startedAt) */
const panel = { now: 0 };
const store = () => { panel.now = 0; return new TrafficStore(() => undefined, () => panel.now); };

test("a pending that arrives late after completed does not roll the state back", () => {
  const s = store();
  s.ingestNetwork([net("1", { state: "completed", statusCode: 201 })]);
  s.ingestNetwork([net("1", { state: "pending", statusCode: undefined })]);
  expect(s.entries()[0]).toMatchObject({ state: "completed", status: 201 });
});

test("attaches the result when our record falls 0–50ms after the Necto start, and is unknown outside that", () => {
  const s = store();
  s.ingestNetwork([net("1"), net("2", { startedAtMilliseconds: 5000 })]);
  s.ingestOurs([ours(1, { date: 1002, outcome: { mocked: { rule: "r", response: "ok", status: 200 } } })]);
  expect(s.entries().find((e) => e.key === "1")).toMatchObject({
    result: "mocked",
    mockedBy: { rule: "r", response: "ok" },
  });
  expect(s.entries().find((e) => e.key === "2")).toMatchObject({ result: "unknown" });
});

test("does not pair our record when it precedes the Necto start (a one-sided window)", () => {
  const s = store();
  s.ingestNetwork([net("1", { startedAtMilliseconds: 1000 })]);
  s.ingestOurs([ours(1, { date: 990 })]);
  expect(s.entries().find((e) => e.key === "1")?.result).toBe("unknown");
});

test("pairs three identical requests in a row one by one, never using our record twice", () => {
  const s = store();
  s.ingestNetwork([
    net("1", { startedAtMilliseconds: 1000 }),
    net("2", { startedAtMilliseconds: 1001 }),
    net("3", { startedAtMilliseconds: 1002 }),
  ]);
  s.ingestOurs([ours(1, { date: 1001 }), ours(2, { date: 1002 })]);
  expect(s.entries().filter((e) => e.result === "passthrough")).toHaveLength(2);
  expect(s.entries().filter((e) => e.result === "unknown")).toHaveLength(1);
});

test("concurrent requests with different queries each get their own result", () => {
  const s = store();
  s.ingestNetwork([
    net("p1", { url: "https://api.invalid/list?page=1" }),
    net("p2", { url: "https://api.invalid/list?page=2" }),
  ]);
  s.ingestOurs([
    ours(1, { path: "/list", query: { page: "2" }, date: 1001, outcome: { unmocked: { status: 421 } } }),
    ours(2, { path: "/list", query: { page: "1" }, date: 1001, outcome: { mocked: { rule: "r", response: "ok" } } }),
  ]);
  expect(s.entries().find((e) => e.key === "p1")?.result).toBe("mocked");
  expect(s.entries().find((e) => e.key === "p2")?.result).toBe("blocked");
});

test("pairs paths containing a JWT by their original values too", () => {
  const s = store();
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";
  s.ingestNetwork([net("1", { url: `https://api.invalid/verify/${jwt}` })]);
  s.ingestOurs([ours(1, { path: `/verify/${jwt}` })]);
  expect(s.entries()).toHaveLength(1);
  expect(s.entries()[0]).toMatchObject({ key: "1", path: `/verify/${jwt}`, result: "passthrough" });
});

test("keeps an unpaired record of ours as a row", () => {
  const s = store();
  s.ingestOurs([ours(7, { path: "/only-ours" })]);
  expect(s.entries()).toMatchObject([{ key: "ours:7", path: "/only-ours", result: "passthrough" }]);
});

test("drops stream events at or below lastSeq", () => {
  const s = store();
  s.ingestOurs([ours(1), ours(2)], 2);
  s.ingestOurs([ours(2)]);
  s.ingestOurs([ours(3, { path: "/b" })]);
  expect(s.entries().filter((e) => e.key.startsWith("ours:"))).toHaveLength(3);
});

test("does not revive or count a number pruned from the list by the cap when it arrives again on the stream", () => {
  const s = store();
  s.ingestOurs([ours(1, { date: 1 })], 1);
  s.ingestNetwork(
    Array.from({ length: TrafficStore.capacity }, (_, i) =>
      net(`n${i}`, { startedAtMilliseconds: 10 + i }),
    ),
  );
  expect(s.entries().some((e) => e.key === "ours:1")).toBe(false);
  s.pause();
  s.ingestOurs([ours(1, { date: 1 })]);
  expect(s.pendingWhilePaused).toBe(0);
  s.resume();
  expect(s.entries().some((e) => e.key === "ours:1")).toBe(false);
  s.ingestOurs([ours(2, { date: 1 })]);
  expect(s.entries().some((e) => e.key === "ours:2")).toBe(false);
  s.ingestOurs([ours(3, { date: 99_999 })]);
  expect(s.entries().some((e) => e.key === "ours:3")).toBe(true);
});

test("the detail's X-Map-Local takes precedence over the pair, and a failed request without headers is unknown", () => {
  const s = store();
  s.ingestNetwork([net("1"), net("2", { state: "failed", statusCode: undefined })]);
  s.ingestOurs([ours(1, { date: 1001 })]);
  s.applyDetail({ ...net("1"), requestHeaders: {}, responseHeaders: { "X-Map-Local": "unmocked" } });
  s.applyDetail({ ...net("2", { state: "failed", statusCode: undefined }), requestHeaders: {}, responseHeaders: {} });
  expect(s.entries().find((e) => e.key === "1")?.result).toBe("blocked");
  expect(s.entries().find((e) => e.key === "2")?.result).toBe("unknown");
});

test("drops the oldest first beyond the cap but keeps the selected request", () => {
  const s = store();
  s.ingestNetwork([net("old", { startedAtMilliseconds: 1 })]);
  s.pin("old");
  s.ingestNetwork(
    Array.from({ length: TrafficStore.capacity }, (_, i) =>
      net(`n${i}`, { startedAtMilliseconds: 10 + i }),
    ),
  );
  expect(s.entries().some((e) => e.key === "old")).toBe(true);
  expect(s.entries().length).toBe(TrafficStore.capacity + 1);
});

test("a new launch releases the pinned request too, so it does not grab the new launch's record with the same key", () => {
  const s = store();
  s.reset("launch-1");
  s.ingestNetwork([net("old", { startedAtMilliseconds: 1 })]);
  s.pin("old");
  s.reset("launch-2");
  s.ingestNetwork([net("old", { startedAtMilliseconds: 1 })]);
  s.ingestNetwork(
    Array.from({ length: TrafficStore.capacity }, (_, i) =>
      net(`n${i}`, { startedAtMilliseconds: 10 + i }),
    ),
  );
  expect(s.entries().some((e) => e.key === "old")).toBe(false);
  expect(s.entries().length).toBe(TrafficStore.capacity);
});

test("while paused, the list stays as it is and only the arrivals are counted", () => {
  const s = store();
  s.ingestNetwork([net("1")]);
  s.pause();
  s.ingestNetwork([net("2", { startedAtMilliseconds: 2000 })]);
  expect(s.entries().map((e) => e.key)).toEqual(["1"]);
  expect(s.pendingWhilePaused).toBe(1);
  s.resume();
  expect(s.entries().map((e) => e.key)).toEqual(["2", "1"]);
});

test("the count of arrivals while paused is a count of requests — a Necto record paired with ours counts once", () => {
  const s = store();
  s.pause();
  for (let i = 0; i < 15; i++) {
    const at = 10_000 + i * 1000;
    s.ingestNetwork([net(`n${i}`, { url: `https://api.invalid/p${i}`, startedAtMilliseconds: at })]);
    s.ingestOurs([ours(i + 1, { path: `/p${i}`, date: at + 1 })]);
  }
  for (let i = 15; i < 30; i++) {
    const at = 10_000 + i * 1000;
    s.ingestOurs([ours(i + 1, { path: `/p${i}`, date: at + 1 })]);
    s.ingestNetwork([net(`n${i}`, { url: `https://api.invalid/p${i}`, startedAtMilliseconds: at })]);
  }
  expect(s.pendingWhilePaused).toBe(30);
  s.resume();
  expect(s.entries()).toHaveLength(30);
});

test("returns Necto records pending for more than 10 seconds for re-checking", () => {
  const s = store();
  s.ingestNetwork([net("old", { state: "pending", statusCode: undefined, startedAtMilliseconds: 0 })]);
  panel.now = 9_000;
  s.ingestNetwork([net("new", { state: "pending", statusCode: undefined, startedAtMilliseconds: 9_000 })]);
  panel.now = 10_500;
  expect(s.stalePending()).toEqual(["old"]);
});

test.each([5000, -5000])("re-checks a pending record 10 seconds after the panel received it, even when the device clock is %ims off from the panel", (skew) => {
  const s = store();
  panel.now = 100_000;
  s.ingestNetwork([net("p", { state: "pending", statusCode: undefined, startedAtMilliseconds: 100_000 + skew })]);
  panel.now = 109_000;
  expect(s.stalePending()).toEqual([]);
  panel.now = 110_500;
  expect(s.stalePending()).toEqual(["p"]);
});

test("empties on a new launch", () => {
  const s = store();
  s.reset("launch-1");
  s.ingestNetwork([net("1")]);
  s.reset("launch-1");
  expect(s.entries()).toHaveLength(1);
  s.reset("launch-2");
  expect(s.entries()).toHaveLength(0);
});

test("pairs the path '/' of a host-only URL with the empty path of our record as the same request", () => {
  const s = store();
  s.ingestNetwork([net("1", { url: "https://api.invalid" })]);
  s.ingestOurs([ours(1, { path: "" })]);
  expect(s.entries()).toMatchObject([{ key: "1", result: "passthrough" }]);
});

test("pairs our record's host after normalising its trailing dot and case too", () => {
  const s = store();
  s.ingestNetwork([net("1")]);
  s.ingestOurs([ours(1, { host: "API.invalid." })]);
  expect(s.entries()).toMatchObject([{ key: "1", result: "passthrough" }]);
});

test.each(["::1", "[::1]"])("pairs IPv6 hosts regardless of brackets and port (%s)", (host) => {
  const s = store();
  s.ingestNetwork([net("1", { url: "http://[::1]:8080/a" })]);
  s.ingestOurs([ours(1, { host })]);
  expect(s.entries()).toMatchObject([{ key: "1", result: "passthrough" }]);
});

test("does not settle a still-pending detail as passed through, even without headers", () => {
  const s = store();
  s.ingestNetwork([net("1", { state: "pending", statusCode: undefined })]);
  s.applyDetail({ ...net("1", { state: "pending", statusCode: undefined }), requestHeaders: {}, responseHeaders: {} });
  expect(s.entries()[0].result).toBe("unknown");
});

test("a completed state received in a detail updates a stale pending row", () => {
  const s = store();
  s.ingestNetwork([net("1", { state: "pending", statusCode: undefined, startedAtMilliseconds: 0 })]);
  s.applyDetail({
    ...net("1", { startedAtMilliseconds: 0, statusCode: 204 }),
    requestHeaders: {},
    responseHeaders: { "x-map-local": "r/ok/v2" },
  });
  expect(s.entries()[0]).toMatchObject({
    state: "completed",
    status: 204,
    result: "mocked",
    mockedBy: { rule: "r", response: "ok/v2" },
  });
  panel.now = 20_000;
  expect(s.stalePending()).toEqual([]);
});

test("returns a stale pending record for re-checking only once", () => {
  const s = store();
  s.ingestNetwork([net("old", { state: "pending", statusCode: undefined, startedAtMilliseconds: 0 })]);
  panel.now = 10_500;
  expect(s.stalePending()).toEqual(["old"]);
  panel.now = 20_000;
  expect(s.stalePending()).toEqual([]);
});

test("a detail for a record not in the list does not create a row", () => {
  const s = store();
  s.applyDetail({ ...net("gone"), requestHeaders: {}, responseHeaders: { "X-Map-Local": "unmocked" } });
  expect(s.entries()).toEqual([]);
});

test("liveEntry gives the current value even while paused, not the frozen list's", () => {
  const store = new TrafficStore(() => {});
  store.ingestNetwork([
    {
      id: "1",
      method: "GET",
      url: "https://api.invalid/a",
      host: "api.invalid",
      startedAtMilliseconds: 1,
      state: "pending",
    },
  ]);
  store.pause();
  store.ingestNetwork([
    {
      id: "1",
      method: "GET",
      url: "https://api.invalid/a",
      host: "api.invalid",
      startedAtMilliseconds: 1,
      state: "completed",
      statusCode: 200,
    },
  ]);
  expect(store.entries()[0].state).toBe("pending");
  expect(store.liveEntry("1")).toMatchObject({ state: "completed", status: 200 });
  expect(store.liveEntry("nope")).toBeUndefined();
});

test("pairs, details and cap pruning that arrive after a list read show on the next read at once", () => {
  const s = new TrafficStore(() => undefined);
  s.ingestNetwork([net("1", { state: "pending", statusCode: undefined })]);
  expect(s.liveEntry("1")).toMatchObject({ result: "unknown", state: "pending" });
  s.ingestOurs([ours(1, { outcome: { mocked: { rule: "r", response: "ok", status: 200 } } })]);
  expect(s.liveEntry("1")).toMatchObject({ result: "mocked" });
  s.applyDetail({ ...net("1", { statusCode: 201 }), requestHeaders: {}, responseHeaders: { "X-Map-Local": "r2/b" } });
  expect(s.liveEntry("1")).toMatchObject({ status: 201, state: "completed", mockedBy: { rule: "r2", response: "b" } });
  s.ingestNetwork(
    Array.from({ length: TrafficStore.capacity }, (_, i) =>
      net(`x${i}`, { startedAtMilliseconds: 2000 + i }),
    ),
  );
  expect(s.entries()).toHaveLength(TrafficStore.capacity);
  expect(s.liveEntry("1")).toBeUndefined();
});

const fillCapacity = (s: TrafficStore, from = 10) =>
  s.ingestNetwork(
    Array.from({ length: TrafficStore.capacity }, (_, i) =>
      net(`n${i}`, { startedAtMilliseconds: from + i }),
    ),
  );

test.each([[1050, "passthrough"], [1051, "unknown"]])("when our record is stamped at %i against the Necto start, the result is '%s' (50ms pairs, 51ms does not)", (date, result) => {
  const s = store();
  s.ingestNetwork([net("1", { startedAtMilliseconds: 1000 })]);
  s.ingestOurs([ours(1, { date })]);
  expect(s.entries().find((e) => e.key === "1")?.result).toBe(result);
});

test("with two candidates for one Necto record, pairs the record of ours closer to the start and keeps the farther one as a row", () => {
  const s = store();
  s.ingestNetwork([net("1", { startedAtMilliseconds: 1000 })]);
  s.ingestOurs([
    ours(1, { date: 1030, outcome: { mocked: { rule: "far", response: "x", status: 200 } } }),
    ours(2, { date: 1010, outcome: { unmocked: { status: 421 } } }),
  ]);
  expect(s.entries().find((e) => e.key === "1")?.result).toBe("blocked");
  expect(s.entries().find((e) => e.key === "ours:1")).toMatchObject({ result: "mocked" });
  expect(s.entries().find((e) => e.key === "ours:2")).toBeUndefined();
});

test("pairs in start order, so both get a pair, even when Necto records arrive latest start first", () => {
  const s = store();
  s.ingestNetwork([net("late", { startedAtMilliseconds: 1030 }), net("early", { startedAtMilliseconds: 1000 })]);
  s.ingestOurs([ours(1, { date: 1040 }), ours(2, { date: 1060 })]);
  expect(s.entries().map((e) => [e.key, e.result])).toEqual([["late", "passthrough"], ["early", "passthrough"]]);
});

test("a failed request without headers in its detail is unknown, even when its pair passed through", () => {
  const s = store();
  s.ingestNetwork([net("1", { state: "failed", statusCode: undefined })]);
  s.ingestOurs([ours(1)]);
  expect(s.entries()[0].result).toBe("passthrough");
  s.applyDetail({ ...net("1", { state: "failed", statusCode: undefined }), requestHeaders: {}, responseHeaders: {} });
  expect(s.entries()[0].result).toBe("unknown");
});

test("a failed request without headers keeps its paired mock, since a mocked error has no headers either", () => {
  const s = store();
  s.ingestNetwork([net("1", { state: "failed", statusCode: undefined })]);
  s.ingestOurs([ours(1, { outcome: { mocked: { rule: "r", response: "down", error: -1005 } } })]);
  s.applyDetail({ ...net("1", { state: "failed", statusCode: undefined }), requestHeaders: {}, responseHeaders: {} });
  expect(s.entries()[0]).toMatchObject({ result: "mocked", mockedBy: { rule: "r", response: "down" } });
});

test("a failed request without headers stays blocked when Map Local failed it as a request without a rule", () => {
  const s = store();
  s.ingestNetwork([net("1", { state: "failed", statusCode: undefined })]);
  s.ingestOurs([ours(1, { outcome: { unmocked: { error: -1009 } } })]);
  s.applyDetail({ ...net("1", { state: "failed", statusCode: undefined }), requestHeaders: {}, responseHeaders: {} });
  expect(s.entries()[0].result).toBe("blocked");
});

test.each([
  { unmocked: { error: -1009 } },
  { mocked: { rule: "r", response: "down", error: -1005 } },
])("a request Map Local failed shows as failed even without Necto's record (%j)", (outcome) => {
  const s = store();
  s.ingestOurs([ours(1, { outcome })]);
  expect(s.entries()[0].state).toBe("failed");
});

test("a detail completed with a status code but without headers is passed through, even when unpaired or paired with a mock", () => {
  const s = store();
  s.ingestNetwork([
    net("1", { state: "pending", statusCode: undefined }),
    net("2", {
      state: "pending",
      statusCode: undefined,
      url: "https://api.invalid/b",
      startedAtMilliseconds: 5000,
    }),
  ]);
  s.ingestOurs([ours(1, { path: "/b", date: 5001, outcome: { mocked: { rule: "r", response: "ok", status: 200 } } })]);
  expect(s.entries().find((e) => e.key === "2")?.result).toBe("mocked");
  s.applyDetail({ ...net("1"), requestHeaders: {}, responseHeaders: {} });
  s.applyDetail({
    ...net("2", { url: "https://api.invalid/b", startedAtMilliseconds: 5000 }),
    requestHeaders: {},
    responseHeaders: {},
  });
  expect(s.entries().find((e) => e.key === "1")?.result).toBe("passthrough");
  expect(s.entries().find((e) => e.key === "2")?.result).toBe("passthrough");
});

describe("emptying for a new launch drops every trace of the previous launch", () => {
  test("our record numbers restart at 1 every launch, so number 1 of the new launch pairs again", () => {
    const s = store();
    s.reset("launch-1");
    s.ingestNetwork([net("1")]);
    s.ingestOurs([ours(1)]);
    expect(s.entries()[0].result).toBe("passthrough");
    s.reset("launch-2");
    s.ingestNetwork([net("1")]);
    s.ingestOurs([ours(1, { outcome: { unmocked: { status: 421 } } })]);
    expect(s.entries()).toHaveLength(1);
    expect(s.entries()[0]).toMatchObject({ key: "1", result: "blocked" });
  });

  test("the lastSeq read in the previous launch does not block the new launch's stream", () => {
    const s = store();
    s.reset("launch-1");
    s.ingestOurs([ours(1), ours(2), ours(3)], 3);
    s.reset("launch-2");
    s.ingestOurs([ours(1, { path: "/fresh" })]);
    expect(s.entries()).toMatchObject([{ key: "ours:1", path: "/fresh" }]);
  });

  test("drops the pause snapshot and the arrival count too, so the new launch's list shows at once", () => {
    const s = store();
    s.reset("launch-1");
    s.ingestNetwork([net("1")]);
    s.pause();
    s.ingestNetwork([net("2", { startedAtMilliseconds: 2000 })]);
    expect(s.pendingWhilePaused).toBe(1);
    s.reset("launch-2");
    expect(s.paused).toBe(false);
    expect(s.pendingWhilePaused).toBe(0);
    s.ingestNetwork([net("9", { startedAtMilliseconds: 3000 })]);
    expect(s.entries().map((e) => e.key)).toEqual(["9"]);
  });

  test("details and pairs received in the previous launch do not stick to a new record with the same id", () => {
    const s = store();
    s.reset("launch-1");
    s.ingestNetwork([net("1")]);
    s.ingestOurs([ours(1)]);
    s.applyDetail({ ...net("1"), requestHeaders: {}, responseHeaders: { "X-Map-Local": "unmocked" } });
    expect(s.entries()[0].result).toBe("blocked");
    s.reset("launch-2");
    s.ingestNetwork([net("1")]);
    expect(s.entries()).toHaveLength(1);
    expect(s.entries()[0].result).toBe("unknown");
  });

  test("drops the pending re-check history too, so the same id in the new launch is re-checked once", () => {
    const s = store();
    s.reset("launch-1");
    s.ingestNetwork([net("p", { state: "pending", statusCode: undefined })]);
    panel.now = 11_000;
    expect(s.stalePending()).toEqual(["p"]);
    panel.now = 50_000;
    s.reset("launch-2");
    s.ingestNetwork([net("p", { state: "pending", statusCode: undefined })]);
    expect(s.stalePending()).toEqual([]);
    panel.now = 61_000;
    expect(s.stalePending()).toEqual(["p"]);
  });
});
