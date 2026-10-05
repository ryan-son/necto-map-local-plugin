//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import { OrderDetector } from "../../src/traffic/order";
import type { NetworkSummary, RequestEvent } from "../../src/types";

const net = (id: string, at: number, path = "/a"): NetworkSummary => ({
  id,
  method: "GET",
  url: `https://api.invalid${path}`,
  host: "api.invalid",
  startedAtMilliseconds: at,
  state: "completed",
});
const mocked = (seq: number, at: number): RequestEvent => ({
  seq,
  date: at,
  method: "GET",
  host: "api.invalid",
  path: "/m",
  query: {},
  outcome: { mocked: { rule: "r", response: "ok" } },
});
const pass = (seq: number, at: number): RequestEvent => ({
  seq,
  date: at,
  method: "GET",
  host: "api.invalid",
  path: "/a",
  query: {},
  outcome: { passthrough: {} },
});

/**
 * The panel clock, set past the subscription grace period (2 seconds); evidence at device time t
 * counts as arriving at panel time base+t.
 */
const base = 10_000;
function detector(launch = "l1") {
  const clock = { now: 0 };
  const d = new OrderDetector(() => clock.now);
  d.reset(launch);
  d.networkStarted();
  const at = (t: number) => { clock.now = base + t; return d; };
  const judge = (t: number) => { clock.now = base + t; return d.warning(); };
  return { d, at, judge, clock };
}

test("warns when three mocks have no pair in Necto's live records", () => {
  const { at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveOurs(mocked(i, t));
  expect(judge(2000)).toBe(true);
});

test("does not warn when the mocks show in Necto's records", () => {
  const { at, judge } = detector();
  for (const [i, t] of [
    [1, 100],
    [2, 200],
    [3, 300],
  ]) {
    at(t).liveNetwork(net(`n${i}`, t - 1, "/m"));
    at(t).liveOurs(mocked(i, t));
  }
  expect(judge(2000)).toBe(false);
});

test("warns when two passthroughs map to one Necto record three times (the signature of reversed registration)", () => {
  const { at, judge } = detector();
  for (const t of [100, 300, 500]) {
    at(t).liveNetwork(net(`n${t}`, t));
    at(t).liveOurs(pass(t, t - 5));
    at(t).liveOurs(pass(t + 1, t + 2));
  }
  expect(judge(2000)).toBe(true);
});

test("counts again on a new launch", () => {
  const { d, at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveOurs(mocked(i, t));
  d.reset("l2");
  expect(judge(2000)).toBe(false);
});

test("does not judge on evidence younger than 1 second", () => {
  const { at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveOurs(mocked(i, t));
  expect(judge(800)).toBe(false);
});

test("does not judge before the Necto network subscription", () => {
  const clock = { now: base };
  const d = new OrderDetector(() => clock.now);
  d.reset("l1");
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) d.liveOurs(mocked(i, t));
  clock.now = base + 2000;
  expect(d.warning()).toBe(false);
});

test("clears the subscription mark too on a new launch", () => {
  const { d, at, judge } = detector();
  d.reset("l2");
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveOurs(mocked(i, t));
  expect(judge(2000)).toBe(false);
});

test("does not warn when two identical requests go out together and yield two passthroughs and two Necto records", () => {
  const { at, judge } = detector();
  for (const t of [100, 300, 500]) {
    at(t).liveNetwork(net(`a${t}`, t)); at(t).liveNetwork(net(`b${t}`, t + 1));
    at(t).liveOurs(pass(t, t - 5)); at(t).liveOurs(pass(t + 1, t + 2));
  }
  expect(judge(2000)).toBe(false);
});

test("one Necto record does not cover several mocks", () => {
  const { at, judge } = detector();
  at(99).liveNetwork(net("n1", 99, "/m"));
  for (const [i, t] of [[1, 100], [2, 110], [3, 120], [4, 130]]) at(t).liveOurs(mocked(i, t));
  expect(judge(2000)).toBe(true);
});

test("counts the same seq arriving twice as one", () => {
  const { at, judge } = detector();
  for (const t of [100, 300, 500]) {
    at(t).liveNetwork(net(`n${t}`, t));
    at(t).liveOurs(pass(t, t - 5));
    at(t).liveOurs(pass(t, t - 5));
  }
  expect(judge(2000)).toBe(false);
});

test("counts the same Necto id arriving twice as one", () => {
  const { at, judge } = detector();
  at(99).liveNetwork(net("same", 99, "/m")); at(99).liveNetwork(net("same", 99, "/m"));
  for (const [i, t] of [[1, 100], [2, 110], [3, 120], [4, 130]]) at(t).liveOurs(mocked(i, t));
  expect(judge(2000)).toBe(true);
});

test("a raised warning is not cleared by late Necto records, only by a new launch", () => {
  const { d, at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveOurs(mocked(i, t));
  expect(judge(2000)).toBe(true);
  at(2100).liveNetwork(net("late", 100, "/m"));
  expect(judge(5000)).toBe(true);
  d.reset("l2");
  d.networkStarted();
  expect(judge(9000)).toBe(false);
});

test("does not warn when passthroughs and Necto records keep arriving 1:1, whenever it judges", () => {
  const { at, judge } = detector();
  for (let i = 0; i < 500; i += 1) {
    at(i * 10).liveNetwork(net(`n${i}`, i * 10)); at(i * 10 + 3).liveOurs(pass(i, i * 10 + 3));
    expect(judge(i * 10 + 4)).toBe(false);
  }
  expect(judge(60_000)).toBe(false);
});

test("warns when two passthroughs map to one Necto record three times, even when judging after every record", () => {
  const { at, judge } = detector();
  for (const t of [1000, 1300, 1600]) {
    at(t).liveNetwork(net(`n${t}`, t)); at(t).liveOurs(pass(t, t - 5)); at(t).liveOurs(pass(t + 1, t + 2));
    expect(judge(t + 3)).toBe(false);
  }
  expect(judge(3000)).toBe(true);
});

// The device clock can drift from the Mac's. Evidence ages by its arrival time at the panel, and
// device times are used only for proximity to each other.
test.each([5000, -5000])("does not warn on paired records even when the device clock is %ims off from the panel", (skew) => {
  const { at, judge } = detector();
  // Even when judging falls between our record's arrival and the Necto record's, unaged evidence is not judged
  for (const [i, t] of [
    [1, 100],
    [2, 200],
    [3, 300],
  ]) {
    at(t).liveOurs(mocked(i, t + skew));
    expect(judge(t)).toBe(false);
    at(t + 5).liveNetwork(net(`n${i}`, t + skew - 1, "/m"));
  }
  for (const t of [500, 700, 900]) { at(t).liveNetwork(net(`p${t}`, t + skew)); at(t).liveOurs(pass(t, t + skew + 3)); }
  for (const t of [400, 1000, 1500, 2000, 3000, 10_000]) expect(judge(t)).toBe(false);
});

test.each([5000, -5000])("warns on three unpaired mocks once they are 1 second old, even when the device clock is %ims off from the panel", (skew) => {
  const { at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveOurs(mocked(i, t + skew));
  expect(judge(1200)).toBe(false);
  expect(judge(1300)).toBe(true);
});

test("does not count unpaired mocks arriving together within 2 seconds of the Necto subscription (records queued before ready)", () => {
  const clock = { now: 0 };
  const d = new OrderDetector(() => clock.now);
  d.reset("l1");
  d.networkStarted();
  clock.now = 50;
  for (const i of [1, 2, 3]) d.liveOurs(mocked(i, 100 + i));
  clock.now = 5000;
  expect(d.warning()).toBe(false);
});

test("warns on three unpaired mocks after the grace period", () => {
  const clock = { now: 0 };
  const d = new OrderDetector(() => clock.now);
  d.reset("l1");
  d.networkStarted();
  clock.now = 2000;
  for (const i of [1, 2, 3]) d.liveOurs(mocked(i, 100 + i));
  clock.now = 3000;
  expect(d.warning()).toBe(true);
});

test("restarts the grace period when the Necto subscription is attached again", () => {
  const clock = { now: 0 };
  const d = new OrderDetector(() => clock.now);
  d.reset("l1");
  d.networkStarted();
  clock.now = 60_000;
  d.networkStarted();
  clock.now = 60_100;
  for (const i of [1, 2, 3]) d.liveOurs(mocked(i, 100 + i));
  clock.now = 65_000;
  expect(d.warning()).toBe(false);
});

test("finds the pair even when our record arrives after the Necto record", () => {
  const { at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveNetwork(net(`n${i}`, t - 1, "/m"));
  for (const [i, t] of [
    [1, 100],
    [2, 200],
    [3, 300],
  ]) {
    at(t + 3000).liveOurs(mocked(i, t));
    expect(judge(t + 3000)).toBe(false);
  }
  expect(judge(8000)).toBe(false);
});

test("does not warn on only two unpaired mocks (one miss is noise)", () => {
  const { at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 300]]) at(t).liveOurs(mocked(i, t));
  expect(judge(5000)).toBe(false);
});

test("does not warn when a passthrough recorded beside a Necto record happens only twice", () => {
  const { at, judge } = detector();
  for (const t of [100, 300]) {
    at(t).liveNetwork(net(`n${t}`, t));
    at(t).liveOurs(pass(t, t - 5));
    at(t).liveOurs(pass(t + 1, t + 2));
  }
  expect(judge(5000)).toBe(false);
});

test.each([[50, false], [-50, false], [51, true], [-51, true]])("warns only past ±50ms between a mock's and a Necto record's start: a %ims gap gives %s", (gap, warns) => {
  const { at, judge } = detector();
  for (const [i, t] of [
    [1, 100],
    [2, 400],
    [3, 700],
  ]) {
    at(t).liveNetwork(net(`n${i}`, t + gap, "/m"));
    at(t).liveOurs(mocked(i, t));
  }
  expect(judge(3000)).toBe(warns);
});

test("keeps the gathered evidence and the warning when a state notification of the same launch calls reset again", () => {
  const { d, at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200]]) at(t).liveOurs(mocked(i, t));
  expect(judge(1500)).toBe(false);
  d.reset("l1");
  at(1600).liveOurs(mocked(3, 1600));
  expect(judge(3000)).toBe(true);
  d.reset("l1");
  expect(judge(4000)).toBe(true);
});

test("counts our record numbers already seen in the previous launch as evidence again in a new launch", () => {
  const { d, at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 200], [3, 300]]) at(t).liveOurs(mocked(i, t));
  d.reset("l2");
  d.networkStarted();
  for (const [i, t] of [[1, 3100], [2, 3200], [3, 3300]]) at(t).liveOurs(mocked(i, t));
  expect(judge(6000)).toBe(true);
});

test("counts records with Necto ids already seen in the previous launch as evidence again in a new launch", () => {
  const { d, at, judge } = detector();
  for (const i of [1, 2, 3]) at(100 * i).liveNetwork(net(`n${i}`, 100 * i, "/m"));
  d.reset("l2");
  d.networkStarted();
  for (const i of [1, 2, 3]) {
    at(3000 + 300 * i).liveNetwork(net(`n${i}`, 3000 + 300 * i, "/m"));
    at(3000 + 300 * i).liveOurs(mocked(i, 3000 + 300 * i));
  }
  expect(judge(6000)).toBe(false);
});

test("does not carry over the unpaired mock count of the previous launch into a new launch", () => {
  const { d, at, judge } = detector();
  for (const [i, t] of [[1, 100], [2, 300]]) at(t).liveOurs(mocked(i, t));
  expect(judge(2000)).toBe(false);
  d.reset("l2");
  d.networkStarted();
  at(4000).liveOurs(mocked(9, 4000));
  expect(judge(6500)).toBe(false);
});
