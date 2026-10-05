//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { afterEach, beforeEach, expect, test } from "vitest";
import type { Draft, DraftStore } from "../src/drafts";
import { PanelModel } from "../src/model";
import { OrderDetector } from "../src/traffic/order";
import { TrafficStore } from "../src/traffic/store";
import type { NetworkSummary } from "../src/types";
import { View } from "../src/view";
import { configuration, engineState, FakeAPI } from "./fake-api";

// The host writes English to <html lang> when Necto is set to English. Everything else in
// the suite reads Korean (tests/setup.ts).
beforeEach(() => {
  document.documentElement.lang = "en";
});
afterEach(() => {
  document.documentElement.lang = "ko";
});

function memoryDrafts(): DraftStore {
  const data = new Map<string, Draft>();
  return { get: (k) => data.get(k), set: (k, d) => void data.set(k, d), clear: (k) => void data.delete(k) };
}

function mount(api = new FakeAPI(), connected = true) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app")!;
  let view!: View;
  const store = new TrafficStore(() => view.refreshTraffic());
  const model = new PanelModel(api, () => view.render());
  view = new View(root, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: { get: () => undefined, set: () => undefined },
    traffic: { store, order: new OrderDetector() },
  });
  if (connected) {
    view.connection = "connected";
    view.networkAvailable = true;
    model.receiveState(api.current);
  }
  view.render();
  return { root, store };
}

const $ = (root: ParentNode, selector: string) => root.querySelector(selector) as HTMLElement;
const click = (el: Element | null) => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));

/// Text and the attributes people read or hear: nothing in them may stay Korean.
function korean(root: HTMLElement): string[] {
  const read = [root.textContent ?? ""];
  for (const el of root.querySelectorAll("*"))
    for (const name of ["title", "aria-label", "placeholder"]) read.push(el.getAttribute(name) ?? "");
  return read.filter((text) => /[가-힣]/.test(text));
}

const summary: NetworkSummary = {
  id: "n1",
  method: "GET",
  url: "https://maplocal.invalid/a/3",
  host: "maplocal.invalid",
  startedAtMilliseconds: 1,
  state: "completed",
  statusCode: 200,
};

test("in English, the screen shown before an app connects reads in English", () => {
  const { root } = mount(new FakeAPI(), false);
  expect(root.textContent).toContain("Waiting for the app to connect…");
  expect(korean(root)).toEqual([]);
});

test("in English, the header, tabs, rule list and rule editor read in English", () => {
  const { root } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  expect([...root.querySelectorAll('[role="tab"][data-tab]')].map((tab) => tab.textContent)).toEqual([
    "Rules",
    "Traffic",
  ]);
  expect(root.textContent).toContain("Allowed hosts");
  expect(root.textContent).toContain("Requests without a rule");
  expect(root.textContent).toContain("Response the app gets");
  expect(korean(root)).toEqual([]);
});

test("in English, the empty rule list keeps the Traffic tab button inside its one sentence", () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([]));
  const { root } = mount(api);
  expect($(root, '[data-empty="rules"]').textContent).toBe(
    "No rules yet — pick a request in the Traffic tab and press [Mock with this response], or make one with [+ Rule]",
  );
  expect($(root, '[data-empty="rules"] [data-action="go-traffic"]').textContent).toBe("Traffic tab");
  expect(korean(root)).toEqual([]);
});

test("in English, the traffic list and a selected request's detail read in English", () => {
  const { root, store } = mount();
  click($(root, '[data-tab="traffic"]'));
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([summary]);
  expect([...root.querySelectorAll(".ml-traffic-list thead th")].map((th) => th.textContent)).toEqual([
    "Started",
    "Method",
    "Path",
    "Status",
    "Result",
    "Duration",
  ]);
  click($(root, ".ml-traffic-row"));
  expect($(root, ".ml-traffic-detail").textContent).toContain("Mock with this response");
  expect(korean(root)).toEqual([]);
});

test("in English, the paste dialog and the undo notice after a delete read in English", () => {
  const { root } = mount();
  click($(root, '[data-action="import"]'));
  expect($(root, ".necto-dialog").textContent).toContain("Paste configuration");
  expect(korean(root)).toEqual([]);
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-action="delete-rule"]'));
  expect($(root, '[data-notice="undo"]').textContent).toContain("Deleted the rule");
  expect(korean(root)).toEqual([]);
});
