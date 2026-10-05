//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { describe, expect, test } from "vitest";
import css from "../src/style.css?raw";
import theme from "@necto/bridge/theme.css?raw";

/** WCAG 2 relative-luminance contrast. Our tokens sit in the same contrast band as Necto's palette (≥4.5:1). */
const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** The pill's light fill: color-mix(in srgb, token 10%, transparent) laid over the background */
const tint = (fg: string, bg: string, p: number) =>
  "#" +
  rgb(fg)
    .map((f, i) =>
      Math.round(f * p + rgb(bg)[i] * (1 - p))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

const uncomment = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const declarations = (body: string) =>
  [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const);

/**
 * Declarations per theme. theme.css and our style.css pick the theme with the same three selectors:
 * the top-level `:root` (light and shared),
 * `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`, `:root[data-theme="dark"]`.
 * A later declaration of the same name wins — every block is read in order so an appended `:root {
 * --ml-mock: … }` is not missed.
 */
function themes(text: string) {
  const source = uncomment(text);
  const media = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}\s*\}/g;
  const pinned = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/g;
  const darkMedia = [...source.matchAll(media)].flatMap((m) => declarations(m[1]));
  const darkPinned = [...source.matchAll(pinned)].flatMap((m) => declarations(m[1]));
  const rest = source.replace(media, "").replace(pinned, "");
  const light = [...rest.matchAll(/(?<=^|[;}])\s*:root\s*\{([^}]*)\}/g)].flatMap((m) => declarations(m[1]));
  return {
    light: new Map(light),
    darkMedia: new Map([...light, ...darkMedia]),
    darkPinned: new Map([...light, ...darkPinned]),
    /** The number of declarations of the variable outside the three selectors (other selectors, inline rules) */
    outside: (name: string) =>
      (
        rest
          .replace(/(?<=^|[;}])\s*:root\s*\{[^}]*\}/g, "")
          .match(new RegExp(`${name}\\s*:`, "g")) ?? []
      ).length,
  };
}

/** Resolves var() all the way down to #rrggbb. */
function resolve(vars: Map<string, string>, name: string, depth = 0): string {
  const value = vars.get(name);
  expect(value, name).toBeDefined();
  const ref = /^var\((--[\w-]+)\)$/.exec(value!);
  if (ref && depth < 16) return resolve(vars, ref[1], depth + 1);
  expect(value, `${name} = ${value}`).toMatch(/^#[0-9a-fA-F]{6}$/);
  return value!.toLowerCase();
}

const necto = themes(theme);
const ours = themes(css);
const merged = (pick: "light" | "darkMedia" | "darkPinned") => new Map([...necto[pick], ...ours[pick]]);
const contexts = [["light", merged("light")], ["dark", merged("darkMedia")]] as const;
/** Every background a result pill or notice can sit on (design.md: background, sidebar, surface, hover, selected) */
const rows = ["--necto-bg", "--necto-sidebar", "--necto-surface", "--necto-hover", "--necto-selected"];

describe.each(["--ml-mock", "--ml-block"])("%s", (name) => {
  test("dark has the same value under the media query and the data-theme pin (so it holds when the host pins the window)", () => {
    expect(resolve(merged("darkPinned"), name)).toBe(resolve(merged("darkMedia"), name));
  });

  test("is not defined outside the three theme selectors — so no other rule overrides it unnoticed", () => {
    expect(ours.outside(name)).toBe(0);
  });

  describe.each(contexts)("%s", (_theme, vars) => {
    test.each(rows)("text on row background %s and on the light fill over it both reach WCAG 4.5:1", (row) => {
      const fg = resolve(vars, name);
      const bg = resolve(vars, row);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, tint(fg, bg, 0.1))).toBeGreaterThanOrEqual(4.5);
    });
  });
});

test("reads Necto's row backgrounds from theme.css — light and dark really are different colours", () => {
  for (const row of rows) expect(resolve(merged("light"), row)).not.toBe(resolve(merged("darkMedia"), row));
  expect(resolve(merged("light"), "--necto-bg")).toBe("#ffffff");
  expect(resolve(merged("darkMedia"), "--necto-selected")).toBe("#2b2b29");
});

test("style.css writes no colour literal outside the three theme selectors — colours come from tokens", () => {
  const source = uncomment(css)
    .replace(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, "")
    .replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/g, "")
    .replace(/(?<=^|[;}])\s*:root\s*\{[^}]*\}/g, "");
  expect(source.match(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) ?? []).toEqual([]);
});

test("the result pill uses no opacity or filter that would cut contrast", () => {
  const rules = [...uncomment(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes(".ml-result"));
  expect(rules.length).toBeGreaterThan(0);
  for (const [, selector, body] of rules) expect(body, selector.trim()).not.toMatch(/(^|[;\s])(opacity|filter)\s*:/);
});

test("the contrast calculation itself is correct (21:1 for black and white, 1:1 for the same colour)", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#7b3fd0", "#7b3fd0")).toBe(1);
});
