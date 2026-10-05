//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test, vi } from "vitest";
import type { NetworkSummary, RequestEvent } from "../../src/types";

const counter = vi.hoisted(() => ({ pairKey: 0 }));
vi.mock("../../src/traffic/keys", async (original) => {
  const real = await original<typeof import("../../src/traffic/keys")>();
  return {
    ...real,
    pairKey: (...args: Parameters<typeof real.pairKey>) => {
      counter.pairKey += 1;
      return real.pairKey(...args);
    },
  };
});
const { OrderDetector } = await import("../../src/traffic/order");

const net = (id: string, at: number): NetworkSummary => ({
  id,
  method: "GET",
  url: "https://api.invalid/poll",
  host: "api.invalid",
  startedAtMilliseconds: at,
  state: "completed",
});
const pass = (seq: number, at: number): RequestEvent => ({
  seq,
  date: at,
  method: "GET",
  host: "api.invalid",
  path: "/poll",
  query: {},
  outcome: { passthrough: {} },
});

/**
 * A panel clock past the subscription grace period (2 seconds). Device time t counts as arriving at
 * panel time base+t.
 */
const base = 10_000;
function detector() {
  const clock = { now: 0 };
  const d = new OrderDetector(() => clock.now);
  d.reset("l1");
  d.networkStarted();
  const at = (t: number) => { clock.now = base + t; return d; };
  return { d, at, judge: (t: number) => at(t).warning() };
}

test("builds the request key once per record, however many times it judges", () => {
  const { at, judge } = detector();
  counter.pairKey = 0;
  for (let i = 0; i < 300; i += 1) {
    at(i * 10).liveNetwork(net(`n${i}`, i * 10)); at(i * 10).liveOurs(pass(i, i * 10 + 1));
    judge(i * 10 + 2);
  }
  expect(counter.pairKey).toBeLessThanOrEqual(600);
});

test("one judgement finishes within a few ms even with 5000 records", () => {
  const { at, judge } = detector();
  for (let i = 0; i < 2500; i += 1) {
    at(i * 10).liveNetwork(net(`n${i}`, i * 10)); at(i * 10).liveOurs(pass(i, i * 10 + 1));
    if (i % 500 === 499) judge(i * 10 + 2);
  }
  judge(25_000);
  const start = performance.now();
  expect(judge(25_010)).toBe(false);
  expect(performance.now() - start).toBeLessThan(20);
});

test("stops gathering evidence once the warning is raised", () => {
  const { at, judge } = detector();
  for (let i = 0; i < 3; i += 1)
    at(i * 100).liveOurs({
      ...pass(i, i * 100),
      path: "/m",
      outcome: { mocked: { rule: "r", response: "ok", status: 200 } },
    });
  expect(judge(2000)).toBe(true);
  counter.pairKey = 0;
  for (let i = 0; i < 100; i += 1) {
    at(3000 + i).liveNetwork(net(`late${i}`, 3000 + i));
    at(3000 + i).liveOurs(pass(100 + i, 3000 + i));
  }
  expect(counter.pairKey).toBe(0);
  expect(judge(9000)).toBe(true);
});
