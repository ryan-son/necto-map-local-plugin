//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import messageCodes from "../../Fixtures/message-codes.json";
import { ko } from "../src/localization";
import { translate } from "../src/messages";

const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);

// Swift's `SharedFixtureTests` checks that `MessageCode` has the same codes and templates,
// so a code the engine sends always reaches a Korean entry keyed by its English text.
test.each(Object.entries(messageCodes.codes))("translates the engine's %s by its English template", (code, template) => {
  const params = Object.fromEntries(placeholders(template).map((name) => [name, `<${name}>`]));
  const korean = ko[template];
  expect(korean).toBeDefined();
  expect(translate({ code, params, message: "English" })).toBe(
    korean.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => `<${name}>`),
  );
});

test("translates the message that caused another, inside it", () => {
  expect(
    translate({
      code: "ruleUnsupported",
      params: { rule: "a" },
      message: "Rule a: Duplicate id: a",
      cause: { code: "duplicateID", params: { id: "a" }, message: "Duplicate id: a" },
    }),
  ).toBe("규칙 a: id가 중복됩니다: a");
});

test("shows the engine's English text for a code this panel doesn't know, or no code at all", () => {
  expect(translate({ code: "fromTheFuture", params: {}, message: "Something new" })).toBe("Something new");
  expect(translate({ code: "toString", message: "Not a method" })).toBe("Not a method");
  expect(translate({ message: "The app disconnected" })).toBe("The app disconnected");
});
