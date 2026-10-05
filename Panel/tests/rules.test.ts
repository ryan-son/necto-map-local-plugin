//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import {
  isRule,
  newRule,
  queryLabel,
  queryValueHint,
  readQuery,
  ruleFromRequest,
  ruleLabel,
  uniqueId,
} from "../src/rules";
import type { NetworkDetail, RequestEvent, Rule } from "../src/types";

const event = (path = "/api/x", method = "GET"): RequestEvent => ({
  seq: 0, query: {}, date: 0, method, host: "dev.invalid", path, outcome: { passthrough: {} },
});

test("appends a number to keep ids from colliding", () => {
  expect(uniqueId("get-api-x", [])).toBe("get-api-x");
  expect(uniqueId("get-api-x", ["get-api-x", "get-api-x-2"])).toBe("get-api-x-3");
});

test("a new rule is on and has one empty JSON 200 response active, written as body text like every other the panel writes", () => {
  const r = newRule(["get"]);
  expect(r.id).toBe("get-2"); // Named after the method and path, as capture does (Q3)
  expect(r.enabled).toBe(true);
  expect(r.responses[r.active]).toEqual({ status: 200, headers: { "Content-Type": "application/json" }, body: "{}" });
});

test("a rule made from a record matches that request's method, host and path", () => {
  const r = ruleFromRequest(event("/api/devices/A1"), []);
  expect(r.match).toEqual({ method: "GET", host: "dev.invalid", path: "/api/devices/A1" });
  expect(r.id).toBe("get-api-devices-a1");
});

test("a rule made from a record does not copy the actual response and holds an empty 200 — responses move only through capture", () => {
  const detail: NetworkDetail = {
    id: "1",
    method: "GET",
    url: "https://dev.invalid/api/x",
    host: "dev.invalid",
    startedAtMilliseconds: 0,
    state: "completed",
    requestHeaders: {},
    statusCode: 201,
    responseHeaders: { "Set-Cookie": "sid=real" },
    responseBody: {
      byteCount: 10,
      isTruncated: false,
      contentType: "application/json",
      text: '{"password":"real"}',
    },
  };
  const loose = ruleFromRequest as (...args: unknown[]) => Rule;
  const r = loose(event(), [], detail);
  expect(r.responses).toEqual({ ok: { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } });
});

test("does not treat an unsupported rule that arrived as raw text as a rule", () => {
  expect(isRule({ id: "x", match: { method: "GET", path: "/x" }, active: "a", responses: { a: {} } })).toBe(true);
  expect(isRule({ future: 1 })).toBe(false);
});

test("query conditions show as ?key=value&key=value in the order entered, and as empty text when there are none", () => {
  expect(queryLabel({ page: "2", siteId: "101" })).toBe("?page=2&siteId=101");
  expect(queryLabel({})).toBe("");
  expect(queryLabel(undefined)).toBe("");
  expect(
    ruleLabel({
      ...newRule([]),
      match: { method: "GET", path: "/api/sites", query: { page: "2" } },
    }),
  ).toBe("GET /api/sites ?page=2");
  expect(ruleLabel({ ...newRule([]), match: { method: "GET", path: "/api/sites" } })).toBe("GET /api/sites");
});

test("reads query condition rows into the string object the engine takes, skipping rows that are entirely empty", () => {
  expect(
    readQuery([
      { key: "page", value: "2" },
      { key: "", value: "" },
      { key: "q", value: "" },
    ]),
  ).toEqual({ ok: true, query: { page: "2", q: "" } });
  expect(readQuery([])).toEqual({ ok: true, query: {} });
});

test("empty and duplicate keys get a reason on their row and are not read", () => {
  expect(
    readQuery([
      { key: "", value: "2" },
      { key: "page", value: "1" },
      { key: "page", value: "2" },
      { key: "  ", value: "x" },
    ]),
  ).toEqual({
    ok: false,
    problems: ["키를 입력하세요", undefined, "같은 키가 이미 있습니다", "키를 입력하세요"],
  });
});

test("trims whitespace around keys — keys that differ only in whitespace are the same key", () => {
  expect(readQuery([{ key: " page ", value: "2" }])).toEqual({ ok: true, query: { page: "2" } });
  expect(readQuery([{ key: "page", value: "1" }, { key: "page ", value: "2" }]))
    .toEqual({ ok: false, problems: [undefined, "같은 키가 이미 있습니다"] });
});

test.each(["page=2", "a&b", "a?b", "a#b"])("a key containing = & ? # (%s) cannot match, because the engine does not split on that key — gives a reason", (key) => {
  expect(readQuery([{ key, value: "" }])).toEqual({ ok: false, problems: ["키에 = & ? #는 쓸 수 없습니다"] });
});

test("a __proto__ key stays a condition (the rule is not saved without conditions)", () => {
  const read = readQuery([{ key: "__proto__", value: "1" }]);
  expect(read.ok && Object.entries(read.query)).toEqual([["__proto__", "1"]]);
  expect(read.ok && JSON.parse(JSON.stringify(read.query))).toEqual(JSON.parse('{"__proto__":"1"}'));
});

test.each([
  ["%ED%95%9C", "한"],
  ["a%20b", "a b"],
  ["a+b", undefined], ["100%", undefined], ["a%2", undefined], ["%E0%A4", undefined], ["", undefined],
] as Array<[string, string | undefined]>)("the query value %j gets a percent-encoding hint only when it decodes to other text", (value, decoded) => {
  expect(queryValueHint(value)).toBe(
    decoded === undefined ? undefined : `%XX는 풀어서 비교합니다 — 원래 글자로 입력하세요(「${decoded}」)`,
  );
});

test("a rule made from a record does not copy the query, and moves it into query conditions only on request", () => {
  const e = { ...event("/api/sites"), query: { page: "2" } };
  expect(ruleFromRequest(e, []).match).toEqual({ method: "GET", host: "dev.invalid", path: "/api/sites" });
  expect(ruleFromRequest(e, [], true).match).toEqual({
    method: "GET",
    host: "dev.invalid",
    path: "/api/sites",
    query: { page: "2" },
  });
});
