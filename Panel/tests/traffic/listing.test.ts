//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import { endpointTemplate, pairKey, splitURL } from "../../src/traffic/keys";
import { groups, visible, type Filters } from "../../src/traffic/listing";
import type { TrafficEntry } from "../../src/types";

const entry = (over: Partial<TrafficEntry>): TrafficEntry => ({
  key: Math.random().toString(),
  method: "GET",
  host: "api.invalid",
  path: "/a",
  query: {},
  startedAt: 0,
  state: "completed",
  status: 200,
  result: "passthrough",
  ...over,
});
const none: Filters = { search: "", allowedOnly: false, statuses: new Set(), results: new Set() };

test("replaces only numeric, UUID and long hexadecimal segments with {id}", () => {
  expect(endpointTemplate("/devices/3/logs")).toBe("/devices/{id}/logs");
  expect(endpointTemplate("/u/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("/u/{id}");
  expect(endpointTemplate("/h/0123456789abcdef0123")).toBe("/h/{id}");
  expect(endpointTemplate("/devices/summary")).toBe("/devices/summary");
  expect(endpointTemplate("/apt-00123")).toBe("/apt-00123");
});

test("splits a URL into host without port, path and query, keeping values as they are", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";
  expect(splitURL(`https://API.invalid:8443/v/${jwt}?page=2&access_token=x`)).toEqual({
    host: "api.invalid",
    path: `/v/${jwt}`,
    query: { page: "2", access_token: "x" },
  });
});

test("the pairing key ignores query order", () => {
  expect(pairKey("GET", "h", "/a", { b: "2", a: "1" })).toBe(pairKey("get", "h", "/a", { a: "1", b: "2" }));
});

test("different hosts make different groups even with the same path", () => {
  const { groups: g } = groups(
    [entry({ host: "a.invalid", path: "/x/1" }), entry({ host: "b.invalid", path: "/x/2" })],
    [],
  );
  expect(g).toHaveLength(2);
});

test("groups keep the order first seen and do not move when new samples arrive", () => {
  const first = groups([entry({ path: "/a", startedAt: 1 }), entry({ path: "/b", startedAt: 2 })], []);
  const again = groups(
    [
      entry({ path: "/a", startedAt: 3 }),
      entry({ path: "/a", startedAt: 1 }),
      entry({ path: "/b", startedAt: 2 }),
    ],
    first.order,
  );
  expect(again.groups.map((g) => g.template)).toEqual(first.groups.map((g) => g.template));
  expect(again.groups.find((g) => g.template === "/a")!.samples.map((s) => s.startedAt)).toEqual([3, 1]);
});

test("allowed hosts only hides other hosts and counts the hidden, and filters nothing without allowed hosts", () => {
  const list = [entry({ host: "api.invalid" }), entry({ host: "firebase.invalid" })];
  expect(visible(list, { ...none, allowedOnly: true }, ["api.invalid"])).toMatchObject({ hiddenByHost: 1 });
  expect(visible(list, { ...none, allowedOnly: true }, []).shown).toHaveLength(2);
});

test("chips of the same kind combine with OR, and kinds combine with AND", () => {
  const list = [
    entry({ status: 200, result: "mocked" }),
    entry({ status: 404, result: "passthrough" }),
    entry({ status: 200, result: "passthrough" }),
  ];
  const f: Filters = { ...none, statuses: new Set(["2xx", "4xx"]), results: new Set(["passthrough"]) };
  expect(visible(list, f, []).shown).toHaveLength(2);
});

test("search matches parts of the method, host and path", () => {
  expect(visible([entry({ path: "/api/devices" })], { ...none, search: "devices" }, []).shown).toHaveLength(1);
  expect(visible([entry({ path: "/api/devices" })], { ...none, search: "post" }, []).shown).toHaveLength(0);
});

test("search also matches the query string the app sent (?a=1&b=2)", () => {
  const sent = entry({
    path: "/api/sites",
    query: { siteId: "101", page: "2" },
    url: "https://api.invalid/api/sites?siteId=101&page=2",
  });
  expect(visible([sent], { ...none, search: "page=2" }, []).shown).toHaveLength(1);
  expect(visible([sent], { ...none, search: "siteid=101&page" }, []).shown).toHaveLength(1);
  expect(visible([sent], { ...none, search: "?siteId" }, []).shown).toHaveLength(1);
  expect(visible([sent], { ...none, search: "page=3" }, []).shown).toHaveLength(0);
});

test("finds a request without a Necto record by the same query (key=value) the detail shows", () => {
  const ours = entry({ path: "/api/sites", query: { page: "2" } });
  expect(visible([ours], { ...none, search: "sites?page=2" }, []).shown).toHaveLength(1);
});

test("finds a percent-encoded query by its decoded text too", () => {
  const sent = entry({ path: "/s", query: { q: "한글" }, url: "https://api.invalid/s?q=%ED%95%9C%EA%B8%80" });
  expect(visible([sent], { ...none, search: "q=한글" }, []).shown).toHaveLength(1);
  expect(visible([sent], { ...none, search: "%ED%95%9C" }, []).shown).toHaveLength(1);
});
