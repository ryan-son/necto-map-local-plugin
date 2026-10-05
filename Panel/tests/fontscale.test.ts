//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import css from "../src/style.css?raw";
import theme from "@necto/bridge/theme.css?raw";
import components from "@necto/bridge/components.css?raw";
import { PanelModel } from "../src/model";
import { View } from "../src/view";
import { OrderDetector } from "../src/traffic/order";
import { TrafficStore } from "../src/traffic/store";
import { configuration, engineState, FakeAPI, rule } from "./fake-api";

/// Necto scales text through `--necto-font-scale`, which feeds the `--necto-size-*` tokens.
/// WebKit gives form controls their own fixed font instead of inheriting one, so a button or
/// select without a token of its own stays small at the larger text sizes (O13). jsdom has
/// no UA stylesheet and does not inherit, so this reads what our stylesheets declare.
const scaled = /var\(--necto-size-(title|body|label|caption)\)|var\(--necto-font-scale\)/;

function mountAll() {
  document.head.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = [theme, components, css.replace(/@import[^;]*;/g, "")].join("\n");
  document.head.append(style);
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  api.current = {
    ...engineState(configuration([rule("a", "/a/{id}"), { ...rule("b"), enabled: false }])),
    observedHosts: ["other.invalid"],
    blockedHosts: ["prod.invalid"],
  };
  api.detailFor = (id) => ({
    id,
    method: "GET",
    url: "https://maplocal.invalid/a/1",
    host: "maplocal.invalid",
    startedAtMilliseconds: 1,
    state: "completed",
    statusCode: 200,
    requestHeaders: {},
    responseHeaders: { "Content-Type": "application/json" },
    responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
  });
  let view!: View;
  const store = new TrafficStore(() => view?.refreshTraffic());
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: { get: () => undefined, set: () => undefined, clear: () => undefined },
    copy: async () => true,
    copyField: () => true,
    prefs: { get: () => undefined, set: () => undefined },
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  view.networkAvailable = true;
  model.receiveState(api.current);
  return { root: document.getElementById("app")!, store };
}

const click = (el: Element | null) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/// The font size declared for the element itself, or for the nearest ancestor that declares one.
function declared(el: Element): string {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const size = getComputedStyle(at).fontSize;
    if (size) return size;
  }
  return "";
}

interface Seen { el: Element; name: string; own: string; inherited: string }

/// Every element on both tabs with the editor and the detail open, with its font size read
/// while it is on screen.
async function screens(): Promise<Seen[]> {
  vi.useFakeTimers();
  const { root, store } = mountAll();
  const seen: Seen[] = [];
  const read = () =>
    root.querySelectorAll("*").forEach((el) =>
      seen.push({
        el,
        name: `${el.tagName.toLowerCase()}.${el.className} ${el.getAttribute("data-field") ?? el.getAttribute("data-action") ?? el.textContent?.trim().slice(0, 30)}`,
        own: getComputedStyle(el).fontSize,
        inherited: declared(el),
      }),
    );
  click(root.querySelector('[data-rule="a"] .ml-path'));
  read();
  click(root.querySelector('[data-tab="traffic"]'));
  click(root.querySelector('[data-mode="time"]'));
  store.ingestNetwork([
    { id: "1", method: "GET", url: "https://maplocal.invalid/a/1", host: "maplocal.invalid", startedAtMilliseconds: 1, state: "completed", statusCode: 200 },
    { id: "2", method: "GET", url: "https://other.invalid/x", host: "other.invalid", startedAtMilliseconds: 2, state: "completed", statusCode: 200 },
  ]);
  click(root.querySelector('.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  read();
  vi.useRealTimers();
  return seen;
}

test("every button, select and text field declares a scaled font size of its own, since WebKit controls don't inherit one", async () => {
  const controls = (await screens()).filter(
    ({ el }) =>
      el.matches("button, select, textarea, input:not([type=checkbox]):not([type=radio])") &&
      (el.textContent?.trim() || !el.matches("button")),
  );
  expect(controls.length).toBeGreaterThan(20);
  expect(controls.filter((c) => !scaled.test(c.own)).map((c) => c.name)).toEqual([]);
});

test("all other text inherits a scaled size", async () => {
  const texts = (await screens()).filter(({ el }) =>
    [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()),
  );
  expect(texts.length).toBeGreaterThan(50);
  expect(texts.filter((c) => !scaled.test(c.inherited)).map((c) => c.name)).toEqual([]);
});

test("labels that name the controls beside them use the label size, not the caption size", async () => {
  const labels = (await screens()).filter(({ el }) =>
    el.matches(".ml-head-state .necto-caption, .ml-traffic-toolbar .necto-caption, [data-live] .necto-caption"),
  );
  expect(labels.length).toBeGreaterThanOrEqual(3);
  expect(labels.filter((c) => c.own !== "var(--necto-size-label)").map((c) => c.name)).toEqual([]);
});

test("style.css sets no font size in fixed units and no font shorthand", () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(source.match(/font-size\s*:\s*[\d.]+(px|pt|em|rem)\b/g) ?? []).toEqual([]);
  expect(source.match(/(^|[;{\s])font\s*:/g) ?? []).toEqual([]);
});
