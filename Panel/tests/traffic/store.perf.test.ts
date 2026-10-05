//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test, vi } from "vitest";
import type { NetworkSummary } from "../../src/types";

const counter = vi.hoisted(() => ({ splitURL: 0 }));
vi.mock("../../src/traffic/keys", async (original) => {
  const real = await original<typeof import("../../src/traffic/keys")>();
  return { ...real, splitURL: (url: string) => { counter.splitURL += 1; return real.splitURL(url); } };
});
const { TrafficStore } = await import("../../src/traffic/store");

const net = (i: number): NetworkSummary => ({
  id: `n${i}`,
  method: "GET",
  url: `https://api.invalid/a/${i}`,
  host: "api.invalid",
  startedAtMilliseconds: i,
  state: "completed",
  statusCode: 200,
});

test("splits each record's URL once even when records arrive one at a time", () => {
  const s = new TrafficStore(() => undefined);
  counter.splitURL = 0;
  for (let i = 0; i < 300; i += 1) s.ingestNetwork([net(i)]);
  expect(counter.splitURL).toBeLessThanOrEqual(300);
});

test("does not rebuild the list or the selected request on repeated reads when nothing changed", () => {
  const s = new TrafficStore(() => undefined);
  s.ingestNetwork(Array.from({ length: 300 }, (_, i) => net(i)));
  s.entries();
  counter.splitURL = 0;
  for (let i = 0; i < 40; i += 1) { s.entries(); s.liveEntry(`n${i}`); }
  expect(counter.splitURL).toBe(0);
});
