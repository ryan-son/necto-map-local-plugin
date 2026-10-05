//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import { indentJSON, readJSON } from "../src/json";

test("reads JSON written with the curly quotes macOS substitutes, and returns the text fixed to straight quotes", () => {
  expect(readJSON("{“ok”: true, „n“: 1}")).toEqual({
    ok: true,
    value: { ok: true, n: 1 },
    text: '{"ok": true, "n": 1}',
  });
});

test("leaves curly quotes inside strings alone when the original text parses as is", () => {
  const text = '{"quote": "“인용”"}';
  expect(readJSON(text)).toEqual({ ok: true, value: { quote: "“인용”" }, text });
});

test("points out the curly quotes along with the reason when the fixed text still does not parse", () => {
  const result = readJSON("{“ok”: }");
  expect(result.ok).toBe(false);
  expect(!result.ok && result.message).toContain("곧은 따옴표");
});

test("returns only the reason when there are no curly quotes", () => {
  const result = readJSON("{");
  expect(result.ok).toBe(false);
  expect(!result.ok && result.message).not.toContain("따옴표");
});

test("indents one-line JSON by its whitespace only, so values, key order and repeated keys stay as sent", () => {
  const text = '{"id":1234567890123456789,"2":"b","1":"a","s":"x, y: {z} [w]","e":"q\\"u\\\\","a":[1,2.50,-3e2],"o":{},"l":[],"n":null,"t":true,"id":7}';
  expect(indentJSON(text)).toBe(
    [
      "{",
      '  "id": 1234567890123456789,',
      '  "2": "b",',
      '  "1": "a",',
      '  "s": "x, y: {z} [w]",',
      '  "e": "q\\"u\\\\",',
      '  "a": [',
      "    1,",
      "    2.50,",
      "    -3e2",
      "  ],",
      '  "o": {},',
      '  "l": [],',
      '  "n": null,',
      '  "t": true,',
      '  "id": 7',
      "}",
    ].join("\n"),
  );
});

test("indents a one-line array and keeps spaces inside strings", () => {
  expect(indentJSON('[ {"a" : "b c"} , [ ] ]')).toBe('[\n  {\n    "a": "b c"\n  },\n  []\n]');
});

test.each([
  ["already on several lines", '{\n  "a": 1\n}'],
  ["not JSON", "{a:1}"],
  ["JSONP", 'cb({"a":1})'],
  ["a bare value", "42"],
  ["a BOM before it", '﻿{"a":1}'],
  ["empty", ""],
])("leaves text it should not touch as it is (%s)", (_n, text) => {
  expect(indentJSON(text)).toBe(text);
});

test("leaves deeply nested JSON as it is, since indenting it would grow it by the square of its depth", () => {
  const deep = "[".repeat(10000) + "1" + "]".repeat(10000);
  const started = performance.now();
  expect(indentJSON(deep)).toBe(deep);
  expect(performance.now() - started).toBeLessThan(1000);
  const shallow = "[".repeat(10) + "1" + "]".repeat(10);
  expect(indentJSON(shallow)).not.toBe(shallow);
});

test("indents a one-line body that ends in a newline, as many servers send it", () => {
  expect(indentJSON('{"a":1,"b":[1,2]}\n')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
});

test("drops tabs and carriage returns between tokens like spaces", () => {
  expect(indentJSON('{"a":\t1,\r"b":2}')).toBe('{\n  "a": 1,\n  "b": 2\n}');
});

test("leaves a body as it is when indenting would make it more than four times larger", () => {
  const wide = "[".repeat(99) + Array(20000).fill(1).join(",") + "]".repeat(99);
  expect(indentJSON(wide)).toBe(wide);
});
