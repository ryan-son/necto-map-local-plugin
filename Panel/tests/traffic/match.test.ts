//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { describe, expect, test } from "vitest";
import type { Rule } from "../../src/types";
import { matchingDisabledRule, overlaps, parseQuery, pickRule, queryMisses } from "../../src/traffic/match";
import { rule } from "../fake-api";

test("the query does not turn + into a space, and a repeated key takes the last value", () => {
  expect(parseQuery("q=a+b&p=1&p=2&e=%ED%95%9C")).toEqual({ q: "a+b", p: "2", e: "한" });
});

test("points out a matching disabled rule when the engine has no rule to choose", () => {
  const off = { ...rule("off", "/a/{id}"), enabled: false };
  expect(matchingDisabledRule([off], "GET", "https://maplocal.invalid/a/1")?.id).toBe("off");
});

test("the disabled rule hint also points to the rule with more query conditions", () => {
  const off = (id: string, query?: Record<string, string>): Rule => ({
    id,
    enabled: false,
    match: { method: "GET", path: "/api/sites", ...(query ? { query } : {}) },
    active: "ok",
    responses: { ok: { status: 200 } },
  });
  expect(
    matchingDisabledRule(
      [off("generic"), off("page2", { page: "2" })],
      "GET",
      "https://maplocal.invalid/api/sites?page=2",
    )?.id,
  ).toBe("page2");
});

test("reads and matches a __proto__ query key like any other key (as the engine does)", () => {
  expect(Object.entries(parseQuery("__proto__=1&a=2"))).toEqual([["__proto__", "1"], ["a", "2"]]);
  const rules = JSON.parse(
    '[{"id":"p","enabled":true,"match":{"method":"GET","path":"/s","query":{"__proto__":"1"}},"active":"ok","responses":{"ok":{"status":200}}}]',
  );
  expect(pickRule(rules, "GET", "https://maplocal.invalid/s?__proto__=1")?.id).toBe("p");
  expect(pickRule(rules, "GET", "https://maplocal.invalid/s")).toBeUndefined();
});

describe("the query conditions a rule failed on, for a request it fits otherwise", () => {
  const conditioned: Rule = {
    id: "page2",
    enabled: true,
    match: { method: "GET", host: "api.invalid", path: "/api/orders", query: { page: "2", _: "100" } },
    active: "ok",
    responses: { ok: { status: 200 } },
  };

  test("names each condition whose value differs or is missing, values decoded as the engine reads them", () => {
    expect(queryMisses(conditioned, "GET", "https://api.invalid/api/orders?page=2&_=200")).toEqual([
      { key: "_", expected: "100", actual: "200" },
    ]);
    expect(queryMisses(conditioned, "GET", "https://api.invalid/api/orders?page=%33")).toEqual([
      { key: "page", expected: "2", actual: "3" },
      { key: "_", expected: "100" },
    ]);
  });

  test("is empty when every condition holds", () => {
    expect(queryMisses(conditioned, "GET", "https://api.invalid/api/orders?_=100&page=2&x=1")).toEqual([]);
  });

  test.each([
    ["another method", "POST", "https://api.invalid/api/orders?page=2"],
    ["another host", "GET", "https://other.invalid/api/orders?page=2"],
    ["another path", "GET", "https://api.invalid/api/order?page=2"],
  ])("has nothing to say for %s", (_n, method, url) => {
    expect(queryMisses(conditioned, method, url)).toBeUndefined();
  });
});

describe("overlaps: which rule answers a request two rules both match", () => {
  const q = (r: Rule, query: Record<string, string>): Rule => ({ ...r, match: { ...r.match, query } });
  const any = rule("any", "/orders");
  const page2 = q(rule("page2", "/orders"), { page: "2" });

  test("the rule with more query conditions answers, from either side", () => {
    expect(overlaps([any, page2], any)).toEqual([{ rule: page2, answers: "other", reason: "conditions" }]);
    expect(overlaps([any, page2], page2)).toEqual([{ rule: any, answers: "this", reason: "conditions" }]);
  });

  test("on a tie the rule higher in the list answers", () => {
    const sorted = q(rule("sorted", "/orders"), { sort: "new" });
    expect(overlaps([page2, sorted], sorted)).toEqual([{ rule: page2, answers: "other", reason: "order" }]);
    expect(overlaps([page2, sorted], page2)).toEqual([{ rule: sorted, answers: "this", reason: "order" }]);
  });

  test("a {param} segment overlaps a fixed one, and a rule without a host overlaps one with", () => {
    const byID = rule("byID", "/orders/{id}");
    const three = { ...rule("three", "/orders/3"), match: { method: "GET", host: "maplocal.invalid", path: "/orders/3" } };
    expect(overlaps([byID, three], byID).map((o) => o.rule.id)).toEqual(["three"]);
  });

  test("rules no single request can match both of share nothing", () => {
    const page1 = q(rule("page1", "/orders"), { page: "1" });
    const post = { ...any, id: "post", match: { ...any.match, method: "POST" } };
    const other = rule("other", "/order");
    const longer = rule("longer", "/orders/{id}");
    const hostA = { ...rule("hostA", "/orders"), match: { method: "GET", host: "a.invalid", path: "/orders" } };
    const hostB = { ...rule("hostB", "/orders"), match: { method: "GET", host: "b.invalid", path: "/orders" } };
    expect(overlaps([page1, page2, post, other, longer], page2)).toEqual([]);
    expect(overlaps([hostA, hostB], hostA)).toEqual([]);
  });

  test("a rule that is off answers nothing, so it overlaps nothing", () => {
    const off = { ...page2, enabled: false };
    expect(overlaps([any, off], any)).toEqual([]);
    expect(overlaps([any, off], off)).toEqual([]);
  });

  test("the verdict holds while an edit is invalid for a moment (a half-typed status), since the rule keeps its place", () => {
    const w = rule("w", "/users/{id}");
    const o = rule("o", "/users/{id}");
    const typing = { ...w, responses: { ok: { status: 4 } } };
    expect(overlaps([typing, o], typing)).toEqual([{ rule: o, answers: "this", reason: "order" }]);
  });

  test("a path still being typed (an open {) shares nothing", () => {
    expect(overlaps([rule("o", "/users/{id}")], rule("w", "/users/{"))).toEqual([]);
  });

  test("with three rules it says what the engine picks: a rule another one shadows answers nothing", () => {
    const e = rule("e", "/users/{x}");
    const w = rule("w", "/users/me");
    const o = rule("o", "/users/{y}");
    const found = overlaps([e, w, o], w);
    expect(found).toEqual([{ rule: e, answers: "other", reason: "order" }]);
    expect(pickRule([e, w, o], "GET", "https://maplocal.invalid/users/me")?.id).toBe("e");
  });

  test("a {param} segment shares nothing with an empty one", () => {
    expect(overlaps([rule("slash", "/orders/")], rule("byID", "/orders/{id}"))).toEqual([]);
  });

  test("a draft not yet in the list counts as last on a tie", () => {
    const sorted = q(rule("sorted", "/orders"), { sort: "new" });
    expect(overlaps([sorted], q(rule("draft", "/orders"), { page: "2" }))).toEqual([{ rule: sorted, answers: "other", reason: "order" }]);
  });

  test("hosts and methods are compared the way the engine reads them", () => {
    const upper = { ...rule("upper", "/orders"), match: { method: "get", host: "API.invalid:443", path: "/orders" } };
    const lower = { ...rule("lower", "/orders"), match: { method: "GET", host: "api.invalid", path: "/orders" } };
    expect(overlaps([upper, lower], lower).map((o) => o.rule.id)).toEqual(["upper"]);
  });

  test("a rule being edited is judged as it is now, even before it reaches the list", () => {
    const edited = q(any, { page: "3" });
    expect(overlaps([any, page2], edited)).toEqual([]);
    const draft = rule("draft", "/orders");
    expect(overlaps([page2], draft)).toEqual([{ rule: page2, answers: "other", reason: "conditions" }]);
  });
});
