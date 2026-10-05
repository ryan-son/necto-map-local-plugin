//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { describe, expect, test } from "vitest";
import type { Rule, TrafficEntry } from "../../src/types";
import { whyNotMocked, type WhyContext } from "../../src/traffic/why";

const entry = (over: Partial<TrafficEntry> = {}): TrafficEntry => ({
  key: "1",
  method: "GET",
  host: "api.invalid",
  path: "/a/3",
  query: {},
  url: "https://api.invalid/a/3",
  startedAt: 0,
  state: "completed",
  status: 200,
  result: "passthrough",
  ...over,
});
const devices = (over: Partial<Rule> = {}): Rule => ({
  id: "devices",
  match: { method: "GET", path: "/a/{id}" },
  active: "ok",
  responses: { ok: { status: 200 } },
  ...over,
});
const context = (over: Partial<WhyContext> = {}): WhyContext => ({
  rules: [devices()],
  enabled: true,
  allowedHosts: ["api.invalid"],
  isBlockedHost: () => false,
  ...over,
});

test("says nothing when no rule matches the request, whatever else is off", () => {
  expect(whyNotMocked(entry({ path: "/other", url: "https://api.invalid/other" }), context({ enabled: false, allowedHosts: [] }))).toBeUndefined();
});

test("Map Local switched off comes first", () => {
  expect(whyNotMocked(entry(), context({ enabled: false, allowedHosts: [] }))).toMatchObject({ kind: "off", rule: { id: "devices" } });
});

test("a host blocked in app code is named before anything the panel could fix", () => {
  expect(
    whyNotMocked(entry(), context({ enabled: false, isBlockedHost: (h) => h === "api.invalid" })),
  ).toMatchObject({ kind: "blockedHost", rule: { id: "devices" } });
});

test("a host that is not allowed", () => {
  expect(whyNotMocked(entry(), context({ allowedHosts: ["other.invalid"] }))).toMatchObject({
    kind: "hostNotAllowed",
    host: "api.invalid",
  });
});

test("only a rule that is off matches", () => {
  expect(whyNotMocked(entry(), context({ rules: [devices({ enabled: false })] }))).toMatchObject({
    kind: "ruleOff",
    rule: { id: "devices" },
  });
});

test("when everything is in place now, says the rule applies from the next request", () => {
  expect(whyNotMocked(entry(), context())).toMatchObject({ kind: "nowApplies", rule: { id: "devices" } });
});

test("a mocked request names a rule that also matches but lost to a more specific one", () => {
  const general = devices({ id: "general" });
  const paged = devices({ id: "paged", match: { method: "GET", path: "/a/{id}", query: { page: "2" } } });
  const mocked = entry({
    url: "https://api.invalid/a/3?page=2",
    query: { page: "2" },
    result: "mocked",
    mockedBy: { rule: "paged", response: "ok" },
  });
  expect(whyNotMocked(mocked, context({ rules: [general, paged] }))).toMatchObject({
    kind: "shadowed",
    rule: { id: "general" },
    winner: { id: "paged" },
  });
});

test("a mocked request with no other matching rule needs no reason", () => {
  const mocked = entry({ result: "mocked", mockedBy: { rule: "devices", response: "ok" } });
  expect(whyNotMocked(mocked, context())).toBeUndefined();
});

test("a rule for another host does not count as matching", () => {
  const elsewhere = devices({ match: { method: "GET", host: "other.invalid", path: "/a/{id}" } });
  expect(whyNotMocked(entry(), context({ rules: [elsewhere], enabled: false }))).toBeUndefined();
});

describe("a mocked request whose winner would not win now", () => {
  const general = devices({ id: "general" });
  const paged = devices({ id: "paged", match: { method: "GET", path: "/a/{id}", query: { page: "2" } } });
  const mockedByGeneral = entry({
    url: "https://api.invalid/a/3?page=2",
    query: { page: "2" },
    result: "mocked",
    mockedBy: { rule: "general", response: "ok" },
  });

  test("says the rule added since applies now, instead of calling it shadowed", () => {
    expect(whyNotMocked(mockedByGeneral, context({ rules: [general, paged] }))).toMatchObject({
      kind: "nowApplies",
      rule: { id: "paged" },
    });
  });

  test("an equally specific rule moved earlier applies now too", () => {
    const first = devices({ id: "first" });
    expect(whyNotMocked(mockedByGeneral, context({ rules: [first, general] }))).toMatchObject({
      kind: "nowApplies",
      rule: { id: "first" },
    });
  });

  test("names what stops the new winner, such as Map Local being off", () => {
    expect(whyNotMocked(mockedByGeneral, context({ rules: [general, paged], enabled: false }))).toMatchObject({
      kind: "off",
      rule: { id: "paged" },
    });
  });

  test("still says shadowed while the winner keeps winning", () => {
    const mockedByPaged = { ...mockedByGeneral, mockedBy: { rule: "paged", response: "ok" } };
    expect(whyNotMocked(mockedByPaged, context({ rules: [general, paged] }))).toMatchObject({
      kind: "shadowed",
      rule: { id: "general" },
      winner: { id: "paged" },
    });
  });
});

test("an IPv6 literal host gets no reason, since the engine never mocks one and refuses it as an allowed host", () => {
  const v6 = entry({ host: "[::1]", url: "http://[::1]:8080/a/3" });
  expect(whyNotMocked(v6, context({ allowedHosts: [] }))).toBeUndefined();
});

test("a request whose result is unknown is never said to apply now, since it may have been mocked", () => {
  expect(whyNotMocked(entry({ result: "unknown", state: "failed", status: undefined }), context())).toBeUndefined();
});
