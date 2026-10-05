//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import { exportText, parseImport, secretWarning } from "../src/transfer";
import { configuration, rule } from "./fake-api";
import type { Rule } from "../src/types";

test("import accepts both the envelope ({force, configuration}) and the configuration itself", () => {
  const c = configuration();
  expect(parseImport(JSON.stringify({ force: true, configuration: c }))).toEqual({ configuration: c });
  expect(parseImport(JSON.stringify(c))).toEqual({ configuration: c });
});

test("returns a reason when the text is not JSON or not shaped like a configuration", () => {
  expect(parseImport("{")).toHaveProperty("error");
  expect(parseImport("[1]")).toHaveProperty("error");
  expect(parseImport(JSON.stringify({ rules: [] }))).toHaveProperty("error");
});

test("the export text is an envelope ready for necto-cli --input-file", () => {
  const c = configuration();
  expect(JSON.parse(exportText(c))).toEqual({ force: true, configuration: c });
});

test("imports a pasted configuration even when its quotes were turned into curly quotes", () => {
  const c = configuration();
  const curly = JSON.stringify(c).replace(/"/g, (_, i: number) => (i % 2 === 0 ? "“" : "”"));
  expect(parseImport(curly)).toEqual({ configuration: c });
});

const withResponse = (spec: object, match: object = {}) => {
  const r = rule("a");
  return configuration([{ ...r, match: { ...r.match, ...match }, responses: { ok: { status: 200, ...spec } } }]);
};

test.each([
  ["JWT in the body", withResponse({ json: { accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln" } })],
  ["unsigned JWT", withResponse({ body: "t=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0." })],
  ["JWT in a match query", withResponse({}, { query: { t: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln" } })],
  ["Authorization header", withResponse({ headers: { authorization: "Bearer opaque" } })],
  ["Cookie header", withResponse({ headers: { Cookie: "s=1" } })],
  ["Set-Cookie header", withResponse({ headers: { "Set-Cookie": "s=1; HttpOnly" } })],
  ["auth rule (auth tag)", configuration([{ ...rule("a"), tags: ["auth"] }])],
  ["opaque access_token in body JSON", withResponse({ json: { data: { access_token: "ya29.a0Af" } } })],
  ["refreshToken in body text (JSON)", withResponse({ body: '{"refreshToken":"ghp_x1"}' })],
  ["password in a body JSON array", withResponse({ json: [{ password: "hunter2" }] })],
  ["X-Auth-Token response header", withResponse({ headers: { "X-Auth-Token": "opaque" } })],
  ["X-API-Key response header", withResponse({ headers: { "X-API-Key": "k" } })],
  ["access_token key in a match query", withResponse({}, { query: { access_token: "abc123def" } })],
  ["sessionId in body JSON", withResponse({ json: { sessionId: 42 } })],
  ["client_secret in body JSON", withResponse({ json: { client_secret: "s" } })],
])("copy warning — %s: reported in one line", (_n, c) => {
  expect(secretWarning(c)).toBe("토큰처럼 보이는 값이 들어 있습니다 — 공유하기 전에 확인하세요");
});

test.each([
  ["configuration without tokens", configuration()],
  ["empty Authorization header", withResponse({ headers: { Authorization: "" } })],
  ["text starting with eyJ but not shaped like a JWT", withResponse({ body: "eyJ.only" })],
  ["token key with an empty value", withResponse({ json: { token: "", password: null } })],
  [
    "response named like a token (a response name is not a key)",
    configuration([{ ...rule("a"), active: "session", responses: { session: { status: 200 } } }]),
  ],
  ["the word token in non-JSON body text", withResponse({ body: "token expired" })],
])("copy warning — %s: not reported", (_n, c) => {
  expect(secretWarning(c)).toBeUndefined();
});

test.each([
  ["headers", withResponse({ headers: { Authorization: "Bearer real" } })],
  [
    "key names and auth tag",
    configuration([
      {
        ...rule("a"),
        tags: ["auth"],
        match: { ...rule("a").match, query: { access_token: "real" } },
        responses: { ok: { status: 200, json: { password: "real" } } },
      },
    ]),
  ],
])(
  "the warning does not change values — the copied text is the configuration as is (%s)",
  (_n, c) => {
    const before = structuredClone(c);
    secretWarning(c);
    expect(c).toEqual(before);
    expect(JSON.parse(exportText(c)).configuration).toEqual(before);
  },
);

test("the warning check does not stop on rule entries that are not objects (null, text)", () => {
  const c = configuration([
    null as unknown as Rule,
    "x" as unknown as Rule,
    { ...rule("a"), responses: { ok: { status: 200, headers: { Cookie: "s=1" } } } },
  ]);
  expect(secretWarning(c)).toBe("토큰처럼 보이는 값이 들어 있습니다 — 공유하기 전에 확인하세요");
  expect(secretWarning(configuration([null as unknown as Rule]))).toBeUndefined();
});
