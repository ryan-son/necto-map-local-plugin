//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import type { JSONValue } from "../../src/types";
import { indentJSON } from "../../src/json";
import { addCapturedResponse, captureResponse, newRuleFromCapture, planCapture } from "../../src/traffic/capture";
import type { NetworkDetail, TrafficEntry } from "../../src/types";
import { rule } from "../fake-api";

const entry = (over: Partial<TrafficEntry> = {}): TrafficEntry => ({
  key: "1",
  networkID: "1",
  method: "GET",
  host: "maplocal.invalid",
  path: "/a/3",
  query: {},
  url: "https://maplocal.invalid/a/3",
  startedAt: 0,
  state: "completed",
  status: 200,
  result: "passthrough",
  ...over,
});
const detail = (over: Partial<NetworkDetail> = {}): NetworkDetail => ({
  id: "1",
  method: "GET",
  url: "https://maplocal.invalid/a/3",
  host: "maplocal.invalid",
  startedAtMilliseconds: 0,
  state: "completed",
  statusCode: 200,
  requestHeaders: {},
  responseHeaders: {
    "Content-Type": "application/json",
    "Content-Encoding": "gzip",
    "Set-Cookie": "s=1",
    Date: "x",
    "X-Trace": "t",
  },
  responseBody: {
    byteCount: 20,
    isTruncated: false,
    contentType: "application/json",
    text: '{"access_token":"real","n":1}',
  },
  ...over,
});

test("with a matching enabled rule, the label is 'Add this response to the rule' (K1), and a hint names the rule by method and path", () => {
  const r = rule("devices", "/a/{id}");
  expect(planCapture(entry(), detail(), [r])).toMatchObject({
    target: { id: "devices" },
    label: "이 응답을 규칙에 추가",
    hint: "GET /a/{id} 규칙에 응답으로 더합니다",
  });
});

test("without a matching rule it makes a new rule, and mentions a disabled rule that matches", () => {
  const off = { ...rule("off", "/a/{id}"), enabled: false };
  expect(planCapture(entry(), detail(), [off])).toMatchObject({
    target: undefined,
    disabledMatch: { id: "off" },
    label: "이 응답으로 목업",
  });
});

test.each([
  [{ result: "blocked" as const }, undefined, "blocked"],
  [{ result: "mocked" as const }, undefined, "mocked"],
  [{ state: "failed" as const }, undefined, "failed"],
  [{}, { responseBody: { byteCount: 9e6, isTruncated: true, text: "{" } }, "truncated"],
  [{}, { responseBody: { byteCount: 10, isTruncated: false, contentType: "image/png" } }, "noBody"],
])("cases that disable capture %#", (e, d, reason) => {
  expect(planCapture(entry(e), detail(d ?? {}), []).blockedBy).toBe(reason);
});

test("disables capture without a detail", () => {
  expect(planCapture(entry(), undefined, []).blockedBy).toBe("noDetail");
});

test("captures a 0-byte body, as in a 204, as an empty body", () => {
  const d = detail({ statusCode: 204, responseHeaders: {}, responseBody: { byteCount: 0, isTruncated: false } });
  expect(planCapture(entry({ status: 204 }), d, []).blockedBy).toBeUndefined();
  expect(captureResponse(d).spec).toEqual({ status: 204, body: "" });
});

test("capture drops the transport, cookie and our marker headers, and copies values as they are", () => {
  const c = captureResponse(detail({ responseHeaders: { ...detail().responseHeaders, "X-Map-Local": "r/ok" } }));
  expect(c.spec.headers).toEqual({ "Content-Type": "application/json", "X-Trace": "t" });
  expect(c.spec.body).toBe(indentJSON(detail().responseBody?.text ?? ""));
});

test("adds to an existing rule as 'Captured response' without changing the active one, and as 'Captured response 2' when the name is taken", () => {
  const r = { ...rule("devices", "/a/{id}"), responses: { ok: { status: 200 }, "캡처한 응답": { status: 200 } } };
  const { rule: next, name } = addCapturedResponse(r, captureResponse(detail()));
  expect(name).toBe("캡처한 응답 2");
  expect(next.active).toBe("ok");
  expect(addCapturedResponse(next, captureResponse(detail())).name).toBe("캡처한 응답 3");
});

test("a new rule uses the chosen path and makes 'Captured response' active", () => {
  const r = newRuleFromCapture([], entry(), "/a/{id}", captureResponse(detail()));
  expect(r.match).toEqual({ method: "GET", host: "maplocal.invalid", path: "/a/{id}" });
  expect(r.active).toBe("캡처한 응답");
  expect(Object.keys(r.responses)).toEqual(["캡처한 응답"]);
});

const jwtSigned = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";
const withBody = (text: string, contentType?: string) =>
  detail({ responseBody: { byteCount: text.length, isTruncated: false, contentType, text } });

test.each([
  ["form encoding", "access_token=abc&refresh_token=def&expires_in=3600", "application/x-www-form-urlencoded"],
  ["a signed JWT in HTML", `<a href="/cb?t=${jwtSigned}">go</a>`, "text/html"],
  ["JSONP", 'cb({"access_token":"real","n":1});', undefined],
])("copies a non-JSON body (%s) verbatim", (_n, text, contentType) => {
  expect(captureResponse(withBody(text, contentType)).spec.body).toBe(text);
});

test("keeps a JSON body as the exact text sent, BOM, spacing and key order included", () => {
  const text = '\uFEFF{ "zone": 1,\n  "alpha": {"y": 2, "b": 3} }';
  const c = captureResponse(withBody(text));
  expect(c.spec.body).toBe(text);
  expect(c.spec.json).toBeUndefined();
});

test("opens a one-line JSON body indented for editing, its values and key order as sent", () => {
  const c = captureResponse(withBody('{"b":1234567890123456789,"a":[1]}', "application/json"));
  expect(c.spec.body).toBe('{\n  "b": 1234567890123456789,\n  "a": [\n    1\n  ]\n}');
});

test("copies JWTs in header values and authorization and token-named headers as they are too", () => {
  const headers = { authorization: "Bearer x", "X-Auth-Token": "t", Location: `/cb?c=${jwtSigned}`, "X-Trace": "t" };
  const c = captureResponse(detail({ responseHeaders: headers, responseBody: { byteCount: 0, isTruncated: false } }));
  expect(c.spec.headers).toEqual(headers);
});

test.each([
  ["our mock marker", { "x-map-local": "r/ok" }, "mocked"],
  ["our block marker", { "X-Map-Local": "unmocked" }, "blocked"],
])("disables capture when the detail carries %s, even when the result is unknown", (_n, headers, reason) => {
  expect(planCapture(entry({ result: "unknown" }), detail({ responseHeaders: headers }), []).blockedBy).toBe(reason);
});

test("disables capture for a request still awaiting its response and for a completed detail without a status code", () => {
  expect(planCapture(entry({ state: "pending" }), detail(), []).blockedBy).toBe("pending");
  expect(planCapture(entry(), detail({ state: "pending" }), []).blockedBy).toBe("pending");
  expect(planCapture(entry(), detail({ statusCode: undefined }), []).blockedBy).toBe("noDetail");
  expect(planCapture(entry(), detail({ state: "failed" }), []).blockedBy).toBe("failed");
});

test.each([
  ["r/ok", "mocked"],
  ["unmocked", "blocked"],
])("X-Map-Local %s in the detail disables capture even when the result was computed as passed through", (tag, reason) => {
  expect(
    planCapture(
      entry({ result: "passthrough" }),
      detail({ responseHeaders: { "x-map-local": tag } }),
      [],
    ).blockedBy,
  ).toBe(reason);
});

test.each(["Content-Length", "transfer-encoding", "Connection"])("capture does not copy the %s header, which could disagree with the copied body", (name) => {
  const c = captureResponse(
    detail({
      responseHeaders: { "Content-Type": "application/json", [name]: "x", "X-Trace": "t" },
    }),
  );
  expect(c.spec.headers).toEqual({ "Content-Type": "application/json", "X-Trace": "t" });
});

// JSON.parse silently collapses duplicate keys and has a different depth limit from the engine's
// parser — such bodies are copied verbatim, not rewritten as JSON.
test("copies a JSON body with a duplicate key with both keys, instead of rewriting it as JSON", () => {
  const text = '{"x":1,"x":{"password":{"v":"leak"}}}';
  const c = captureResponse(withBody(text));
  expect(c.spec.json).toBeUndefined();
  expect(c.spec.body).toBe('{\n  "x": 1,\n  "x": {\n    "password": {\n      "v": "leak"\n    }\n  }\n}');
});

test("capture does not hang on a body nested 10000 levels deep, and copies it verbatim", () => {
  const deep = "[".repeat(10000) + '{"password":{"x":"leak"}}' + "]".repeat(10000);
  let c: ReturnType<typeof captureResponse> | undefined;
  expect(() => { c = captureResponse(withBody(deep)); }).not.toThrow();
  expect(c?.spec.body).toBe(deep);
});

test("copies a deeply nested JSON body verbatim at any depth", () => {
  const nested = (n: number) => "[".repeat(n) + '{"password":1}' + "]".repeat(n);
  expect(captureResponse(withBody(nested(127))).spec.body).toBe(nested(127));
  expect(captureResponse(withBody(nested(128))).spec.body).toBe(nested(128));
});

// Alone it runs under 0.4 seconds. A scan that grows with the square of the length takes minutes at
// 1MB and clearly exceeds it. The limit leaves room for parallel runs.
const pathological = [
  '"',
  "\\",
  '\\"',
  "=",
  "&",
  "a",
  " ",
  "{[",
  "eyJ",
  "eyJa.",
  "?token=x&",
].flatMap((unit) =>
  ["", "{", '{"', "x"].map(
    (prefix) =>
      prefix + unit.repeat(Math.floor((1 << 20) / unit.length)) + (prefix === "x" ? "x" : ""),
  ),
);
test.each(pathological.map((body) => [body.slice(0, 8), body]))("captures a pathological 1MB body (%s…) in time proportional to its length", (_n, body) => {
  const started = performance.now();
  captureResponse(withBody(body));
  expect(performance.now() - started).toBeLessThan(10_000);
});

test("copies a JSON-shaped body that does not parse as JSON verbatim, whatever its size", () => {
  const body = "{" + "a".repeat(4 << 20);
  expect(captureResponse(withBody(body)).spec.body).toBe(body);
});

test("a new rule moves the request's query into query conditions only on request", () => {
  const withQuery = entry({
    path: "/api/sites",
    query: { page: "2" },
    url: "https://maplocal.invalid/api/sites?page=2",
  });
  expect(newRuleFromCapture([], withQuery, "/api/sites", captureResponse(detail())).match).toEqual({
    method: "GET",
    host: "maplocal.invalid",
    path: "/api/sites",
  });
  expect(
    newRuleFromCapture([], withQuery, "/api/sites", captureResponse(detail()), { page: "2" }).match,
  ).toEqual({ method: "GET", host: "maplocal.invalid", path: "/api/sites", query: { page: "2" } });
});

test("finds a query-condition rule by query even for a request without a Necto record, and the hint names the condition too", () => {
  const paged = { ...rule("paged", "/api/sites"), match: { method: "GET", path: "/api/sites", query: { page: "2" } } };
  const ours = entry({ key: "ours:1", networkID: undefined, url: undefined, path: "/api/sites", query: { page: "2" } });
  expect(planCapture(ours, detail(), [paged])).toMatchObject({
    target: { id: "paged" },
    hint: "GET /api/sites ?page=2 규칙에 응답으로 더합니다",
  });
  expect(planCapture({ ...ours, query: { page: "3" } }, detail(), [paged]).target).toBeUndefined();
});

test("capture leaves out transport noise by default and counts what it left out (O9)", () => {
  const noise = {
    "Access-Control-Allow-Origin": "*",
    "access-control-expose-headers": "x",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    Expires: "0",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "X-XSS-Protection": "1",
    "Strict-Transport-Security": "max-age=1",
    Server: "nginx",
    "X-Message-Id": "m",
    "X-Request-Id": "r",
    "Request-Id": "r",
    "x-amzn-requestid": "a",
  };
  const kept = { "Content-Type": "application/json", "X-Total-Count": "3", Location: "/next", "X-Trace": "t" };
  const c = captureResponse(detail({ responseHeaders: { ...noise, ...kept, "X-Map-Local": "unmocked" } }));
  expect(c.spec.headers).toEqual(kept);
  expect(c.omitted).toEqual(Object.keys(noise));
});

test("the omitted count includes the transport and cookie headers that were always dropped, not our own marker", () => {
  const c = captureResponse(detail());
  expect(c.omitted).toEqual(["Content-Encoding", "Set-Cookie", "Date"]);
});
