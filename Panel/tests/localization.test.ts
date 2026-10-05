//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

/// <reference types="vite/client" />

import { expect, test } from "vitest";
import { ko } from "../src/localization";

const files = import.meta.glob<string>("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
const localizable = () =>
  Object.entries(files)
    .filter(([path]) => !path.endsWith("/localization.ts"))
    .map(([path, text]) => ({ file: path.replace("../src/", ""), text }));

interface Call {
  file: string;
  line: number;
  key?: string;
}

/// Every `t(` call in the panel source, with its key when the first argument is a plain
/// string literal. A key built at run time cannot be checked, so it is reported as missing.
function calls(): Call[] {
  const found: Call[] = [];
  for (const { file, text } of localizable()) {
    for (const match of text.matchAll(/(?<![\w$.])t\(\s*/g)) {
      const start = match.index! + match[0].length;
      const line = text.slice(0, match.index).split("\n").length;
      found.push({ file, line, key: literal(text, start) });
    }
  }
  return found;
}

function literal(text: string, start: number): string | undefined {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  let value = "";
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") {
      value += JSON.parse(`"${text.slice(i, i + 2)}"`);
      i += 1;
    } else if (c === quote) {
      return value;
    } else if (quote === "`" && c === "$" && text[i + 1] === "{") {
      return undefined;
    } else {
      value += c;
    }
  }
  return undefined;
}

test("no panel source outside localization.ts contains Korean", () => {
  expect(localizable().length).toBeGreaterThan(10);
  const offenders = localizable().flatMap(({ file, text }) =>
    text.split("\n").flatMap((line, i) => (/[가-힣]/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
  );
  expect(offenders).toEqual([]);
});

test("every t() call passes a literal key that the Korean dictionary translates", () => {
  const missing = calls()
    .filter((call) => call.key === undefined || !Object.hasOwn(ko, call.key))
    .map((call) => `${call.file}:${call.line}: ${call.key === undefined ? "(not a literal)" : call.key}`);
  expect(missing).toEqual([]);
});

test("the Korean dictionary has no unused keys, and keeps every placeholder of its key", () => {
  const used = new Set(calls().map((call) => call.key));
  expect(Object.keys(ko).filter((key) => !used.has(key))).toEqual([]);
  const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
  const mismatched = Object.entries(ko).filter(
    ([key, value]) => JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value)),
  );
  expect(mismatched).toEqual([]);
});

test("no Korean particle follows a placeholder, since the right one depends on the value (api.example.com는, 2은)", () => {
  const particle = /\}」?(은|는|이|가|을|를|과|와|으로|로|에서|에는|에|의|도)/;
  const offenders = Object.entries(ko).filter(([, value]) => particle.test(value)).map(([, value]) => value);
  expect(offenders).toEqual([]);
});

test("no English text puts a count of 1 before a plural noun", () => {
  const offenders = Object.keys(ko).filter((key) => /(^|\s)1 [A-Za-z]+s\b/.test(key.replaceAll("{count}", "1")));
  expect(offenders).toEqual([]);
});
