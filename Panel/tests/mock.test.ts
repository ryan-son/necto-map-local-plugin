//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { necto } from "@necto/bridge";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { bridgeAPI } from "../src/api";
import { installMockBridge, mockMarker } from "../src/mock";
import type { EngineState, NetworkSummary, RequestEvent, Rule } from "../src/types";

/// The dev mock answers through the real bridge client, so these go through `bridgeAPI()`
/// exactly as the panel does.
describe("dev mock host", () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installMockBridge({ liveMs: 0 });
  });
  afterEach(() => uninstall());

  const api = () => bridgeAPI();
  const rules = (state: EngineState) => state.configuration.rules as Rule[];

  test("makes the page look like Necto: the bridge is available and network.list is offered", async () => {
    expect(necto.isAvailable()).toBe(true);
    expect(await api().networkAvailability()).toEqual({ available: true });
    expect((await necto.context()).sourceIdentity).toBe(mockMarker);
  });

  test("the state carries a query rule, a long path, a 5xx response and a blocked host", async () => {
    const state = await api().state();
    expect(rules(state).some((r) => Object.keys(r.match.query ?? {}).length > 0)).toBe(true);
    expect(Math.max(...rules(state).map((r) => r.match.path.length))).toBeGreaterThan(80);
    expect(rules(state).some((r) => Object.values(r.responses).some((x) => (x.status ?? 0) >= 500))).toBe(true);
    expect(state.blockedHosts.length).toBeGreaterThan(0);
  });

  test("network.list holds 500 rows with a 5xx, a failure, a pending row and a long URL", async () => {
    const records = await api().networkRecords();
    expect(records).toHaveLength(500);
    expect(records.some((r) => (r.statusCode ?? 0) >= 500)).toBe(true);
    expect(records.some((r) => r.state === "failed")).toBe(true);
    expect(records.some((r) => r.state === "pending")).toBe(true);
    expect(Math.max(...records.map((r) => r.url.length))).toBeGreaterThan(150);
    const blocked = (await api().state()).blockedHosts[0];
    expect(records.some((r) => r.host === blocked)).toBe(true);
  });

  test("our request log pairs with Necto's records and covers mocked, passthrough and blocked", async () => {
    const { events, lastSeq } = await api().requestsList();
    expect(events.length).toBeGreaterThan(0);
    expect(lastSeq).toBe(Math.max(...events.map((e) => e.seq)));
    const kinds = new Set(events.map((e) => Object.keys(e.outcome)[0]));
    expect([...kinds].sort()).toEqual(["mocked", "passthrough", "unmocked"]);
  });

  test("one record's detail has a body of about 200 KB", async () => {
    const records = await api().networkRecords();
    const sizes = await Promise.all(
      records.slice(0, 50).map(async (r) => (await api().networkDetail(r.id)).responseBody?.text?.length ?? 0),
    );
    expect(Math.max(...sizes)).toBeGreaterThan(190_000);
  });

  test("writes apply, bump the revision and reach state subscribers; a stale base is a conflict", async () => {
    const seen: EngineState[] = [];
    await api().observeState((s) => seen.push(s), () => undefined);
    const before = await api().state();
    const id = rules(before)[0].id;
    const result = await api().write("maplocal.rule.delete", { baseRevision: before.revision, id });
    expect(result).toEqual({ ok: true, revision: before.revision + 1 });
    const after = await api().state();
    expect(rules(after).some((r) => r.id === id)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.at(-1)?.revision).toBe(after.revision);
    const stale = await api().write("maplocal.rule.delete", { baseRevision: before.revision, id: "x" });
    expect(stale).toMatchObject({ ok: false, reason: "conflict", revision: after.revision });
  });

  test("live requests arrive on network.observe and maplocal.requests.observe", async () => {
    uninstall();
    uninstall = installMockBridge({ liveMs: 5 });
    const network: NetworkSummary[] = [];
    const ours: RequestEvent[] = [];
    await api().observeNetwork((r) => network.push(r), () => undefined);
    await api().observeRequests((e) => ours.push(e), () => undefined);
    await new Promise((r) => setTimeout(r, 60));
    expect(network.length).toBeGreaterThan(0);
    expect(ours.length).toBeGreaterThan(0);
  });
});
