//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test, vi } from "vitest";
import { debounce, Writer } from "../src/writer";
import { FakeAPI } from "./fake-api";

test("sequential writes go out one at a time, each with the revision the previous write returned", async () => {
  const api = new FakeAPI();
  let known = 0;
  const writer = new Writer(api, () => known, (r) => { if (r.ok) known = r.revision; });
  await Promise.all([
    writer.submit("maplocal.configuration.patch", { enabled: false }),
    writer.submit("maplocal.configuration.patch", { enabled: true }),
    writer.submit("maplocal.rule.delete", { id: "a" }),
  ]);
  expect(api.writes.map((w) => w.input.baseRevision)).toEqual([0, 1, 2]);
  expect(api.writes.map((w) => w.op)).toEqual([
    "maplocal.configuration.patch",
    "maplocal.configuration.patch",
    "maplocal.rule.delete",
  ]);
});

test("on conflict, resends once with the latest revision, and returns that result if it conflicts again", async () => {
  const api = new FakeAPI();
  let known = 0;
  const writer = new Writer(api, () => known, (r) => { known = r.revision; });
  api.results = [
    { ok: false, reason: "conflict", message: "", revision: 5 },
    { ok: true, revision: 6 },
  ];
  const first = await writer.submit("maplocal.configuration.patch", { enabled: false });
  expect(first).toEqual({ ok: true, revision: 6 });
  expect(api.writes.map((w) => w.input.baseRevision)).toEqual([0, 5]);

  api.results = [
    { ok: false, reason: "conflict", message: "", revision: 8 },
    { ok: false, reason: "conflict", message: "", revision: 9 },
  ];
  const second = await writer.submit("maplocal.configuration.patch", { enabled: true });
  expect(second.ok).toBe(false);
  expect(api.writes).toHaveLength(4);
});

test("the next write goes out even when the previous write throws", async () => {
  const api = new FakeAPI();
  const original = api.write.bind(api);
  let calls = 0;
  api.write = async (op, input) => {
    calls += 1;
    if (calls === 1) throw new Error("TARGET_DISCONNECTED");
    return original(op, input);
  };
  const writer = new Writer(api, () => 0, () => {});
  await expect(writer.submit("maplocal.configuration.patch", { enabled: false })).rejects.toThrow();
  await expect(writer.submit("maplocal.configuration.patch", { enabled: true })).resolves.toEqual({
    ok: true,
    revision: 1,
  });
});

test("debounce runs only the last call, once, after the set delay, and flush runs it immediately", () => {
  vi.useFakeTimers();
  const seen: number[] = [];
  const d = debounce((n: number) => seen.push(n), 400);
  d.call(1); d.call(2);
  vi.advanceTimersByTime(399);
  expect(seen).toEqual([]);
  expect(d.pending()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(seen).toEqual([2]);
  d.call(3); d.flush();
  expect(seen).toEqual([2, 3]);
  expect(d.pending()).toBe(false);
  vi.useRealTimers();
});
