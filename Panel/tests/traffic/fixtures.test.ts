//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import matcher from "../../../Fixtures/matcher-cases.json";
import paths from "../../../Fixtures/path-cases.json";
import { isEncodedPath, pickRule } from "../../src/traffic/match";
import type { Rule } from "../../src/types";

// Swift's `SharedFixtureTests` reads the same table. The engine and the panel choose the same rule.
test.each(matcher.cases)("chooses the same rule as the engine: $name", (c) => {
  expect(pickRule(c.rules as Rule[], c.request.method, c.request.url)?.id ?? null).toBe(c.expect);
});

// Swift's `SharedFixtureTests` reads the same table. The panel treats as a rule exactly the
// paths the engine accepts.
test.each(paths.cases)("accepts the same rule paths as the engine: $name", (c) => {
  expect(isEncodedPath(c.path)).toBe(c.valid);
});
