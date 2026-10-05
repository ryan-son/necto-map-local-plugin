//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  Configuration,
  EngineState,
  NetworkDetail,
  NetworkSummary,
  RequestEvent,
  Rule,
  TrafficEntry,
  WriteResult,
} from "../src/types";
import { isRule } from "../src/rules";
import css from "../src/style.css?raw";
import { connect } from "../src/connect";
import type { Draft, DraftStore } from "../src/drafts";
import { ko } from "../src/localization";
import { PanelModel } from "../src/model";
import { View } from "../src/view";
import { formatClock } from "../src/traffic/format";
import { OrderDetector } from "../src/traffic/order";
import { TrafficStore } from "../src/traffic/store";
import { configuration, engineState, FakeAPI, rule } from "./fake-api";

function memoryDrafts(): DraftStore & { data: Map<string, Draft> } {
  return {
    data: new Map(),
    get(k) { return this.data.get(k); },
    set(k, d) { this.data.set(k, d); },
    clear(k) { this.data.delete(k); },
  };
}

function memoryPrefs() {
  const data = new Map<string, string>();
  return { data, get: (k: string) => data.get(k), set: (k: string, v: string) => void data.set(k, v) };
}
const noPrefs = { get: () => undefined, set: () => undefined };

const trafficEntry = (over: Partial<TrafficEntry> = {}): TrafficEntry => ({
  key: "n1",
  networkID: "n1",
  method: "GET",
  host: "maplocal.invalid",
  path: "/a/3",
  query: {},
  url: "https://maplocal.invalid/a/3",
  startedAt: 0,
  state: "completed",
  status: 200,
  result: "passthrough",
  ...over,
});
const networkDetail = (over: Partial<NetworkDetail> = {}): NetworkDetail => ({
  id: "n1",
  method: "GET",
  url: "https://maplocal.invalid/a/3",
  host: "maplocal.invalid",
  startedAtMilliseconds: 0,
  state: "completed",
  statusCode: 200,
  requestHeaders: {},
  responseHeaders: { "Content-Type": "application/json" },
  responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
  ...over,
});

function mount(api = new FakeAPI()) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app")!;
  const drafts = memoryDrafts();
  const copied: string[] = [];
  let view!: View;
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  const fieldCopies: string[] = [];
  const deps = {
    api,
    drafts,
    copyResult: false,
    fieldCopyResult: true,
    copy: async (t: string) => { copied.push(t); return deps.copyResult; },
    copyField: (el: HTMLTextAreaElement) => { fieldCopies.push(el.value); return deps.fieldCopyResult; },
    prefs: memoryPrefs(),
  };
  view = new View(root, model, deps);
  view.connection = "connected";
  model.receiveState(api.current);
  return { api, model, view, root, drafts, copied, fieldCopies, deps };
}

const $ = (root: ParentNode, selector: string) => root.querySelector(selector) as HTMLElement;
const click = (el: Element | null) => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
const type = (el: Element | null, value: string) => {
  (el as HTMLInputElement).value = value;
  el!.dispatchEvent(new Event("input", { bubbles: true }));
};
const field = (root: ParentNode, name: string) => $(root, `[data-field="${name}"]`) as HTMLInputElement;
const lastWrite = (api: FakeAPI) => api.writes.at(-1)!;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("the on switch shows its state as a Necto switch (button role=switch)", () => {
  const { root } = mount();
  expect($(root, 'button[role="switch"]').getAttribute("aria-checked")).toBe("true");
});

test("unchecking a rule turns it off and upserts it", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-rule="a"] input[type=checkbox]'));
  await model.idle();
  expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { id: "a", enabled: false } } });
});

describe("the rule's on/off switch in the editor head (O7)", () => {
  const editorSwitch = (root: HTMLElement) => $(root, '.ml-editor-head [data-field="rule-enabled"]');
  const listBox = (root: HTMLElement) => $(root, '[data-rule="a"] input[type=checkbox]') as HTMLInputElement;

  test("is a Necto switch showing the rule's state, and turning it off upserts the rule and unchecks the list", async () => {
    const { api, root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    expect(editorSwitch(root).classList.contains("necto-switch")).toBe(true);
    expect(editorSwitch(root).getAttribute("role")).toBe("switch");
    expect(editorSwitch(root).getAttribute("aria-checked")).toBe("true");
    click(editorSwitch(root));
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { id: "a", enabled: false } } });
    expect(editorSwitch(root).getAttribute("aria-checked")).toBe("false");
    expect(listBox(root).checked).toBe(false);
  });

  test("Space on the list flips the switch, checkbox and row at once, before the write settles", () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const list = $(root, ".ml-rule-list");
    list.focus();
    list.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(editorSwitch(root).getAttribute("aria-checked")).toBe("false");
    expect(listBox(root).checked).toBe(false);
    expect($(root, '[data-rule="a"]').getAttribute("data-enabled")).toBe("false");
  });

  test("follows the list checkbox", async () => {
    const { root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    click(listBox(root));
    await model.idle();
    expect(editorSwitch(root).getAttribute("aria-checked")).toBe("false");
  });
});

describe("on/off and blocked hosts read at a glance (O2, O3)", () => {
  test("a rule that is off is marked on its row, and its text is dimmed to the tertiary colour", () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("a"), { ...rule("b"), enabled: false }]));
    const { root } = mount(api);
    expect($(root, '[data-rule="a"]').getAttribute("data-enabled")).toBe("true");
    expect($(root, '[data-rule="b"]').getAttribute("data-enabled")).toBe("false");
    expect(css).toMatch(/\.ml-rule\[data-enabled="false"\][^{]*\{[^}]*color:\s*var\(--necto-text-tertiary\)/);
  });

  test("blocked hosts sit in their own labelled group after the allowed hosts, never among them", () => {
    const api = new FakeAPI();
    api.current = { ...engineState(), blockedHosts: ["prod.invalid", "v2.invalid"] };
    const { root } = mount(api);
    const allowed = $(root, '[data-group="allowed-hosts"]');
    const blocked = $(root, '[data-group="blocked-hosts"]');
    expect(allowed.querySelector(".ml-chip-blocked")).toBeNull();
    expect(allowed.contains(field(root, "add-host"))).toBe(true);
    expect(blocked.firstElementChild?.textContent).toBe("앱에서 차단:");
    expect([...blocked.querySelectorAll(".ml-chip-blocked")].map((c) => c.textContent)).toEqual(["🚫 prod.invalid", "🚫 v2.invalid"]);
    expect(allowed.compareDocumentPosition(blocked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("each host group wraps as a unit and its chips do not break inside", () => {
    expect(css).toMatch(/\.ml-host-group\s*\{[^}]*display:\s*inline-flex/);
    expect(css).toMatch(/\.ml-chip\s*\{[^}]*white-space:\s*nowrap/);
  });

  test("with no blocked hosts there is no blocked group", () => {
    const { root } = mount();
    expect(root.querySelector('[data-group="blocked-hosts"]')).toBeNull();
  });
});

test("saves once, 400ms after the status changes in the editor", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "5");
  type(field(root, "status"), "503");
  expect(api.writes).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0].input).toMatchObject({ rule: { id: "a", responses: { ok: { status: 503 } } } });
});

test("a header menu opened right after an edit keeps its node, and so its choice, when the edit's save lands", async () => {
  const { root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  const menu = field(root, "unmatched") as unknown as HTMLSelectElement;
  menu.focus();
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(field(root, "unmatched")).toBe(menu);
  expect(document.activeElement).toBe(menu);
});

test("a focused header menu shows a value changed elsewhere, such as by necto-cli", () => {
  const { api, root, model } = mount();
  const menu = field(root, "unmatched") as unknown as HTMLSelectElement;
  menu.focus();
  model.receiveState({
    ...api.current,
    revision: api.current.revision + 1,
    configuration: { ...api.current.configuration, unmatched: { mode: "fail", error: "timedOut" } },
  });
  expect((field(root, "unmatched") as unknown as HTMLSelectElement).value).toBe("fail:timedOut");
});

test("keeps focus and the caret when a request record arrives while typing", () => {
  const { root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  const body = field(root, "body") as unknown as HTMLTextAreaElement;
  body.focus();
  type(body, '{"abc": 1}');
  body.setSelectionRange(3, 3);
  model.receiveRequest({
    seq: 0,
    query: {},
    date: 0,
    method: "GET",
    host: "h.invalid",
    path: "/x",
    outcome: { passthrough: {} },
  });
  const active = document.activeElement as HTMLTextAreaElement;
  expect(active.getAttribute("data-field")).toBe("body");
  expect(active.value).toBe('{"abc": 1}');
  expect(active.selectionStart).toBe(3);
});

test("keeps both the edit and the switch-off when a rule is turned off in the list while a save is pending", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  click($(root, '[data-rule="a"] input[type=checkbox]'));
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(lastWrite(api).input).toMatchObject({ rule: { id: "a", enabled: false, responses: { ok: { status: 503 } } } });
});

test("saves the edit first and makes the chosen response the one in use when the response tab changes while a save is pending", async () => {
  const api = new FakeAPI();
  api.current = engineState(
    configuration([
      { ...rule("a"), responses: { ok: { status: 200 }, down: { error: "timedOut" } } },
    ]),
  );
  const { root, model } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "delay"), "300");
  click($(root, '[data-response="down"]'));
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  // The edit save (delay 300) must go out before the switch for down to end up active
  expect(api.writes.map((w) => w.op)).toEqual(["maplocal.rule.upsert", "maplocal.rule.setActive"]);
  expect(api.writes[0].input).toMatchObject({ rule: { responses: { ok: { delayMs: 300 } } } });
  expect(lastWrite(api).input).toMatchObject({ id: "a", response: "down" });
});

test("keeps a draft per response so one response tab's body never overwrites another's", async () => {
  const api = new FakeAPI();
  api.current = engineState(
    configuration([
      {
        ...rule("a"),
        responses: { ok: { status: 200, json: {} }, other: { status: 201, json: { keep: true } } },
      },
    ]),
  );
  const { root, drafts } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "body"), '{"broken":');
  await vi.advanceTimersByTimeAsync(400);
  expect(drafts.get("a/ok")?.bodyText).toBe('{"broken":');
  click($(root, '[data-response="other"]'));
  expect(JSON.parse(field(root, "body").value)).toEqual({ keep: true });
});

test("does not send an invalid body JSON, shows the error and keeps the draft", async () => {
  const { api, root, drafts } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "body"), '{"a":');
  await vi.advanceTimersByTimeAsync(400);
  expect(api.writes).toHaveLength(0);
  expect($(root, ".ml-error").textContent).toContain("JSON");
  expect(drafts.get("a/ok")?.bodyText).toBe('{"a":');
});

test("leaves an edit the app rejected as typed and shows the reason", async () => {
  const api = new FakeAPI();
  api.results = [
    {
      ok: false,
      reason: "invalid",
      code: "pathMustStartWithSlash",
      params: {},
      message: "match.path must start with /",
      revision: 0,
    },
  ];
  const { root, model } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "path"), "abc");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(field(root, "path").value).toBe("abc");
  expect(root.textContent).toContain("match.path는 /로 시작해야 합니다");
});

test("shows the configuration's issues in the panel's language, and the English text when there are no codes", () => {
  const { root, model, api } = mount();
  model.receiveState({
    ...api.current,
    issues: ["Rule a: Duplicate id: a"],
    issueDetails: [
      {
        code: "ruleUnsupported",
        params: { rule: "a" },
        message: "Rule a: Duplicate id: a",
        cause: { code: "duplicateID", params: { id: "a" }, message: "Duplicate id: a" },
      },
    ],
  });
  expect(root.textContent).toContain("규칙 a: id가 중복됩니다: a");
  model.receiveState({ ...api.current, revision: api.current.revision + 1, issues: ["From an older app"] });
  expect(root.textContent).toContain("From an older app");
});

test("the typed value does not flicker when the save result arrives before the state echo", async () => {
  const { root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(field(root, "status").value).toBe("503");
});

test("reports a dropped transport and keeps the edit as a draft", async () => {
  const api = new FakeAPI();
  api.write = async () => { throw new Error("앱 연결이 끊겼어요"); };
  const { root, model, drafts } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(root.textContent).toContain("앱 연결이 끊겼어요");
  expect(field(root, "status").value).toBe("503");
  expect(drafts.get("a/ok")).toBeDefined();
});

test("shows an error the app threw in the panel's language and keeps the edit as a draft", async () => {
  const api = new FakeAPI();
  api.write = async () => {
    throw Object.assign(new Error("responses.ok.status must be an integer from 100 to 599"), {
      code: "INVALID_INPUT",
      details: {
        reason: "invalid",
        code: "outOfRange",
        params: { key: "responses.ok.status", min: "100", max: "599" },
        message: "responses.ok.status must be an integer from 100 to 599",
        revision: 0,
      },
    });
  };
  const { root, model, drafts } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(root.textContent).toContain(
    ko["{key} must be an integer from {min} to {max}"]
      .replace("{key}", "responses.ok.status").replace("{min}", "100").replace("{max}", "599"),
  );
  expect(root.textContent).not.toContain("must be an integer");
  expect(drafts.get("a/ok")).toBeDefined();
});

test("clicking an observed host adds it to the allowed hosts", async () => {
  const api = new FakeAPI();
  api.current = { ...engineState(), observedHosts: ["dev.invalid"] };
  const { root, model } = mount(api);
  click($(root, '[data-add-host="dev.invalid"]'));
  await model.idle();
  expect(lastWrite(api)).toMatchObject({
    op: "maplocal.configuration.patch",
    input: { allowedHosts: ["maplocal.invalid", "dev.invalid"] },
  });
});

test("capturing a request to a host that is not allowed also allows the host", async () => {
  const { api, model, view } = mount();
  view.captureInto(
    trafficEntry({ host: "dev.invalid", path: "/x", url: "https://dev.invalid/x" }),
    networkDetail(),
    "/x",
  );
  await model.idle();
  expect(api.writes.map((w) => w.op)).toEqual(["maplocal.rule.upsert", "maplocal.configuration.patch"]);
  expect(api.writes[1].input).toMatchObject({ allowedHosts: ["maplocal.invalid", "dev.invalid"] });
});

test("the unmatched block status shows the configured value and does not change when chosen again", () => {
  const api = new FakeAPI();
  api.current = engineState({ ...configuration(), unmatched: { mode: "block", status: 503 } });
  const { root } = mount(api);
  expect($(root, '[data-field="unmatched"] option[value="block"]').textContent).toContain("503");
});

test("asks first before turning off an auth rule while a mock session remains, and sends nothing on cancel", async () => {
  const api = new FakeAPI();
  const auth = { ...rule("login"), tags: ["auth"] };
  api.current = { ...engineState(configuration([auth])), authMocked: true };
  const { root } = mount(api);
  click($(root, '[data-rule="login"] input[type=checkbox]'));
  expect($(root, ".necto-dialog").textContent).toContain("로그아웃");
  click($(root, '[data-dialog="cancel"]'));
  expect(api.writes).toHaveLength(0);
});

test("deletes a rule without asking, and 'Deleted the GET /a rule [Undo] [×]' does not expire (principle 4; ⌘Z belongs to the host)", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-action="delete-rule"]'));
  expect(root.querySelector(".ml-dialog-layer")).toBeNull();
  await model.idle();
  expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.delete", input: { id: "a" } });
  const notice = $(root, '.ml-toasts [data-notice="undo"]');
  expect(notice.textContent).toContain("GET /a 규칙을 지웠습니다");
  expect($(root, '[data-notice="undo"] [data-action="undo"]').textContent).toBe("되돌리기");
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(root.querySelector('[data-notice="undo"]')).not.toBeNull();
});

test("+ Rule names the id after the method and path like capture, not the internal name 'new-rule', and the id stays when the path is edited (Q3)", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-action="new-rule"]'));
  click($(root, '[data-action="new-rule"]'));
  await model.idle();
  expect(api.writes.map((w) => (w.input.rule as { id: string }).id)).toEqual(["get", "get-2"]);
  type(field(root, "path"), "/api/sites");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(lastWrite(api).input.rule).toMatchObject({ id: "get-2", match: { path: "/api/sites" } });
  expect($(root, ".ml-editor-head .ml-path").textContent).toBe("GET /api/sites");
});

describe("+ Rule starts off, so a half-made rule never answers requests to /", () => {
  test("is saved off, and turns on the first time its path changes", async () => {
    const { api, root, model } = mount();
    click($(root, '[data-action="new-rule"]'));
    await model.idle();
    expect(lastWrite(api).input.rule).toMatchObject({ enabled: false, match: { path: "/" } });
    type(field(root, "path"), "/api/sites");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(lastWrite(api).input.rule).toMatchObject({ enabled: true, match: { path: "/api/sites" } });
    type(field(root, "path"), "/api/sites/2");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(lastWrite(api).input.rule).toMatchObject({ enabled: true, match: { path: "/api/sites/2" } });
  });

  test("the switch shows on as soon as the path is typed, before the save", () => {
    const { root } = mount();
    click($(root, '[data-action="new-rule"]'));
    type(field(root, "path"), "/api/sites");
    expect(field(root, "rule-enabled").getAttribute("aria-checked")).toBe("true");
  });

  test("a deleted new rule's id doesn't turn on another rule given that id later", async () => {
    const { api, root, model } = mount();
    click($(root, '[data-action="new-rule"]'));
    await model.idle();
    const id = (lastWrite(api).input.rule as Rule).id;
    click($(root, '[data-action="delete-rule"]'));
    await model.idle();
    api.current = engineState(configuration([{ ...rule(id, "/"), enabled: false }]));
    model.receiveState({ ...api.current, revision: api.current.revision + 5 });
    click($(root, `[data-rule="${id}"] .ml-path`));
    type(field(root, "path"), "/api/sites");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(lastWrite(api).input.rule).toMatchObject({ id, enabled: false, match: { path: "/api/sites" } });
  });

  test.each([
    ["turned on", 1, true],
    ["turned on and off again", 2, false],
  ])("keeps the switch as set by hand before the path (%s)", async (_n, presses, enabled) => {
    const { api, root, model } = mount();
    click($(root, '[data-action="new-rule"]'));
    await model.idle();
    for (let i = 0; i < presses; i += 1) {
      click(field(root, "rule-enabled"));
      await model.idle();
    }
    type(field(root, "path"), "/api/sites");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(lastWrite(api).input.rule).toMatchObject({ enabled, match: { path: "/api/sites" } });
  });
});

test("ids do not collide when + Rule is clicked twice before the echo", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-action="new-rule"]'));
  click($(root, '[data-action="new-rule"]'));
  await model.idle();
  const ids = api.writes.map((w) => (w.input.rule as { id: string }).id);
  expect(new Set(ids).size).toBe(2);
});

test("shows the export in a selected text box when copying is blocked", async () => {
  const { root, copied } = mount();
  click($(root, '[data-action="export"]'));
  await vi.runAllTimersAsync();
  expect(copied).toHaveLength(1);
  expect(($(root, ".necto-dialog textarea") as HTMLTextAreaElement).value).toContain('"force": true');
});

test("the rule list shows the host of a rule that sets one, and only the path of a rule that does not", () => {
  const api = new FakeAPI();
  const scoped = rule("scoped", "/same");
  scoped.match.host = "api.example.com";
  api.current = engineState(configuration([scoped, rule("any", "/same")]));
  const { root } = mount(api);
  expect($(root, '[data-rule="scoped"] .ml-host').textContent).toBe("api.example.com");
  expect($(root, '[data-rule="scoped"] .ml-path').getAttribute("title")).toBe("GET api.example.com/same");
  expect($(root, '[data-rule="any"] .ml-host')).toBeNull();
  expect($(root, '[data-rule="any"] .ml-path').getAttribute("title")).toBe("GET /same");
});

test("the JSON editor turns off macOS auto-correction (curly quotes, spelling)", () => {
  const { root } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  for (const name of ["headers", "body"]) {
    const el = field(root, name);
    expect(el.getAttribute("spellcheck")).toBe("false");
    expect(el.getAttribute("autocorrect")).toBe("off");
    expect(el.getAttribute("autocapitalize")).toBe("off");
  }
});

test("saves a body written with curly quotes and shows the box text with straight quotes", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "body"), "{“ok”: true}");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(lastWrite(api)).toMatchObject({
    op: "maplocal.rule.upsert",
    input: { rule: { id: "a", responses: { ok: { body: '{"ok": true}' } } } },
  });
  expect(field(root, "body").value).toBe('{"ok": true}');
});

test("reports a successful copy of the export and clears the notice shortly after", async () => {
  const { root, deps } = mount();
  deps.copyResult = true;
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  expect($(root, ".ml-dialog-layer")).toBeNull();
  expect(root.textContent).toContain("복사했습니다");
  await vi.advanceTimersByTimeAsync(4000);
  expect(root.textContent).not.toContain("복사했습니다");
});

test("copying settings copies values as they are and warns in one line when a value looks like a token (without claiming to hide it)", async () => {
  const api = new FakeAPI();
  const r = rule("a");
  api.current = engineState(
    configuration([
      { ...r, responses: { ok: { status: 200, headers: { Authorization: "Bearer real" } } } },
    ]),
  );
  const { root, deps, copied } = mount(api);
  deps.copyResult = true;
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  expect(copied[0]).toContain("Bearer real");
  expect(root.textContent).toContain("설정을 복사했습니다 — 토큰처럼 보이는 값이 들어 있습니다 — 공유하기 전에 확인하세요");
  expect(root.textContent).not.toMatch(/가렸|가려/);
});

test("draws the list and copies settings even with rule entries that are not objects, such as null", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([null as unknown as Rule, "x" as unknown as Rule, rule("a")]));
  const { root, deps, copied } = mount(api);
  expect(root.querySelectorAll(".ml-rule[aria-disabled=true]")).toHaveLength(2);
  expect($(root, '[data-rule="a"]')).not.toBeNull();
  deps.copyResult = true;
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(copied[0]!).configuration.rules[0]).toBeNull();
  expect(root.textContent).toContain("설정을 복사했습니다");
});

test("without tokens, the copy notice has no warning, and neither does the box", async () => {
  const { root, deps } = mount();
  deps.copyResult = true;
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  expect(root.textContent).toContain("설정을 복사했습니다");
  expect(root.textContent).not.toContain("토큰처럼");
});

test("puts a warning line in the box when copying is blocked and there are tokens", async () => {
  const api = new FakeAPI();
  const r = rule("a");
  api.current = engineState(
    configuration([{ ...r, responses: { ok: { status: 200, headers: { "Set-Cookie": "s=1" } } } }]),
  );
  const { root } = mount(api);
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  expect($(root, ".necto-dialog").getAttribute("aria-label")).toBe("설정 내보내기");
  expect($(root, '.necto-dialog [data-export-warning]').textContent).toBe("토큰처럼 보이는 값이 들어 있습니다 — 공유하기 전에 확인하세요");
});

test("the box shown when copying is blocked has a single [Close], a [Copy] and a ⌘C hint", async () => {
  const { root } = mount();
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  const buttons = [...root.querySelectorAll(".necto-dialog-actions button")].map((b) => b.textContent);
  expect(buttons).toEqual(["닫기", "복사"]);
  expect($(root, ".necto-dialog").textContent).toContain("⌘C");
});

test("closes the box and reports the copy when the box's [Copy] succeeds", async () => {
  const { root, fieldCopies } = mount();
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  click($(root, '[data-dialog="confirm"]'));
  expect(fieldCopies[0]).toContain('"force": true');
  expect($(root, ".ml-dialog-layer")).toBeNull();
  expect(root.textContent).toContain("복사했습니다");
});

test("keeps the box and asks for ⌘C when the box's [Copy] is blocked too", async () => {
  const { root, deps } = mount();
  deps.fieldCopyResult = false;
  click($(root, '[data-action="export"]'));
  await vi.advanceTimersByTimeAsync(0);
  click($(root, '[data-dialog="confirm"]'));
  expect($(root, ".ml-dialog-layer")).not.toBeNull();
  expect($(root, ".necto-dialog .ml-error").textContent).toContain("⌘C");
});

test("reports how many rules were imported once the import is saved", async () => {
  const { root, model } = mount();
  click($(root, '[data-action="import"]'));
  type(
    field(root, "dialog-text"),
    JSON.stringify({ force: true, configuration: configuration([rule("x"), rule("y")]) }),
  );
  click($(root, '[data-dialog="confirm"]'));
  await model.idle();
  await vi.advanceTimersByTimeAsync(0);
  expect(root.textContent).toContain("규칙 2개를 가져왔습니다");
});

describe("pasting a configuration: what it would change shows at once, a mistake only on Import", () => {
  const confirm = (root: HTMLElement) => $(root, '[data-dialog="confirm"]') as HTMLButtonElement;
  const preview = (root: HTMLElement) => $(root, ".necto-dialog [data-preview]").textContent;
  const error = (root: HTMLElement) => $(root, ".necto-dialog .ml-error").textContent;

  test("Import stays off until there is text", () => {
    const { root } = mount();
    click($(root, '[data-action="import"]'));
    expect(confirm(root).disabled).toBe(true);
    type(field(root, "dialog-text"), "  ");
    expect(confirm(root).disabled).toBe(true);
    type(field(root, "dialog-text"), "{");
    expect(confirm(root).disabled).toBe(false);
  });

  test("a configuration that reads shows what it holds and that it replaces the current one", () => {
    const { root } = mount();
    click($(root, '[data-action="import"]'));
    type(
      field(root, "dialog-text"),
      JSON.stringify({
        force: true,
        configuration: { ...configuration([rule("x"), rule("y")]), allowedHosts: ["api.example.com", "b.example.com"] },
      }),
    );
    expect(preview(root)).toBe("규칙 2개 · 허용 호스트 api.example.com, b.example.com · 지금 설정을 바꿉니다");
    expect(error(root)).toBe("");
  });

  test("text that doesn't read stays quiet until Import, and the error goes once the text changes", () => {
    const { root } = mount();
    click($(root, '[data-action="import"]'));
    type(field(root, "dialog-text"), '{"version": 1, "rules": [');
    expect(preview(root)).toBe("");
    expect(error(root)).toBe("");
    click(confirm(root));
    expect(error(root)).not.toBe("");
    type(field(root, "dialog-text"), JSON.stringify(configuration()));
    expect(error(root)).toBe("");
    expect(preview(root)).not.toBe("");
  });
});

test("shows no success notice when the import is rejected", async () => {
  const { api, root, model } = mount();
  api.results = [{ ok: false, reason: "invalid", message: "bad", revision: 0 }];
  click($(root, '[data-action="import"]'));
  type(field(root, "dialog-text"), JSON.stringify(configuration()));
  click($(root, '[data-dialog="confirm"]'));
  await model.idle();
  await vi.advanceTimersByTimeAsync(0);
  expect(root.textContent).not.toContain("가져왔습니다");
  expect(root.textContent).toContain("저장하지 못했습니다");
});

test("shows the wait while the app is not connected and subscribes again after 2 seconds", async () => {
  const api = new FakeAPI();
  api.stateError = Object.assign(new Error("no app"), { code: "TARGET_DISCONNECTED" });
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
  });
  connect(api, model, view, undefined, 2000);
  await vi.advanceTimersByTimeAsync(0);
  expect(document.body.textContent).toContain("앱 연결을 기다리는 중");
  await vi.advanceTimersByTimeAsync(2000);
  expect(view.connection).toBe("connected");
});

test("subscribes again whatever error ends the subscription (such as PROVIDER_FAILED on an app relaunch)", async () => {
  const api = new FakeAPI();
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
  });
  connect(api, model, view, undefined, 2000);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.connection).toBe("connected");
  api.stateErrorHandler!(Object.assign(new Error("cancelled"), { code: "PROVIDER_FAILED" }));
  expect(view.connection).toBe("waiting");
  await vi.advanceTimersByTimeAsync(2000);
  expect(view.connection).toBe("connected");
});

test("subscribes again when the periodic check fails, even if the subscription ended silently", async () => {
  const api = new FakeAPI();
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
  });
  connect(api, model, view, undefined, 2000);
  await vi.advanceTimersByTimeAsync(0);
  api.state = async () => { throw new Error("no app"); };
  await vi.advanceTimersByTimeAsync(5000);
  expect(view.connection).toBe("waiting");
});

function gateWrites(api: FakeAPI) {
  const gates: Array<(r: WriteResult) => void> = [];
  api.write = (op, input) => {
    api.writes.push({ op, input });
    return new Promise<WriteResult>((resolve) => gates.push(resolve));
  };
  return gates;
}
const flush = () => vi.advanceTimersByTimeAsync(0);

test("an error choice changed while a save is in progress goes into the next save", async () => {
  const api = new FakeAPI();
  const gates = gateWrites(api);
  const { root } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "body"), '{"x":1}');
  await vi.advanceTimersByTimeAsync(400);
  expect(api.writes).toHaveLength(1);
  const error = field(root, "error") as unknown as HTMLSelectElement;
  error.value = "timedOut";
  error.dispatchEvent(new Event("change", { bubbles: true }));
  gates[0]({ ok: true, revision: 1 });
  await flush();
  await vi.advanceTimersByTimeAsync(400);
  await flush();
  expect(api.writes).toHaveLength(2);
  expect(lastWrite(api).input).toMatchObject({ rule: { responses: { ok: { error: "timedOut" } } } });
});

test("does not rewind the input when the first save's echo arrives during two consecutive saves", async () => {
  const api = new FakeAPI();
  const gates = gateWrites(api);
  const { root, model } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  type(field(root, "status"), "504");
  await vi.advanceTimersByTimeAsync(400);
  gates[0]({ ok: true, revision: 1 });
  await flush();
  const echoed = rule("a");
  echoed.responses = { ok: { status: 503, json: {} } };
  model.receiveState(engineState({ ...configuration([echoed]), revision: 1 }));
  expect(field(root, "status").value).toBe("504");
});

describe("body key order", () => {
  const ordered = '{\n  "zone": 1,\n  "alpha": {"y": 2, "b": 3}\n}';

  test("a JSON body is sent as the text typed, keys in the typed order, with a JSON content type", async () => {
    const { api, root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "body"), ordered);
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    const sent = (lastWrite(api).input.rule as Rule).responses.ok;
    expect(sent.body).toBe(ordered);
    expect(sent.json).toBeUndefined();
    expect(sent.headers).toEqual({ "Content-Type": "application/json" });
  });

  test("the body and headers text do not change when the echo arrives with every object's keys in another order", async () => {
    const saved: Rule = {
      ...rule("a"),
      responses: {
        ok: { status: 200, headers: { "X-Zeta": "1", "X-Alpha": "2" }, json: { zone: 1, alpha: { y: 2, b: 3 } } },
        down: { status: 503 },
      },
    };
    const api = new FakeAPI();
    api.current = engineState(configuration([saved]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const body = field(root, "body").value;
    const headers = field(root, "headers").value;
    expect(body.indexOf("zone")).toBeLessThan(body.indexOf("alpha"));
    const reordered: Rule = {
      ...rule("a"),
      responses: {
        down: { status: 503 },
        ok: { json: { alpha: { b: 3, y: 2 }, zone: 1 }, headers: { "X-Alpha": "2", "X-Zeta": "1" }, status: 200 },
      },
    };
    model.receiveState(engineState({ ...configuration([reordered]), enabled: false, revision: 1 }));
    expect(field(root, "body").value).toBe(body);
    expect(field(root, "headers").value).toBe(headers);
  });

  test("a text body that only looks like JSON gets no Content-Type it was never served with when another field changes", async () => {
    const saved: Rule = { ...rule("a"), responses: { ok: { status: 200, body: '{"a":1}' } } };
    const api = new FakeAPI();
    api.current = engineState(configuration([saved]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "status"), "201");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    const sent = (lastWrite(api).input.rule as Rule).responses.ok;
    expect(sent).toEqual({ status: 201, body: '{"a":1}' });
  });

  test("a legacy json body keeps the JSON content type the engine gave it, once saved as text", async () => {
    const saved: Rule = { ...rule("a"), responses: { ok: { status: 200, json: { a: 1 } } } };
    const api = new FakeAPI();
    api.current = engineState(configuration([saved]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "status"), "201");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    const sent = (lastWrite(api).input.rule as Rule).responses.ok;
    expect(sent.headers).toEqual({ "Content-Type": "application/json" });
    expect(sent.json).toBeUndefined();
  });

  test("switching a text body to JSON adds the JSON content type", async () => {
    const saved: Rule = { ...rule("a"), responses: { ok: { status: 200, body: "plain" } } };
    const api = new FakeAPI();
    api.current = engineState(configuration([saved]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const kind = field(root, "body-kind") as unknown as HTMLSelectElement;
    kind.value = "json";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    type(field(root, "body"), '{"b":2}');
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    const sent = (lastWrite(api).input.rule as Rule).responses.ok;
    expect(sent).toEqual({ status: 200, headers: { "Content-Type": "application/json" }, body: '{"b":2}' });
  });

  test("a rule saved with a JSON text body opens in JSON mode with the text as it was saved", () => {
    const saved: Rule = {
      ...rule("a"),
      responses: { ok: { status: 200, headers: { "Content-Type": "application/json" }, body: ordered } },
    };
    const api = new FakeAPI();
    api.current = engineState(configuration([saved]));
    const { root } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    expect((field(root, "body-kind") as unknown as HTMLSelectElement).value).toBe("json");
    expect(field(root, "body").value).toBe(ordered);
  });
});

test("the editor follows the new state when an app relaunch resets the revision to 0", async () => {
  const { api, root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  const fresh = rule("a");
  fresh.responses = { ok: { status: 404 } };
  model.receiveState({ ...engineState(configuration([fresh])), launchID: "launch-2" });
  expect(field(root, "status").value).toBe("404");
  expect(api.writes).toHaveLength(1);
});

test("keeps the scroll position because request records do not replace the rule list node", () => {
  const { root, model } = mount();
  const rules = $(root, ".ml-rules");
  rules.scrollTop = 40;
  model.receiveRequest({
    seq: 0,
    query: {},
    date: 0,
    method: "GET",
    host: "h.invalid",
    path: "/x",
    outcome: { passthrough: {} },
  });
  expect($(root, ".ml-rules")).toBe(rules);
  expect($(root, ".ml-rules").scrollTop).toBe(40);
});

test("keeps the scroll of the rules, the editor, the traffic list and the detail across a full redraw", () => {
  const { root, model, api } = mount();
  for (const name of ["ml-rules", "ml-editor"]) $(root, `.${name}`).scrollTop = 25;
  model.receiveState({ ...api.current, issues: ["x"] });
  for (const name of ["ml-rules", "ml-editor"]) expect($(root, `.${name}`).scrollTop).toBe(25);
  click($(root, '[data-tab="traffic"]'));
  for (const name of ["ml-traffic-list", "ml-traffic-detail"]) $(root, `.${name}`).scrollTop = 25;
  model.receiveState({ ...api.current, issues: ["y"] });
  for (const name of ["ml-traffic-list", "ml-traffic-detail"]) expect($(root, `.${name}`).scrollTop).toBe(25);
});

test("the periodic check subscribes again when the subscription ended silently and the app relaunched (launchID changed)", async () => {
  const api = new FakeAPI();
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
  });
  connect(api, model, view, undefined, 2000);
  await vi.advanceTimersByTimeAsync(0);
  api.current = { ...api.current, launchID: "launch-2" };
  await vi.advanceTimersByTimeAsync(5000);
  expect(view.connection).toBe("waiting");
  await vi.advanceTimersByTimeAsync(2000);
  expect(view.connection).toBe("connected");
  expect(model.state?.launchID).toBe("launch-2");
});

test("the periodic check accepts only newer revisions of the same launch and drops older ones", async () => {
  const api = new FakeAPI();
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
  });
  connect(api, model, view, undefined, 2000);
  await vi.advanceTimersByTimeAsync(0);
  model.receiveState({ ...api.current, revision: 5 });
  api.current = { ...api.current, revision: 3 };
  await vi.advanceTimersByTimeAsync(5000);
  expect(model.state?.revision).toBe(5);
  api.current = { ...api.current, revision: 6 };
  await vi.advanceTimersByTimeAsync(5000);
  expect(model.state?.revision).toBe(6);
});

test("cancels a late-arriving subscription right away when stopped mid-subscribe", async () => {
  const api = new FakeAPI();
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
  });
  let release!: (u: () => Promise<void>) => void;
  api.observeState = () => new Promise((resolve) => { release = resolve; });
  const requestsSpy = vi.spyOn(api, "observeRequests");
  const { stop } = connect(api, model, view, undefined, 2000);
  stop();
  const unsubscribed = vi.fn(async () => undefined);
  release(unsubscribed);
  await vi.advanceTimersByTimeAsync(0);
  expect(unsubscribed).toHaveBeenCalledTimes(1);
  expect(requestsSpy).not.toHaveBeenCalled();
});

test("keeps the rule edit draft when switching tabs, and remembers the chosen tab", async () => {
  const { root, deps } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  click($(root, '[data-tab="traffic"]'));
  expect(deps.prefs.get("panel.tab")).toBe("traffic");
  expect(root.querySelector(".ml-traffic")).not.toBeNull();
  click($(root, '[data-tab="rules"]'));
  expect(field(root, "status").value).toBe("503");
  expect(deps.prefs.get("panel.tab")).toBe("rules");
});

test("opens on the remembered tab", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: { get: (k) => (k === "panel.tab" ? "traffic" : undefined), set: () => undefined },
  });
  view.connection = "connected";
  model.receiveState(api.current);
  expect($(document.body, '[data-tab="traffic"]').getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector(".ml-traffic")).not.toBeNull();
});

test("has no request log at the bottom", () => {
  const { root } = mount();
  expect(root.querySelector(".ml-log")).toBeNull();
});

test("the first-run hint in the header points to the traffic tab", () => {
  const api = new FakeAPI();
  api.current = engineState({ ...configuration(), allowedHosts: [] });
  const { root } = mount(api);
  expect(root.textContent).toContain("트래픽 탭에서");
});

test("capturing into an existing rule stays on the tab and offers [Send this response to the app] and [Open rule]", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("devices", "/a/{id}")]));
  const { root, model, view } = mount(api);
  click($(root, '[data-tab="traffic"]'));
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  expect(lastWrite(api)).toMatchObject({
    op: "maplocal.rule.upsert",
    input: { rule: { id: "devices", active: "ok", responses: { "캡처한 응답": { status: 200 } } } },
  });
  expect($(root, '[data-tab="traffic"]').getAttribute("aria-selected")).toBe("true");
  expect($(root, '[data-action="activate-captured"]').textContent).toBe("앱에 이 응답 보내기");
  click($(root, '[data-action="activate-captured"]'));
  await model.idle();
  expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.setActive", input: { id: "devices", response: "캡처한 응답" } });
  click($(root, '[data-action="open-captured"]'));
  expect($(root, '[data-tab="rules"]').getAttribute("aria-selected")).toBe("true");
  expect($(root, '[data-rule="devices"]').getAttribute("aria-selected")).toBe("true");
});

test("a rule for one query starts from the rule that answered, with the query as its conditions, and leaves that rule as it was", async () => {
  const api = new FakeAPI();
  const orders: Rule = {
    ...rule("orders", "/api/orders"),
    tags: ["auth"],
    match: { method: "GET", host: "maplocal.invalid", path: "/api/orders" },
    responses: { ok: { status: 200, body: '{"orders": []}' }, down: { status: 500 } },
  };
  api.current = engineState(configuration([orders]));
  const { model, view } = mount(api);
  view.ruleForQueryFrom(trafficEntry({ path: "/api/orders", query: { page: "2" }, result: "mocked" }), "orders");
  await model.idle();
  const created = lastWrite(api).input.rule as Rule;
  expect(created.id).not.toBe("orders");
  expect(created).toMatchObject({
    enabled: true,
    tags: ["auth"],
    match: { method: "GET", host: "maplocal.invalid", path: "/api/orders", query: { page: "2" } },
    active: "ok",
    responses: { ok: { status: 200, body: '{"orders": []}' } },
  });
  expect(Object.keys(created.responses)).toEqual(["ok"]);
  expect(api.writes.filter((w) => (w.input.rule as Rule | undefined)?.id === "orders")).toEqual([]);
});

test("a rule for one query starts with the response the app gets, whatever it is named", async () => {
  const api = new FakeAPI();
  const orders: Rule = {
    ...rule("orders", "/api/orders"),
    active: "live",
    responses: { draft: { status: 418 }, live: { status: 200, body: "{}" } },
  };
  api.current = engineState(configuration([orders]));
  const { model, view } = mount(api);
  view.ruleForQueryFrom(trafficEntry({ path: "/api/orders", query: { page: "2" }, result: "mocked" }), "orders");
  await model.idle();
  const created = lastWrite(api).input.rule as Rule;
  expect(created.active).toBe("live");
  expect(created.responses).toEqual({ live: { status: 200, body: "{}" } });
});

test("a rule for one query is made once even when asked twice before the echo", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("orders", "/api/orders")]));
  const { model, view } = mount(api);
  const entry = trafficEntry({ path: "/api/orders", query: { page: "2" }, result: "mocked" });
  view.ruleForQueryFrom(entry, "orders");
  view.ruleForQueryFrom(entry, "orders");
  await model.idle();
  expect(api.writes.filter((w) => w.op === "maplocal.rule.upsert")).toHaveLength(1);
});

describe("a rule made from traffic with query conditions is followed until it first answers", () => {
  const ordersAt = (startedAt: number, query: Record<string, string>, over: Partial<TrafficEntry> = {}) =>
    trafficEntry({
      key: `n${startedAt}`,
      path: "/api/orders",
      query,
      url: `https://maplocal.invalid/api/orders?${new URLSearchParams(query)}`,
      startedAt,
      ...over,
    });
  const ours = (seq: number, date: number, query: Record<string, string>, rule?: string): RequestEvent => ({
    seq,
    query,
    date,
    method: "GET",
    host: "maplocal.invalid",
    path: "/api/orders",
    outcome: rule ? { mocked: { rule, response: "ok", status: 200 } } : { passthrough: {} },
  });
  /// The source rule `orders` answers every query; a rule for page=2&_=100 is made from it.
  const made = async (over: Partial<Configuration> = {}, tags: string[] = [], query: Record<string, string> = { page: "2", _: "100" }) => {
    const api = new FakeAPI();
    const orders = { ...rule("orders", "/api/orders"), tags };
    api.current = engineState({ ...configuration([orders]), ...over });
    const m = mountTraffic(api);
    m.view.ruleForQueryFrom(ordersAt(1000, query, { result: "mocked" }), "orders");
    await m.model.idle();
    const created = lastWrite(api).input.rule as Rule;
    api.current = engineState({ ...configuration([orders, created]), ...over, revision: 1 });
    m.model.receiveState(api.current);
    return { ...m, api, id: created.id };
  };
  const later = (query: Record<string, string>) =>
    ordersAt(2000, query, { result: "mocked", mockedBy: { rule: "orders", response: "ok" } });

  test("a later request it doesn't answer names the failed condition, and removing it is offered when the rule would then answer", async () => {
    const { view, id } = await made();
    expect(view.unkeptFor(later({ page: "2", _: "200" }))).toEqual({
      rule: expect.objectContaining({ id }),
      misses: [{ key: "_", expected: "100", actual: "200" }],
      remove: "_",
    });
  });

  test("removing a condition is not offered when the rule would still lose to the one that answered", async () => {
    const { view } = await made({}, [], { page: "2" });
    const unkept = view.unkeptFor(later({ page: "3" }));
    expect(unkept?.misses).toEqual([{ key: "page", expected: "2", actual: "3" }]);
    expect(unkept?.remove).toBeUndefined();
  });

  test("says nothing about requests from before it was made, or ones it answered", async () => {
    const { view, id } = await made();
    expect(view.unkeptFor(ordersAt(500, { page: "2", _: "50" }))).toBeUndefined();
    expect(view.unkeptFor(ordersAt(2000, { page: "2", _: "100" }, { result: "mocked", mockedBy: { rule: id, response: "ok" } })))
      .toBeUndefined();
  });

  test("requests already listed when it was made, even newer than the one it was made from, are not counted", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("orders", "/api/orders")]));
    const m = mountTraffic(api);
    m.store.ingestOurs([ours(1, 3000, { page: "3", _: "300" }, "orders")]);
    m.view.ruleForQueryFrom(ordersAt(1000, { page: "2", _: "100" }, { result: "mocked" }), "orders");
    await m.model.idle();
    expect(m.view.unkeptFor(ordersAt(2500, { page: "2", _: "250" }))).toBeUndefined();
    expect(m.view.unkeptFor(ordersAt(3500, { page: "2", _: "350" }))).toBeDefined();
  });

  test("requests that arrived while the list was paused count as already listed", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("orders", "/api/orders")]));
    const m = mountTraffic(api);
    m.store.pause();
    m.store.ingestOurs([ours(1, 3000, { page: "3", _: "300" }, "orders")]);
    m.view.ruleForQueryFrom(ordersAt(1000, { page: "2", _: "100" }, { result: "mocked" }), "orders");
    await m.model.idle();
    expect(m.view.unkeptFor(ordersAt(2500, { page: "2", _: "250" }))).toBeUndefined();
  });

  test("once it has answered a request, it stops, even after that record is gone from the list", async () => {
    const { view, store, id } = await made();
    store.ingestOurs([ours(1, 1500, { page: "2", _: "100" }, id)]);
    store.ingestOurs(Array.from({ length: 1001 }, (_, i) => ours(i + 2, 1600 + i, { other: String(i) })));
    expect(store.entries().some((e) => e.mockedBy?.rule === id)).toBe(false);
    expect(view.unkeptFor(later({ page: "3", _: "100" }))).toBeUndefined();
  });

  test("an answer that arrives while the traffic list is paused counts too", async () => {
    const { view, store, id } = await made();
    store.pause();
    store.ingestOurs([ours(1, 1500, { page: "2", _: "100" }, id)]);
    store.ingestOurs(Array.from({ length: 1001 }, (_, i) => ours(i + 2, 1600 + i, { other: String(i) })));
    store.resume();
    expect(view.unkeptFor(later({ page: "3", _: "100" }))).toBeUndefined();
  });

  test.each([
    ["Map Local is off", { enabled: false }],
    ["the host is not allowed", { allowedHosts: ["other.invalid"] }],
  ])("says nothing when %s, since another reason comes first", async (_n, over) => {
    const { view } = await made(over);
    expect(view.unkeptFor(later({ page: "2", _: "200" }))).toBeUndefined();
  });

  test("says nothing while the rule is off", async () => {
    const { view, model, api, id } = await made();
    const configured = api.current.configuration;
    model.receiveState({
      ...api.current,
      revision: 2,
      configuration: { ...configured, rules: configured.rules.map((r) => (isRule(r) && r.id === id ? { ...r, enabled: false } : r)) },
    });
    expect(view.unkeptFor(later({ page: "2", _: "200" }))).toBeUndefined();
  });

  test("rules made by capture with a query, or empty with a query, are followed too", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([]));
    const m = mountTraffic(api);
    m.view.captureInto(ordersAt(1000, { page: "2", _: "100" }), networkDetail(), "/api/orders", undefined, { page: "2", _: "100" });
    m.view.emptyRuleFrom(ordersAt(1000, { page: "5", _: "100" }), "/api/orders", { page: "5", _: "100" });
    await m.model.idle();
    const made = api.writes.map((w) => w.input.rule as Rule | undefined).filter((r): r is Rule => r !== undefined);
    const idFor = (page: string) => made.find((r) => r.match.query?.page === page)!.id;
    m.model.receiveState(engineState({ ...configuration(made), revision: 3 }));
    expect(m.view.unkeptFor(ordersAt(2000, { page: "2", _: "200" }))?.rule.id).toBe(idFor("2"));
    expect(m.view.unkeptFor(ordersAt(2000, { page: "5", _: "200" }))?.rule.id).toBe(idFor("5"));
  });

  test("a rule made with + Rule is not followed", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([{ ...rule("hand", "/api/orders"), match: { method: "GET", path: "/api/orders", query: { page: "2" } } }]));
    const { view } = mountTraffic(api);
    expect(view.unkeptFor(ordersAt(2000, { page: "3" }))).toBeUndefined();
  });

  test("removing a condition writes the rule without it, and leaves the received state as it was until the echo", async () => {
    const { view, model, api, id } = await made();
    api.results = [{ ok: false, reason: "invalid", message: "bad", revision: 1 }];
    view.removeConditionFrom(id, "_");
    await model.idle();
    expect(lastWrite(api).input.rule).toMatchObject({ id, match: { query: { page: "2" } } });
    expect(Object.keys((lastWrite(api).input.rule as Rule).match.query ?? {})).toEqual(["page"]);
    const received = model.state!.configuration.rules.filter(isRule).find((r) => r.id === id)!;
    expect(received.match.query).toEqual({ page: "2", _: "100" });
  });

  test("removing a condition from the rule open in the editor updates the editor, so its next save keeps it removed", async () => {
    const { view, model, api, root, id } = await made();
    click($(root, '[data-tab="rules"]'));
    click($(root, `[data-rule="${id}"] .ml-path`));
    view.removeConditionFrom(id, "_");
    await model.idle();
    expect([...root.querySelectorAll('[data-field^="query-key:"]')].map((el) => (el as HTMLInputElement).value)).toEqual(["page"]);
    type(field(root, "status"), "201");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect((lastWrite(api).input.rule as Rule).match.query).toEqual({ page: "2" });
  });

  test("removing a condition from an auth rule asks first", async () => {
    const { view, root, api, id } = await made({}, ["auth"]);
    const writes = api.writes.length;
    view.removeConditionFrom(id, "_");
    expect($(root, ".necto-dialog").textContent).toContain("인증 규칙");
    expect(api.writes).toHaveLength(writes);
  });
});

test("keeps both responses when the same rule is captured into twice before the state echo", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("devices", "/a/{id}")]));
  const { model, view } = mount(api);
  view.captureInto(
    trafficEntry(),
    networkDetail({ responseBody: { byteCount: 7, isTruncated: false, text: '{"n":1}' } }),
    "/a/3",
  );
  view.captureInto(
    trafficEntry(),
    networkDetail({ responseBody: { byteCount: 7, isTruncated: false, text: '{"n":2}' } }),
    "/a/3",
  );
  await model.idle();
  const upserts = api.writes.filter((w) => w.op === "maplocal.rule.upsert").map((w) => w.input.rule as Rule);
  expect(upserts).toHaveLength(2);
  expect(upserts[1].id).toBe("devices");
  expect(upserts[1].responses["캡처한 응답"].body).toBe('{\n  "n": 1\n}');
  expect(upserts[1].responses["캡처한 응답 2"].body).toBe('{\n  "n": 2\n}');
});

test("adds two responses to one rule when a request without a matching rule is captured twice before the state echo", async () => {
  const { api, model, view } = mount();
  const entry = trafficEntry({ path: "/new", url: "https://maplocal.invalid/new" });
  view.captureInto(
    entry,
    networkDetail({ responseBody: { byteCount: 7, isTruncated: false, text: '{"n":1}' } }),
    "/new",
  );
  view.captureInto(
    entry,
    networkDetail({ responseBody: { byteCount: 7, isTruncated: false, text: '{"n":2}' } }),
    "/new",
  );
  await model.idle();
  const upserts = api.writes.filter((w) => w.op === "maplocal.rule.upsert").map((w) => w.input.rule as Rule);
  expect(upserts.map((r) => r.id)).toEqual(["get-new", "get-new"]);
  expect(Object.keys(upserts[1].responses)).toEqual(["캡처한 응답", "캡처한 응답 2"]);
});

test("once a state echo at or above the written revision arrives, later captures build on the rules of the received state", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("devices", "/a/{id}")]));
  const { model, view } = mount(api);
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  model.receiveState(engineState({ ...configuration([rule("devices", "/a/{id}")]), revision: api.revision }));
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  expect(Object.keys((lastWrite(api).input.rule as Rule).responses)).toEqual(["ok", "캡처한 응답"]);
});

test("forgets captures waiting for an echo when the app relaunches", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("devices", "/a/{id}")]));
  const { model, view } = mount(api);
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  model.receiveState({ ...engineState(configuration([rule("devices", "/a/{id}")])), launchID: "launch-2" });
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  expect(Object.keys((lastWrite(api).input.rule as Rule).responses)).toEqual(["ok", "캡처한 응답"]);
});

test("does not report a save when the capture save is rejected", async () => {
  const api = new FakeAPI();
  api.results = [{ ok: false, reason: "invalid", message: "bad", revision: 0 }];
  const { root, model, view } = mount(api);
  view.captureInto(trafficEntry({ path: "/new", url: "https://maplocal.invalid/new" }), networkDetail(), "/new");
  await model.idle();
  expect(root.textContent).not.toContain("응답을 저장했어요");
  expect(root.textContent).toContain("저장하지 못했습니다");
});

test("merges a capture into the draft when the rule editor holds a pending draft of that rule", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("devices", "/a/{id}")]));
  api.results = [{ ok: false, reason: "invalid", message: "bad", revision: 0 }];
  const { root, model, view } = mount(api);
  click($(root, '[data-rule="devices"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  const sent = lastWrite(api).input.rule as Rule;
  expect(sent.responses.ok.status).toBe(503);
  expect(sent.responses["캡처한 응답"]).toBeDefined();
});

test("choosing to add to a disabled rule adds the response and leaves the rule's on state alone", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([{ ...rule("devices", "/a/{id}"), enabled: false }]));
  const { model, view } = mount(api);
  view.captureInto(trafficEntry(), networkDetail(), "/a/3", "devices");
  await model.idle();
  expect(lastWrite(api)).toMatchObject({
    op: "maplocal.rule.upsert",
    input: {
      rule: { id: "devices", enabled: false, responses: { "캡처한 응답": { status: 200 } } },
    },
  });
});

test("adding to a disabled rule and turning it on makes the captured response the one the app gets, and says it applies (O5)", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([{ ...rule("devices", "/a/{id}"), enabled: false }]));
  const { model, view, root } = mount(api);
  view.captureInto(trafficEntry(), networkDetail(), "/a/3", "devices", undefined, true);
  await model.idle();
  expect(lastWrite(api)).toMatchObject({
    op: "maplocal.rule.upsert",
    input: { rule: { id: "devices", enabled: true, active: "캡처한 응답", responses: { ok: {}, "캡처한 응답": { status: 200 } } } },
  });
  const notice = $(root, '[data-notice="capture"]');
  expect(notice.textContent).toContain("GET /a/{id} 규칙에 응답을 추가하고 켰습니다 — 다음 요청부터 적용됩니다");
  expect(notice.querySelector('[data-action="activate-captured"]')).toBeNull();
});

describe("opening a rule after adding a response shows that response (O6)", () => {
  const capturedInto = async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("devices", "/a/{id}")]));
    const m = mount(api);
    m.view.captureInto(trafficEntry(), networkDetail(), "/a/3");
    await m.model.idle();
    return m;
  };
  const tab = (root: HTMLElement, name: string) => field(root, `response-tab:${name}`);

  test("[Open rule] in the notice selects the added response's tab, and says the app still gets the active one", async () => {
    const { root, model, api } = await capturedInto();
    click($(root, '[data-field="toast-open"]'));
    expect(tab(root, "캡처한 응답").getAttribute("aria-selected")).toBe("true");
    expect(tab(root, "ok").getAttribute("aria-selected")).toBe("false");
    const note = $(root, '[data-caption="not-active"]');
    expect(note.textContent).toContain("앱은 지금 ok 응답을 받습니다");
    click(note.querySelector('[data-action="activate-shown"]'));
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.setActive", input: { id: "devices", response: "캡처한 응답" } });
  });

  test("the added response stays selected when the echo of the capture arrives", async () => {
    const { root, model, api } = await capturedInto();
    click($(root, '[data-field="toast-open"]'));
    const echoed = lastWrite(api).input.rule as Rule;
    model.receiveState(engineState({ ...configuration([echoed]), revision: 1 }));
    expect(tab(root, "캡처한 응답").getAttribute("aria-selected")).toBe("true");
  });

  test("the live mark stays on the response the app gets while the captured one is shown, and is announced as current", async () => {
    const { root } = await capturedInto();
    click($(root, '[data-field="toast-open"]'));
    expect(tab(root, "ok").hasAttribute("data-live")).toBe(true);
    expect(tab(root, "ok").getAttribute("aria-current")).toBe("true");
    expect(tab(root, "캡처한 응답").hasAttribute("data-live")).toBe(false);
    expect(tab(root, "캡처한 응답").hasAttribute("aria-current")).toBe(false);
  });

  test("'Send this response to the app' pressed just after renaming the shown response sends the new name", async () => {
    const { root, model, api } = await capturedInto();
    click($(root, '[data-field="toast-open"]'));
    const send = $(root, '[data-caption="not-active"] [data-action="activate-shown"]');
    const name = field(root, "response-name");
    type(name, "real");
    name.dispatchEvent(new Event("change", { bubbles: true }));
    click(send);
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.setActive", input: { id: "devices", response: "real" } });
    expect(tabNames(root)).toEqual(["ok", "real"]);
  });

  test("opening a rule from the list still shows the active response, with no note", async () => {
    const { root } = await capturedInto();
    click($(root, '[data-tab="rules"]'));
    click($(root, '[data-rule="devices"] .ml-path'));
    expect(tab(root, "ok").getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector('[data-caption="not-active"]')).toBeNull();
  });
});

test("the capture notice says how many server headers were not copied", async () => {
  const { model, view, root } = mount();
  view.captureInto(
    trafficEntry({ path: "/new" }),
    networkDetail({ responseHeaders: { "Content-Type": "application/json", Server: "x", "Cache-Control": "no-store" } }),
    "/new",
  );
  await model.idle();
  expect($(root, '[data-notice="capture"]').textContent).toContain("복사하지 않은 서버 헤더 2개");
});

test("capture copies token values as they are and does not claim to hide them", async () => {
  const { api, root, model, view } = mount();
  view.captureInto(
    trafficEntry({ path: "/new" }),
    networkDetail({ responseBody: { byteCount: 9, isTruncated: false, text: '{"token":"x"}' } }),
    "/new",
  );
  await model.idle();
  expect(root.textContent).toContain("목업을 만들었습니다");
  expect(root.textContent).not.toMatch(/가렸|가려/);
  expect((lastWrite(api).input.rule as Rule).responses["캡처한 응답"].body).toBe('{\n  "token": "x"\n}');
});

test("Esc does not clear the traffic selection while the traffic tab is hidden", () => {
  const store = new TrafficStore(() => view.refreshTraffic());
  const order = new OrderDetector();
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order },
  });
  view.connection = "connected";
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  click($(root, '[data-tab="traffic"]'));
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([
    {
      id: "1",
      method: "GET",
      url: "https://maplocal.invalid/a/1",
      host: "maplocal.invalid",
      startedAtMilliseconds: 1,
      state: "completed",
      statusCode: 200,
    },
  ]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  click($(root, '[data-tab="rules"]'));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  click($(root, '[data-tab="traffic"]'));
  expect($(root, '.ml-traffic-row[data-key="1"]').getAttribute("aria-selected")).toBe("true");
});

test("does not draw store changes while the traffic tab is hidden, and shows the latest list when it is visible again", () => {
  const store = new TrafficStore(() => view.refreshTraffic());
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  store.ingestNetwork([
    {
      id: "1",
      method: "GET",
      url: "https://maplocal.invalid/a/1",
      host: "maplocal.invalid",
      startedAtMilliseconds: 1,
      state: "completed",
      statusCode: 200,
    },
  ]);
  expect(root.querySelector(".ml-traffic")).toBeNull();
  click($(root, '[data-tab="traffic"]'));
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(1);
});

test("shows the banner when order-warning evidence gathered on the rules tab holds after the traffic tab opens", () => {
  vi.setSystemTime(10_000);
  const store = new TrafficStore(() => view.refreshTraffic());
  const order = new OrderDetector();
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order },
  });
  view.connection = "connected";
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  order.networkStarted();
  vi.setSystemTime(12_000); // After the grace period that follows the subscription
  for (const seq of [1, 2, 3]) {
    const e = {
      seq,
      date: 10_000 + seq,
      method: "GET",
      host: "maplocal.invalid",
      path: "/m",
      query: {},
      outcome: { mocked: { rule: "r", response: "ok" } },
    };
    order.liveOurs(e);
    store.ingestOurs([e]);
  }
  click($(root, '[data-tab="traffic"]'));
  expect(root.querySelector('[data-warning="order"]')).toBeNull();
  vi.advanceTimersByTime(1500);
  expect(root.querySelector('[data-warning="order"]')).not.toBeNull();
});

describe("the rule editor shows the latest request the rule is meant for, so a change is confirmed where it was made", () => {
  const event = (seq: number, date: number, query: Record<string, string>, outcome: RequestEvent["outcome"]): RequestEvent => ({
    seq,
    query,
    date,
    method: "GET",
    host: "maplocal.invalid",
    path: "/api/orders",
    outcome,
  });
  const openEditor = (rules: Rule[]) => {
    const api = new FakeAPI();
    api.current = engineState(configuration(rules));
    const m = mountTraffic(api);
    click($(m.root, '[data-tab="rules"]'));
    click($(m.root, `[data-rule="${rules[0].id}"] .ml-path`));
    return m;
  };
  const latest = (root: HTMLElement) => $(root, ".ml-editor [data-latest]").textContent;
  const orders = rule("orders", "/api/orders");

  test("says there is none yet before any request", () => {
    const { root } = openEditor([orders]);
    expect(latest(root)).toContain("이 규칙에 맞는 요청이 아직 없습니다");
  });

  test.each([
    ["mocked by this rule", { mocked: { rule: "orders", response: "ok", status: 200 } }, "이 규칙이 목업함 (ok)"],
    ["answered by another", { mocked: { rule: "other", response: "ok", status: 200 } }, "GET /other 규칙이 응답함"],
    ["went to the real server", { passthrough: {} }, "실서버로 감"],
    ["blocked", { unmocked: { status: 421 } }, "Map Local이 막음"],
    ["of unknown result", { passthrough: {} }, "결과를 알 수 없음"],
  ] as const)("names what answered the newest one (%s), with its time", (_n, outcome, words) => {
    const { root, store } = openEditor([orders, rule("other", "/other")]);
    const at = new Date(2026, 9, 5, 18, 10, 52, 246).getTime();
    if (words === "결과를 알 수 없음") store.ingestNetwork([summary("n1", "/api/orders?x=1", { startedAtMilliseconds: at })]);
    else store.ingestOurs([event(1, at, {}, outcome)]);
    expect(latest(root)).toContain("최근 요청 18:10:52");
    expect(latest(root)).not.toContain(".246");
    expect(latest(root)).toContain(words);
  });

  test("names the newest of several", () => {
    const { root, store } = openEditor([orders]);
    store.ingestOurs([
      event(1, 1_000, {}, { passthrough: {} }),
      event(2, 2_000, {}, { mocked: { rule: "orders", response: "ok", status: 200 } }),
    ]);
    expect(latest(root)).toContain("이 규칙이 목업함");
  });

  test("a rule with no host counts only requests to allowed hosts, as the engine does", () => {
    const { root, store } = openEditor([orders]);
    store.ingestOurs([
      event(1, 1_000, {}, { mocked: { rule: "orders", response: "ok", status: 200 } }),
      { ...event(2, 2_000, {}, { passthrough: {} }), host: "other.invalid" },
    ]);
    expect(latest(root)).toContain("이 규칙이 목업함");
  });

  test("a request from before the last change says so, so an old answer is not taken for the new one", async () => {
    vi.setSystemTime(5_000);
    const { root, store, model } = openEditor([orders]);
    store.ingestOurs([event(1, 3_000, {}, { mocked: { rule: "orders", response: "ok", status: 200 } })]);
    expect(latest(root)).not.toContain("마지막 변경 전");
    type(field(root, "status"), "503");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(latest(root)).toContain("마지막 변경 전 요청");
    expect(latest(root)).not.toContain("앱에서 다시 요청하세요");
    store.ingestOurs([event(2, Date.now() + 100, {}, { mocked: { rule: "orders", response: "ok", status: 503 } })]);
    expect(latest(root)).not.toContain("마지막 변경 전");
  });

  test("a focused 'Show in Traffic' keeps focus as requests arrive", () => {
    const { root, store } = openEditor([orders]);
    store.ingestOurs([event(1, 1_000, {}, { passthrough: {} })]);
    const show = $(root, '.ml-editor [data-action="show-latest"]');
    show.focus();
    store.ingestOurs([event(2, 2_000, {}, { passthrough: {} })]);
    expect(document.activeElement).toBe(show);
    expect(show.isConnected).toBe(true);
  });

  test("counts only requests that meet its query conditions", () => {
    const { root, store } = openEditor([{ ...orders, match: { method: "GET", path: "/api/orders", query: { page: "2" } } }]);
    store.ingestOurs([
      event(1, 1_000, { page: "2" }, { passthrough: {} }),
      event(2, 2_000, { page: "3" }, { mocked: { rule: "orders", response: "ok", status: 200 } }),
    ]);
    expect(latest(root)).toContain("실서버로 감");
  });

  test("follows new requests while the body is being typed in, leaving the field alone", () => {
    const { root, store } = openEditor([orders]);
    const body = field(root, "body") as unknown as HTMLTextAreaElement;
    body.focus();
    type(body, '{"a": 1}');
    store.ingestOurs([event(1, 1_000, {}, { passthrough: {} })]);
    expect(latest(root)).toContain("실서버로 감");
    expect(field(root, "body")).toBe(body);
    expect(document.activeElement).toBe(body);
  });

  test("follows new requests while the traffic list is paused, since the rule is about what happened", () => {
    const { root, store } = openEditor([orders]);
    store.pause();
    store.ingestOurs([event(1, 1_000, {}, { mocked: { rule: "orders", response: "ok", status: 200 } })]);
    expect(latest(root)).toContain("이 규칙이 목업함 (ok)");
  });

  test("'Show in Traffic' opens a request that arrived while the list was paused, and shows it in the list", () => {
    const { root, store } = openEditor([orders]);
    click($(root, '[data-tab="traffic"]'));
    store.ingestOurs([event(1, 1_000, {}, { passthrough: {} })]);
    click($(root, '.ml-traffic-row[data-key="ours:1"]'));
    click($(root, '[data-action="pause"]'));
    expect(store.paused).toBe(true);
    click($(root, '[data-tab="rules"]'));
    store.ingestOurs([event(2, 2_000, {}, { passthrough: {} })]);
    click($(root, '.ml-editor [data-action="show-latest"]'));
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("ours:2");
    expect(root.querySelector('.ml-traffic-row[data-key="ours:2"]')).not.toBeNull();
  });

  test("stays on one line, cut short with the full text on hover, so nothing below moves as it changes", () => {
    const { root, store } = openEditor([orders]);
    store.ingestOurs([event(1, 1_000, {}, { passthrough: {} })]);
    const text = $(root, ".ml-editor [data-latest-text]");
    expect(text.title).toBe(text.textContent);
    expect(css).toMatch(/\.ml-latest\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.ml-latest button\s*\{[^}]*margin-left:\s*auto/);
    store.ingestOurs([event(2, 2_000, {}, { passthrough: {} })]);
    expect(text.title).toBe(text.textContent);
    expect(text.textContent).toContain(formatClock(2_000).slice(0, 8));
    expect(css).toMatch(/\.ml-latest-text\s*\{[^}]*min-width:\s*0[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
  });

  test("'Show in Traffic' opens that request", () => {
    const { root, store } = openEditor([orders]);
    store.ingestOurs([event(1, 1_000, {}, { passthrough: {} })]);
    click($(root, '.ml-editor [data-action="show-latest"]'));
    expect($(root, '[data-tab="traffic"]').getAttribute("aria-selected")).toBe("true");
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("ours:1");
  });
});

function mountTraffic(api = new FakeAPI()) {
  document.body.innerHTML = '<div id="app"></div>';
  let view!: View;
  const store = new TrafficStore(() => view.refreshTraffic());
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  view.networkAvailable = true;
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  click($(root, '[data-tab="traffic"]'));
  click($(root, '[data-mode="time"]'));
  return { root, store, model, api, view };
}
const summary = (id: string, path: string, over: Partial<NetworkSummary> = {}): NetworkSummary => ({
  id,
  method: "GET",
  url: `https://maplocal.invalid${path}`,
  host: "maplocal.invalid",
  startedAtMilliseconds: 1,
  state: "completed",
  statusCode: 200,
  ...over,
});

async function emptyRuleFrom(root: HTMLElement, key: string, model: PanelModel, api: FakeAPI) {
  click($(root, `.ml-traffic-row[data-key="${key}"]`));
  await vi.runAllTimersAsync();
  click($(root, '[data-action="empty-rule"]'));
  await model.idle();
  return lastWrite(api);
}

describe("the reason line's actions write to the app (O12)", () => {
  test("[Turn on] switches Map Local on", async () => {
    const api = new FakeAPI();
    api.current = engineState({ ...configuration([rule("devices", "/a/{id}")]), enabled: false });
    const { root, store, model } = mountTraffic(api);
    store.ingestNetwork([summary("1", "/a/3")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    click($(root, '[data-why="off"] [data-action="why-fix"]'));
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.configuration.patch", input: { enabled: true } });
  });

  test("[Turn on rule] turns the matching rule on", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([{ ...rule("devices", "/a/{id}"), enabled: false }]));
    const { root, store, model } = mountTraffic(api);
    store.ingestNetwork([summary("1", "/a/3")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    click($(root, '[data-why="ruleOff"] [data-action="why-fix"]'));
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { id: "devices", enabled: true } } });
  });
});

describe("requests to hosts blocked in the app code are not described as mocked (M6)", () => {
  const blockedApi = () => {
    const api = new FakeAPI();
    // With no allowed hosts, the 'Allowed hosts only' filter is off, so requests to the blocked
    // host show in the list too.
    api.current = { ...engineState({ ...configuration([]), allowedHosts: [] }), blockedHosts: ["prod.invalid"] };
    api.detailFor = (id) => networkDetail({ id, url: "https://prod.invalid/x", host: "prod.invalid" });
    return api;
  };
  const prodSummary = (id: string) => summary(id, "/x", { url: "https://prod.invalid/x", host: "prod.invalid" });
  const noBlockedClaims = (text: string) => {
    expect(text).not.toContain("목업 중");
    expect(text).not.toContain("다음 요청부터 적용됩니다");
  };

  test("the detail has no 'Add to allowed hosts' and says the host is blocked", async () => {
    const { root, store } = mountTraffic(blockedApi());
    store.ingestNetwork([prodSummary("1")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    expect(root.querySelector('[data-action="allow-host"]')).toBeNull();
    expect($(root, ".ml-capture").textContent).toContain("앱 코드에서 차단한 호스트라 목업되지 않습니다");
  });

  test("mock with this response creates the rule, but neither the notice nor the created state claims it applies, and the host is not allowed", async () => {
    const api = blockedApi();
    const { root, store, model } = mountTraffic(api);
    store.ingestNetwork([prodSummary("1")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    click($(root, '[data-action="capture"]'));
    await model.idle();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.writes.map((w) => w.op)).toEqual(["maplocal.rule.upsert"]);
    const notice = $(root, '[data-notice="capture"]').textContent!;
    expect(notice).toContain("GET /x 목업을 만들었습니다 — 앱 코드에서 차단한 호스트라 목업되지 않습니다");
    noBlockedClaims(notice);
    expect($(root, "[data-capture-done]").getAttribute("data-capture-done")).toBe("blocked");
    expect($(root, ".ml-capture").textContent).toContain("앱 코드에서 차단한 호스트라 목업되지 않습니다");
    noBlockedClaims($(root, ".ml-capture").textContent!);
    expect(root.querySelector('[data-action="allow-host"]')).toBeNull();
  });

  test("mock with an empty response behaves the same", async () => {
    const api = blockedApi();
    api.detailFor = undefined; // Without a loaded detail, 'Mock with an empty response' is the primary action
    const { root, store, model } = mountTraffic(api);
    store.ingestNetwork([prodSummary("1")]);
    await emptyRuleFrom(root, "1", model, api);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.writes.map((w) => w.op)).toEqual(["maplocal.rule.upsert"]);
    const notice = $(root, '[data-notice="capture"]').textContent!;
    expect(notice).toContain("GET /x 목업을 만들었습니다(빈 200 응답) — 앱 코드에서 차단한 호스트라 목업되지 않습니다");
    noBlockedClaims(notice);
  });
});

describe("a created mock's state follows the rule's current state (I-C)", () => {
  const devices = {
    ...rule("devices", "/a/{id}"),
    match: { method: "GET", host: "maplocal.invalid", path: "/a/{id}" },
  };
  /** Selects request 1 in traffic and clicks the primary action (capture). Returns the created (or extended) rule. */
  async function captureRow(base: Rule[]) {
    const api = new FakeAPI();
    api.current = engineState(configuration(base));
    api.detailFor = (id) =>
      networkDetail({
        id,
        url: "https://maplocal.invalid/a/3",
        responseBody: { byteCount: 9, isTruncated: false, text: '{"n":1}' },
      });
    const m = mountTraffic(api);
    m.store.ingestNetwork([summary("1", "/a/3")]);
    click($(m.root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    click($(m.root, '[data-action="capture"]'));
    await m.model.idle();
    await vi.runAllTimersAsync();
    return { ...m, made: lastWrite(api).input.rule as Rule };
  }
  const receive = (m: { api: FakeAPI; model: PanelModel }, rules: Rule[], over: Partial<EngineState> = {}) => {
    m.api.current = { ...engineState(configuration(rules)), revision: 99, ...over };
    m.model.receiveState(m.api.current);
  };
  const done = (root: ParentNode) =>
    root.querySelector("[data-capture-done]")?.getAttribute("data-capture-done") ?? null;

  test("a new mock reads 'Mocking', and becomes 'The rule is off, so the app gets the real server's response' when the rule is turned off", async () => {
    const m = await captureRow([]);
    expect(done(m.root)).toBe("applies");
    receive(m, [{ ...m.made, enabled: false }]);
    await vi.runAllTimersAsync();
    expect(done(m.root)).toBe("off");
    expect($(m.root, ".ml-capture").textContent).toContain("규칙이 꺼져 있어 앱은 실서버 응답을 받습니다");
    expect($(m.root, ".ml-capture").textContent).not.toContain("목업 중");
  });

  test("with Map Local off, a new mock does not claim it applies from the next request", async () => {
    const m = await captureRow([]);
    expect(done(m.root)).toBe("applies");
    receive(m, [m.made], { configuration: { ...configuration([m.made]), enabled: false } });
    await vi.runAllTimersAsync();
    expect(done(m.root)).toBe("map-local-off");
    expect($(m.root, "[data-capture-done]").textContent).toBe("GET /a/3 규칙에 추가했습니다 — Map Local이 꺼져 있어 앱은 실서버 응답을 받습니다");
    expect($(m.root, ".ml-capture").textContent).not.toContain("목업 중");
  });

  test("withdraws the created state when the created response is deleted (elsewhere), so it can be captured again", async () => {
    const m = await captureRow([{ ...devices, responses: { ok: { status: 200 } } }]);
    expect(done(m.root)).toBe("added");
    expect(m.made.responses["캡처한 응답"]).toBeDefined();
    receive(m, [{ ...devices, responses: { ok: { status: 200 } } }]);
    await vi.runAllTimersAsync();
    expect(done(m.root)).toBeNull();
    expect(m.root.querySelector('[data-action="capture"]')).not.toBeNull();
  });

  test("after an app relaunch, a new request with the same key does not inherit the created state of the previous launch", async () => {
    const m = await captureRow([]);
    expect(done(m.root)).toBe("applies");
    m.store.reset("launch-2");
    receive(m, [m.made], { launchID: "launch-2" });
    m.store.ingestNetwork([summary("1", "/a/3")]);
    click($(m.root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    expect(done(m.root)).toBeNull();
  });
});

test("a blocked request disables capture but can still create an empty 200 rule, even with the plugin present", async () => {
  const api = new FakeAPI();
  api.detailFor = (id) => ({
    ...summary(id, "/blocked"),
    statusCode: 421,
    requestHeaders: {},
    responseHeaders: { "X-Map-Local": "unmocked" },
    responseBody: { byteCount: 0, isTruncated: false },
  });
  const { root, store, model } = mountTraffic(api);
  store.ingestNetwork([summary("1", "/blocked", { statusCode: 421 })]);
  store.ingestOurs([
    {
      seq: 1,
      date: 2,
      method: "GET",
      host: "maplocal.invalid",
      path: "/blocked",
      query: {},
      outcome: { unmocked: { status: 421 } },
    },
  ]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect(($(root, '[data-action="capture"]') as HTMLButtonElement).disabled).toBe(true);
  click($(root, '[data-action="empty-rule"]'));
  await model.idle();
  expect(lastWrite(api)).toMatchObject({
    op: "maplocal.rule.upsert",
    input: {
      rule: {
        match: { method: "GET", host: "maplocal.invalid", path: "/blocked" },
        responses: { ok: { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } },
      },
    },
  });
});

test("creates an empty 200 rule from a request missing from the Necto records while the plugin is present", async () => {
  const { root, store, model, api } = mountTraffic();
  store.ingestOurs([
    {
      seq: 1,
      date: 2,
      method: "POST",
      host: "maplocal.invalid",
      path: "/ours",
      query: {},
      outcome: { passthrough: {} },
    },
  ]);
  const write = await emptyRuleFrom(root, "ours:1", model, api);
  expect(write).toMatchObject({
    op: "maplocal.rule.upsert",
    input: {
      rule: {
        match: { method: "POST", host: "maplocal.invalid", path: "/ours" },
        responses: { ok: { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } },
      },
    },
  });
});

test("creates an empty 200 rule from a request whose record the app deleted", async () => {
  const { root, store, model, api } = mountTraffic();
  store.ingestNetwork([summary("1", "/gone")]);
  const write = await emptyRuleFrom(root, "1", model, api);
  expect(write).toMatchObject({
    op: "maplocal.rule.upsert",
    input: {
      rule: {
        match: { method: "GET", host: "maplocal.invalid", path: "/gone" },
        responses: { ok: { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } },
      },
    },
  });
});

test("mocked responses and pending requests have no empty-rule action", async () => {
  const api = new FakeAPI();
  api.detailFor = (id) => ({ ...summary(id, "/m"), requestHeaders: {}, responseHeaders: { "X-Map-Local": "a/ok" } });
  const { root, store } = mountTraffic(api);
  store.ingestNetwork([
    summary("1", "/m"),
    summary("2", "/p", { state: "pending", statusCode: undefined, startedAtMilliseconds: 5 }),
  ]);
  store.ingestOurs([
    {
      seq: 1,
      date: 2,
      method: "GET",
      host: "maplocal.invalid",
      path: "/m",
      query: {},
      outcome: { mocked: { rule: "a", response: "ok" } },
    },
  ]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect(root.querySelector('[data-action="open-rule"]')).not.toBeNull();
  expect(root.querySelector('[data-action="empty-rule"]')).toBeNull();
  click($(root, '.ml-traffic-row[data-key="2"]'));
  await vi.runAllTimersAsync();
  expect(root.querySelector('[data-action="capture"]')).not.toBeNull();
  expect(root.querySelector('[data-action="empty-rule"]')).toBeNull();
});

const emptyRuleWrite = (path: string) => ({
  op: "maplocal.rule.upsert",
  input: {
    rule: {
      match: { method: "GET", host: "maplocal.invalid", path },
      responses: { ok: { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } },
    },
  },
});

test("creates an empty 200 rule from a request that failed without a response", async () => {
  const api = new FakeAPI();
  api.detailFor = (id) => ({
    ...summary(id, "/failed"),
    state: "failed",
    statusCode: undefined,
    requestHeaders: {},
    responseHeaders: {},
  });
  const { root, store, model } = mountTraffic(api);
  store.ingestNetwork([summary("1", "/failed", { state: "failed", statusCode: undefined })]);
  expect(await emptyRuleFrom(root, "1", model, api)).toMatchObject(emptyRuleWrite("/failed"));
});

test("a response with a truncated body disables capture but can create an empty 200 rule", async () => {
  const api = new FakeAPI();
  api.detailFor = (id) => ({
    ...summary(id, "/big"),
    requestHeaders: {},
    responseHeaders: {},
    responseBody: { byteCount: 600_000, isTruncated: true, text: "{" },
  });
  const { root, store, model } = mountTraffic(api);
  store.ingestNetwork([summary("1", "/big")]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect(($(root, '[data-action="capture"]') as HTMLButtonElement).disabled).toBe(true);
  click($(root, '[data-action="empty-rule"]'));
  await model.idle();
  expect(lastWrite(api)).toMatchObject(emptyRuleWrite("/big"));
});

test("a non-text body disables capture but can create an empty 200 rule", async () => {
  const api = new FakeAPI();
  api.detailFor = (id) => ({
    ...summary(id, "/image"),
    requestHeaders: {},
    responseHeaders: { "Content-Type": "image/png" },
    responseBody: { byteCount: 100, isTruncated: false, contentType: "image/png" },
  });
  const { root, store, model } = mountTraffic(api);
  store.ingestNetwork([summary("1", "/image")]);
  expect(await emptyRuleFrom(root, "1", model, api)).toMatchObject(emptyRuleWrite("/image"));
});

test("hides the empty-rule action while the detail is loading", async () => {
  const api = new FakeAPI();
  api.networkDetail = () => new Promise<NetworkDetail>(() => undefined);
  const { root, store } = mountTraffic(api);
  store.ingestNetwork([summary("1", "/slow")]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.advanceTimersByTimeAsync(0);
  expect(root.querySelector('[data-action="capture"]')).not.toBeNull();
  expect(root.querySelector('[data-action="empty-rule"]')).toBeNull();
});

// MARK: One response concept (B)

const twoResponses = () => {
  const api = new FakeAPI();
  api.current = engineState(
    configuration([
      { ...rule("a"), responses: { ok: { status: 200, json: {} }, down: { error: "timedOut" } } },
    ]),
  );
  return api;
};
const tabNames = (root: ParentNode) =>
  [...root.querySelectorAll("[data-response]")].map((el) => el.getAttribute("data-response"));
const selectedTab = (root: ParentNode) =>
  root.querySelector('[data-response][aria-selected="true"]')?.getAttribute("data-response");
const removeButton = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLElement>('[data-action="remove-response"]')].find((el) => el.dataset.remove === name);
const removeShown = (root: ParentNode) => click(removeButton(root, selectedTab(root)!)!);

test("the rule list has no response picker", () => {
  const { root } = mount(twoResponses());
  expect(root.querySelector('[data-rule="a"] select')).toBeNull();
});

test("the editor opens with the response in use selected and says that tab is what the app receives", () => {
  const api = twoResponses();
  api.current.configuration.rules[0] = { ...(api.current.configuration.rules[0] as Rule), active: "down" };
  const { root } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  expect(selectedTab(root)).toBe("down");
  expect($(root, '[data-caption="active-response"]').textContent).toBe("앱이 받는 응답");
  expect($(root, '[data-response="down"]').firstChild?.textContent).toBe("down");
  expect(root.textContent).not.toContain("●");
});

test("the response the app gets is marked on its tab, and the mark moves with it", async () => {
  const api = twoResponses();
  const { root, model } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  const live = () => [...root.querySelectorAll("[data-response][data-live]")].map((el) => el.getAttribute("data-response"));
  expect(live()).toEqual(["ok"]);
  expect($(root, '[data-response="ok"]').title).toBe("앱이 받는 응답입니다");
  expect(css).toMatch(/\.necto-tab\[data-live\]::before\s*\{[^}]*background:\s*var\(--necto-success\)/);
  click($(root, '[data-response="down"]'));
  await model.idle();
  expect(live()).toEqual(["down"]);
});

test("each response tab says what that response is, so the normal and the error one are told apart without opening them", () => {
  const api = new FakeAPI();
  api.current = engineState(
    configuration([
      {
        ...rule("a"),
        responses: {
          ok: { status: 200 },
          down: { status: 500 },
          gone: { error: "notConnectedToInternet" },
          slow: { status: 200, delayMs: 3000 },
          late: { error: "timedOut", delayMs: 800 },
        },
      },
    ]),
  );
  const { root } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  const meta = (name: string) => $(root, `[data-response="${name}"] .ml-tab-meta`).textContent;
  expect(meta("ok")).toBe("200");
  expect(meta("down")).toBe("500");
  expect(meta("gone")).toBe("인터넷 연결 없음");
  expect(meta("slow")).toBe("200 · 3.0s");
  expect(meta("late")).toBe("시간 초과 · 800ms");
});

test("a response tab's summary follows the status being typed", () => {
  const { root } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  expect($(root, '[data-response="ok"] .ml-tab-meta').textContent).toBe("503");
});

test("choosing a response tab saves that response as in use, and the tab does not snap back before the echo", async () => {
  const { api, root, model } = mount(twoResponses());
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-response="down"]'));
  await model.idle();
  expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.setActive", input: { id: "a", response: "down" } });
  expect(selectedTab(root)).toBe("down");
  expect(field(root, "error").value).toBe("timedOut");
});

test("+ Response appends 'Response 2', selects it and saves it as in use in one write", async () => {
  const { api, root, model } = mount(twoResponses());
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-action="add-response"]'));
  await model.idle();
  expect(api.writes).toHaveLength(1);
  expect(lastWrite(api)).toMatchObject({
    op: "maplocal.rule.upsert",
    input: {
      rule: {
        id: "a",
        active: "응답 2",
        responses: { "응답 2": { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } },
      },
    },
  });
  expect(tabNames(root)).toEqual(["down", "ok", "응답 2"]);
  expect(selectedTab(root)).toBe("응답 2");
});

test("clicking + Response again continues with 'Response 3', and the new response stays last even when an echo arrives reordered", async () => {
  const { api, root, model } = mount(twoResponses());
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-action="add-response"]'));
  click($(root, '[data-action="add-response"]'));
  await model.idle();
  expect(selectedTab(root)).toBe("응답 3");
  const sent = lastWrite(api).input.rule as Rule;
  // The engine does not keep the response order (a Swift dictionary)
  const shuffled = { ...sent, responses: Object.fromEntries(Object.entries(sent.responses).reverse()) };
  model.receiveState(engineState({ ...configuration([shuffled]), revision: api.revision }));
  expect(tabNames(root)).toEqual(["down", "ok", "응답 2", "응답 3"]);
  expect(selectedTab(root)).toBe("응답 3");
});

test("deleting the response in use makes the tab just before it the one in use", async () => {
  const { api, root, model } = mount(twoResponses());
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-action="add-response"]'));
  await model.idle();
  removeShown(root);
  await model.idle();
  expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { active: "ok" } } });
  expect(Object.keys((lastWrite(api).input.rule as Rule).responses)).not.toContain("응답 2");
  expect(selectedTab(root)).toBe("ok");
});

test("deleting the first response makes the next tab the one in use", async () => {
  const { api, root, model } = mount(twoResponses());
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-response="down"]'));
  await model.idle();
  removeShown(root);
  await model.idle();
  expect(lastWrite(api)).toMatchObject({ input: { rule: { active: "ok" } } });
  expect(tabNames(root)).toEqual(["ok"]);
  expect(selectedTab(root)).toBe("ok");
});

describe("each response tab deletes itself", () => {
  test("a response the app doesn't get is deleted without becoming the one it gets", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    click(removeButton(root, "down")!);
    await model.idle();
    expect(api.writes.some((w) => w.op === "maplocal.rule.setActive")).toBe(false);
    const sent = lastWrite(api).input.rule as Rule;
    expect(sent.active).toBe("ok");
    expect(Object.keys(sent.responses)).toEqual(["ok"]);
    expect(tabNames(root)).toEqual(["ok"]);
  });

  test("with one response there is nothing to delete", () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    expect(root.querySelector('[data-action="remove-response"]')).toBeNull();
    expect(root.textContent).not.toContain("응답 삭제");
  });

  test("Delete on a focused tab deletes that response", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const down = $(root, '[data-response="down"]');
    down.focus();
    down.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    await model.idle();
    expect(tabNames(root)).toEqual(["ok"]);
    expect((lastWrite(api).input.rule as Rule).active).toBe("ok");
  });

  test("only the shown tab's delete is on the Tab path; the others show on hover or focus, and all keep their room while hidden", () => {
    const { root } = mount(twoResponses());
    click($(root, '[data-rule="a"] .ml-path'));
    expect(removeButton(root, "ok")!.getAttribute("tabindex")).toBe("0");
    expect(removeButton(root, "down")!.getAttribute("tabindex")).toBe("-1");
    expect(removeButton(root, "down")!.getAttribute("aria-label")).toBe("「down」 응답 삭제");
    expect(css).toMatch(/\.ml-tab-remove\s*\{[^}]*visibility:\s*hidden/);
    expect(css).toMatch(/\.ml-tab-wrap:hover \.ml-tab-remove,\s*\.ml-tab-wrap:focus-within \.ml-tab-remove,\s*\.ml-tab-remove\[tabindex="0"\]\s*\{\s*visibility:\s*visible/);
  });

  test("deleting the shown response the app doesn't get shows the one it gets; deleting another keeps the shown one", async () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([{ ...rule("a"), responses: { ok: { status: 200 }, down: { status: 503 }, extra: { status: 404 } } }]),
    );
    const { root, model, view } = mount(api);
    view.openRule("a", undefined, "down");
    expect(selectedTab(root)).toBe("down");
    click(removeButton(root, "extra")!);
    await model.idle();
    expect(selectedTab(root)).toBe("down");
    click(removeButton(root, "down")!);
    await model.idle();
    expect(selectedTab(root)).toBe("ok");
    expect((lastWrite(api).input.rule as Rule).active).toBe("ok");
  });

  test("Backspace deletes too, the last response can't be deleted by key, and focus goes back to the shown tab", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const down = $(root, '[data-response="down"]');
    down.focus();
    const back = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    down.dispatchEvent(back);
    await model.idle();
    expect(back.defaultPrevented).toBe(true);
    expect(tabNames(root)).toEqual(["ok"]);
    expect(document.activeElement).toBe($(root, '[data-response="ok"]'));
    const before = api.writes.length;
    $(root, '[data-response="ok"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    await model.idle();
    expect(api.writes.length).toBe(before);
    expect(tabNames(root)).toEqual(["ok"]);
  });

  test("the tab and × that were on screen when a rename landed act on the renamed response", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const oldTab = $(root, '[data-response="ok"]');
    const oldRemove = removeButton(root, "ok")!;
    const name = field(root, "response-name");
    type(name, "정상");
    name.dispatchEvent(new Event("change", { bubbles: true }));
    click(oldTab);
    await model.idle();
    expect(api.writes.some((w) => w.op === "maplocal.rule.setActive" && w.input.response === "ok")).toBe(false);
    expect(tabNames(root)).toEqual(["down", "정상"]);
    click(oldRemove);
    await model.idle();
    expect(tabNames(root)).toEqual(["down"]);
    expect($(root, '[data-notice="undo"]').textContent).toContain("「정상」 응답을 지웠습니다");
  });

  test("a response named like an object property is deleted for good", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const name = field(root, "response-name");
    type(name, "constructor");
    name.dispatchEvent(new Event("change", { bubbles: true }));
    await model.idle();
    click(removeButton(root, "constructor")!);
    await model.idle();
    model.receiveState(engineState({ ...configuration([lastWrite(api).input.rule as Rule]), revision: api.revision }));
    expect(tabNames(root)).toEqual(["down"]);
  });
});

describe("a response can be renamed", () => {
  const name = (root: HTMLElement) => field(root, "response-name");
  const commit = (el: HTMLInputElement, value: string) => {
    type(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  test("renaming the response in use keeps it in use, in its place, with an edit made just before", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    expect(name(root).value).toBe("ok");
    type(field(root, "status"), "503");
    type(field(root, "body"), '{"edited": true}');
    commit(name(root), " a-first ");
    await model.idle();
    const sent = lastWrite(api).input.rule as Rule;
    expect(sent.active).toBe("a-first");
    expect(Object.keys(sent.responses).sort()).toEqual(["a-first", "down"]);
    expect(sent.responses["a-first"].status).toBe(503);
    expect(sent.responses["a-first"].body).toBe('{"edited": true}');
    expect(tabNames(root)).toEqual(["down", "a-first"]);
    expect(selectedTab(root)).toBe("a-first");
  });

  test("a draft held for the response moves with its new name", async () => {
    const api = twoResponses();
    const { root, model, drafts } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "body"), "{");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(drafts.get("a/ok")).toBeDefined();
    commit(name(root), "정상");
    expect(drafts.get("a/ok")).toBeUndefined();
    expect(drafts.get("a/정상")?.bodyText).toBe("{");
  });

  test("an edit that can't be saved yet (a query condition without a key) stays in the editor across a rename", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    click($(root, '.ml-editor [data-action="add-query"]'));
    type(field(root, "query-value:0"), "x");
    type(field(root, "body"), '{"edited": true}');
    commit(name(root), "정상");
    await model.idle();
    expect(field(root, "body").value).toBe('{"edited": true}');
    expect(field(root, "query-value:0").value).toBe("x");
  });

  test("text being typed in the name survives a save landing meanwhile", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "status"), "503");
    name(root).focus();
    type(name(root), "server do");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(name(root).value).toBe("server do");
  });

  test("nothing is written while typing, only on Return or leaving the field", () => {
    const api = twoResponses();
    const { root } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const before = api.writes.length;
    type(name(root), "정");
    vi.advanceTimersByTime(2_000);
    expect(api.writes.length).toBe(before);
  });

  test("a name in use or an empty one is refused, and the field says why", async () => {
    const api = twoResponses();
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const before = api.writes.length;
    commit(name(root), "down");
    await model.idle();
    expect(api.writes.length).toBe(before);
    expect($(root, "[data-name-problem]").textContent).toBe("같은 이름의 응답이 이미 있습니다");
    expect(name(root).value).toBe("down");
    commit(name(root), "  ");
    expect($(root, "[data-name-problem]").textContent).toBe("이름을 입력하세요");
    expect(api.writes.length).toBe(before);
    expect(tabNames(root)).toEqual(["down", "ok"]);
    commit(name(root), "ok");
    expect(root.querySelector("[data-name-problem]")).toBeNull();
    expect(name(root).value).toBe("ok");
  });
});

describe("Status", () => {
  test("takes a typed code, with no arrows that step it, or one picked from a menu of common codes", async () => {
    const { api, root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const status = field(root, "status");
    expect(status.type).toBe("text");
    expect(status.getAttribute("inputmode")).toBe("numeric");
    const pick = field(root, "status-pick") as unknown as HTMLSelectElement;
    const codes = [...pick.options].map((o) => o.value).filter(Boolean);
    expect(codes).toEqual(expect.arrayContaining(["200", "204", "400", "401", "403", "404", "500", "503"]));
    expect(pick.options[0].textContent).toBe("자주 쓰는 코드");
    pick.value = "404";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect((lastWrite(api).input.rule as Rule).responses.ok.status).toBe(404);
    expect(field(root, "status").value).toBe("404");
    expect((field(root, "status-pick") as unknown as HTMLSelectElement).value).toBe("");
  });

  test("picking a code clears the hint and the menu at once", () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "status"), "5");
    const pick = field(root, "status-pick") as unknown as HTMLSelectElement;
    pick.value = "503";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pick.value).toBe("");
    expect($(root, "[data-status-hint]").textContent).toBe("");
    expect(field(root, "status").value).toBe("503");
  });

  test.each(["999", "2e2", "0x1f4", "50.5", ""])("%j is not saved when the response has no network error", async (typed) => {
    const { api, root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "status"), typed);
    await vi.advanceTimersByTimeAsync(1_000);
    await model.idle();
    expect(api.writes).toHaveLength(0);
    expect($(root, "[data-status-hint]").textContent).toBe("100–599 사이의 코드");
  });

  test("an empty status is saved when the response has a network error", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([{ ...rule("a"), responses: { ok: { status: 200, error: "timedOut" } } }]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "status"), "");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    const ok = (lastWrite(api).input.rule as Rule).responses.ok;
    expect(ok.error).toBe("timedOut");
    expect(ok).not.toHaveProperty("status");
  });

  test("a code being typed and its hint survive a save landing meanwhile", async () => {
    const { root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "body"), '{"a": 1}');
    field(root, "status").focus();
    type(field(root, "status"), "5");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(field(root, "status").value).toBe("5");
    expect($(root, "[data-status-hint]").textContent).toBe("100–599 사이의 코드");
  });

  test("the row stays on one line and fits a narrow editor: the menu's width is capped", () => {
    expect(css).toMatch(/\.ml-status-field\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.ml-status-field select\s*\{[^}]*max-width:/);
  });

  test("a code still being typed is not saved, and the hint beside it says what fits, on the same line", async () => {
    const { api, root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "status"), "5");
    await vi.advanceTimersByTimeAsync(1_000);
    await model.idle();
    expect(api.writes).toHaveLength(0);
    expect($(root, "[data-status-hint]").textContent).toBe("100–599 사이의 코드");
    expect($(root, "[data-status-hint]").closest(".ml-status-field")).not.toBeNull();
    type(field(root, "status"), "503");
    expect($(root, "[data-status-hint]").textContent).toBe("");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect((lastWrite(api).input.rule as Rule).responses.ok.status).toBe(503);
  });
});

test("the main switch says it is Map Local's, set apart from the allowed hosts", () => {
  const { root } = mount();
  expect($(root, ".ml-head-state").textContent).toContain("Map Local 켜짐");
  const api = new FakeAPI();
  api.current = engineState({ ...configuration(), enabled: false });
  expect($(mount(api).root, ".ml-head-state").textContent).toContain("Map Local 꺼짐");
  expect(css).toMatch(/\.ml-host-group\s*\{[^}]*border-left:/);
});

test("the editor tab follows when the response in use changes elsewhere", () => {
  const { root, model } = mount(twoResponses());
  click($(root, '[data-rule="a"] .ml-path'));
  const changed = {
    ...rule("a"),
    active: "down",
    responses: { ok: { status: 200, json: {} }, down: { error: "timedOut" as const } },
  };
  model.receiveState(engineState({ ...configuration([changed]), revision: 1 }));
  expect(selectedTab(root)).toBe("down");
});

test("[Send this response to the app] on the rule open in the editor moves the editor tab to that response too", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("devices", "/a/{id}")]));
  const { root, model, view } = mount(api);
  click($(root, '[data-rule="devices"] .ml-path'));
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  expect(selectedTab(root)).toBe("ok");
  expect(tabNames(root)).toEqual(["ok", "캡처한 응답"]);
  click($(root, '[data-action="activate-captured"]'));
  await model.idle();
  expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.setActive", input: { id: "devices", response: "캡처한 응답" } });
  expect(selectedTab(root)).toBe("캡처한 응답");
});

test("reads and shows responses with the old names (captured-200, response-2) as they are", () => {
  const api = new FakeAPI();
  api.current = engineState(
    configuration([
      {
        ...rule("a"),
        active: "response-2",
        responses: { "captured-200": { status: 200 }, "response-2": { status: 404 } },
      },
    ]),
  );
  const { root } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  expect(tabNames(root)).toEqual(["captured-200", "response-2"]);
  expect(selectedTab(root)).toBe("response-2");
  expect(field(root, "status").value).toBe("404");
});

// MARK: Empty state and save indicator (G)

test("with no rules, the list explains how to make one and offers a way to the traffic tab", () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([]));
  const { root } = mount(api);
  expect($(root, '[data-empty="rules"]').textContent).toBe(
    "아직 규칙이 없습니다 — 트래픽 탭에서 요청을 골라 [이 응답으로 목업]을 누르거나 [+ 규칙]으로 직접 만드세요",
  );
  expect($(root, '[data-action="new-rule"]')).not.toBeNull();
  click($(root, '[data-empty="rules"] [data-action="go-traffic"]'));
  expect($(root, '[data-tab="traffic"]').getAttribute("aria-selected")).toBe("true");
});

test("the empty rules list uses Necto's empty state, its text and button kept in one line", () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([]));
  const { root } = mount(api);
  const empty = $(root, '[data-empty="rules"]');
  expect(empty.classList.contains("necto-empty")).toBe(true);
  expect(empty.querySelector(":scope > p [data-action='go-traffic']")).not.toBeNull();
});

test("has no empty-state hint when there are rules", () => {
  const { root } = mount();
  expect(root.querySelector('[data-empty="rules"]')).toBeNull();
});

const savedShown = (root: ParentNode) => root.querySelector('[data-notice="saved"]')?.textContent === "저장됨";

test("shows 'Saved' once when an edit is saved and clears it shortly after", async () => {
  const { root, model } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "5");
  type(field(root, "status"), "500");
  expect(savedShown(root)).toBe(false);
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(savedShown(root)).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(savedShown(root)).toBe(false);
});

test("does not show 'Saved' while saves continue, and shows it when the last one finishes", async () => {
  const api = new FakeAPI();
  const gates = gateWrites(api);
  const { root } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  type(field(root, "status"), "504");
  gates[0]({ ok: true, revision: 1 });
  await flush();
  expect(savedShown(root)).toBe(false);
  await vi.advanceTimersByTimeAsync(400);
  gates[1]({ ok: true, revision: 2 });
  await flush();
  expect(savedShown(root)).toBe(true);
});

test("does not show 'Saved' when the save is rejected", async () => {
  const api = new FakeAPI();
  api.results = [{ ok: false, reason: "invalid", message: "bad", revision: 0 }];
  const { root, model } = mount(api);
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "path"), "abc");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  expect(savedShown(root)).toBe(false);
});

test("shows 'Saved' for saves made by switching the response tab or by + Response too", async () => {
  const { root, model } = mount(twoResponses());
  click($(root, '[data-rule="a"] .ml-path'));
  click($(root, '[data-response="down"]'));
  await model.idle();
  expect(savedShown(root)).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(savedShown(root)).toBe(false);
  click($(root, '[data-action="add-response"]'));
  await model.idle();
  expect(savedShown(root)).toBe(true);
});

describe("terms: the names alone carry the meaning", () => {
  test("the header's sharing buttons are 'Copy settings' and 'Paste settings', and the paste dialog has the same title", () => {
    const { root } = mount();
    expect($(root, '[data-action="export"]').textContent).toBe("설정 복사");
    expect($(root, '[data-action="import"]').textContent).toBe("설정 붙여넣기");
    click($(root, '[data-action="import"]'));
    expect($(root, ".necto-dialog").textContent).toContain("설정 붙여넣기");
    expect($(root, ".necto-dialog").textContent).not.toContain("붙여넣어 가져오기");
  });

  test("where requests without a rule go is chosen under 'Requests without a rule': the real server, 'Block (status)', or one of the response errors", () => {
    const { root } = mount();
    const select = field(root, "unmatched") as unknown as HTMLSelectElement;
    expect(select.closest("label")!.textContent).toContain("규칙 없는 요청");
    expect(select.closest("label")!.textContent).not.toContain("미매칭");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "실서버로 보내기",
      "차단(421)",
      "인터넷 연결 없음 (-1009)",
      "연결 끊김 (-1005)",
      "시간 초과 (-1001)",
    ]);
  });

  test.each(["notConnectedToInternet", "connectionLost", "timedOut"])(
    "choosing an error for requests without a rule makes them fail with it (%s)",
    async (error) => {
      const { api, root, model } = mount();
      const select = field(root, "unmatched") as unknown as HTMLSelectElement;
      select.value = `fail:${error}`;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await model.idle();
      expect(lastWrite(api).input).toEqual({ baseRevision: expect.any(Number), unmatched: { mode: "fail", error } });
    },
  );

  test.each([
    [{ mode: "fail", error: "timedOut" }, "fail:timedOut"],
    [{ mode: "fail" }, "fail:notConnectedToInternet"],
    [{ mode: "block", status: 421 }, "block"],
  ] as const)("a configuration whose unmatched is %j shows %s chosen", (unmatched, value) => {
    const api = new FakeAPI();
    api.current = engineState({ ...configuration(), unmatched });
    const { root } = mount(api);
    expect((field(root, "unmatched") as unknown as HTMLSelectElement).value).toBe(value);
  });

  test("the auth rule checkbox states its meaning in a sentence and explains in its title what turning it on does", () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const label = field(root, "auth").closest("label")!;
    expect(label.textContent!.trim()).toBe("로그인·토큰을 내주는 응답입니다");
    expect(label.title).toContain("목업 세션");
    expect(label.title).toContain("로그아웃");
  });
});

test("the response editor reads in the order that decides what the app gets: its name, status and error, then the body it edits most, then delay and headers", () => {
  const { root } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  const fields = [...root.querySelectorAll(".ml-response-grid [data-field]")].map((el) => el.getAttribute("data-field"));
  expect(fields).toEqual(["response-name", "status", "status-pick", "error", "body-kind", "body", "delay", "headers"]);
  expect(css).toMatch(/\.ml-grid\.ml-response-grid\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(9em, 3fr\) auto minmax\(4\.5em, 1fr\)/);
});

describe("with Map Local off, the panel says no rule applies and the rules look it", () => {
  const off = () => {
    const api = new FakeAPI();
    api.current = engineState({ ...configuration([rule("a")]), enabled: false });
    return mount(api);
  };

  test("turned on from the notice, the notice stays to say so until the pointer leaves the panel, so nothing below moves under it", async () => {
    const { root, api, model } = off();
    click($(root, '[data-notice="map-local-off"] button'));
    await model.idle();
    model.receiveState({ ...api.current, revision: 2, configuration: { ...api.current.configuration, enabled: true } });
    const notice = $(root, '[data-notice="map-local-off"]');
    expect(notice.firstChild?.textContent).toBe("Map Local이 켜져 규칙이 적용됩니다");
    // An unseen stand-in for the button keeps the notice as tall as before.
    const standIn = notice.querySelector("button")!;
    expect(standIn.style.visibility).toBe("hidden");
    expect(standIn.getAttribute("tabindex")).toBe("-1");
    expect(standIn.getAttribute("aria-hidden")).toBe("true");
    root.dispatchEvent(new MouseEvent("mouseleave"));
    expect(root.querySelector('[data-notice="map-local-off"]')).toBeNull();
  });

  test("in the editor, the rule's own switch looks inactive and says why", () => {
    const { root } = off();
    click($(root, '[data-rule="a"] .ml-path'));
    const sw = field(root, "rule-enabled");
    expect(sw.hasAttribute("data-overridden")).toBe(true);
    expect(sw.title).toBe("Map Local이 꺼져 있어 이 규칙은 적용되지 않습니다");
    // Muted, not gray: a gray switch reads as off, and "turning it on" would turn it off.
    expect(css).toMatch(/\.necto-switch\[data-overridden\]\s*\{[^}]*opacity:\s*0\.\d+/);
    expect(css).not.toMatch(/\.necto-switch\[data-overridden\]\s*\{[^}]*grayscale/);
    const on = mount();
    click($(on.root, '[data-rule="a"] .ml-path'));
    expect(field(on.root, "rule-enabled").hasAttribute("data-overridden")).toBe(false);
    expect(field(on.root, "rule-enabled").title).toBe("");
  });

  test("the 'on' confirmation shows only when turning on worked, goes on a key press, and doesn't come back when Map Local is turned off and on elsewhere", async () => {
    const failed = off();
    failed.api.results = [{ ok: false, reason: "storage", message: "disk", revision: 0 }];
    click($(failed.root, '[data-notice="map-local-off"] button'));
    await failed.model.idle();
    failed.model.receiveState({ ...failed.api.current, revision: 5, configuration: { ...failed.api.current.configuration, enabled: true } });
    expect(failed.root.querySelector('[data-notice="map-local-off"]')).toBeNull();

    const { root, api, model } = off();
    click($(root, '[data-notice="map-local-off"] button'));
    await model.idle();
    const at = (enabled: boolean, revision: number) =>
      model.receiveState({ ...api.current, revision, configuration: { ...api.current.configuration, enabled } });
    at(true, 2);
    expect($(root, '[data-notice="map-local-off"]').firstChild?.textContent).toBe("Map Local이 켜져 규칙이 적용됩니다");
    at(false, 3);
    at(true, 4);
    expect(root.querySelector('[data-notice="map-local-off"]')).toBeNull();

    const keyed = off();
    click($(keyed.root, '[data-notice="map-local-off"] button'));
    await keyed.model.idle();
    keyed.model.receiveState({ ...keyed.api.current, revision: 2, configuration: { ...keyed.api.current.configuration, enabled: true } });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(keyed.root.querySelector('[data-notice="map-local-off"]')).toBeNull();
  });

  test("a notice under the tabs says so, with a way to turn it on that leaves focus on the switch", async () => {
    const { root, api, model } = off();
    const notice = $(root, '[data-notice="map-local-off"]');
    expect(notice.textContent).toContain("Map Local이 꺼져 있어 어떤 규칙도 적용되지 않습니다");
    const turnOn = notice.querySelector("button")!;
    turnOn.focus();
    click(turnOn);
    await model.idle();
    expect(lastWrite(api).input).toMatchObject({ enabled: true });
    model.receiveState({ ...api.current, revision: 2, configuration: { ...api.current.configuration, enabled: true } });
    expect(document.activeElement).toBe(field(root, "map-local-enabled"));
  });

  test("the rule list is dimmed, and the notice goes once it is on", () => {
    const { root, model, api } = off();
    expect($(root, ".ml-rule-list").classList.contains("ml-rules-off")).toBe(true);
    expect(css).toMatch(/\.ml-rules-off \.ml-rule:not\(:focus-visible\)\s*\{[^}]*opacity:\s*0\.\d+/);
    expect($(root, ".ml-rule-list .ml-rule")).not.toBeNull();
    model.receiveState({ ...api.current, revision: 2, configuration: { ...api.current.configuration, enabled: true } });
    expect(root.querySelector('[data-notice="map-local-off"]')).toBeNull();
    expect($(root, ".ml-rule-list").classList.contains("ml-rules-off")).toBe(false);
  });
});

describe("the editor says which rule answers a request another rule also matches", () => {
  const withQuery = (id: string, query?: Record<string, string>): Rule => ({ ...rule(id, "/orders"), match: { method: "GET", path: "/orders", ...(query && { query }) } });
  const precedence = (root: HTMLElement) => $(root, ".ml-editor [data-precedence]");

  test("the broad rule names the narrower one that answers first, and the narrower one says it answers", () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([withQuery("any"), withQuery("page2", { page: "2" })]));
    const { root } = mount(api);
    click($(root, '[data-rule="any"] .ml-path'));
    expect(precedence(root).textContent).toBe("GET /orders ?page=2 규칙에도 맞는 요청에는 그 규칙이 응답합니다. 쿼리 조건이 더 많습니다");
    click($(root, '[data-rule="page2"] .ml-path'));
    expect(precedence(root).textContent).toBe("GET /orders 규칙에도 맞는 요청에는 이 규칙이 응답합니다. 쿼리 조건이 더 많습니다");
  });

  test("on a tie it says the rule higher in the list answers", () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([withQuery("page2", { page: "2" }), withQuery("sorted", { sort: "new" })]));
    const { root } = mount(api);
    click($(root, '[data-rule="sorted"] .ml-path'));
    expect(precedence(root).textContent).toBe("GET /orders ?page=2 규칙에도 맞는 요청에는 그 규칙이 응답합니다. 목록에서 더 위에 있습니다");
  });

  test("a rule no other rule overlaps says nothing", () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    expect(precedence(root).textContent).toBe("");
  });

  test("the line follows a query condition as it is typed, without taking the field's focus", () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([withQuery("any"), withQuery("page2", { page: "2" })]));
    const { root } = mount(api);
    click($(root, '[data-rule="any"] .ml-path'));
    click($(root, '.ml-editor [data-action="add-query"]'));
    type(field(root, "query-key:0"), "page");
    const value = field(root, "query-value:0");
    value.focus();
    type(value, "3");
    expect(precedence(root).textContent).toBe("");
    expect(document.activeElement).toBe(value);
    type(value, "2");
    expect(precedence(root).textContent).toBe("GET /orders ?page=2 규칙에도 맞는 요청에는 이 규칙이 응답합니다. 목록에서 더 위에 있습니다");
  });

  test("rules this one gives way to come first, so the cap never hides them", () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([withQuery("any"), withQuery("s", { sort: "new" }), withQuery("p", { page: "2" }), withQuery("pf", { page: "2", filter: "open" })]),
    );
    const { root } = mount(api);
    click($(root, '[data-rule="p"] .ml-path'));
    const lines = [...precedence(root).children].map((el) => el.textContent ?? "");
    expect(lines[0]).toBe("GET /orders ?sort=new 규칙에도 맞는 요청에는 그 규칙이 응답합니다. 목록에서 더 위에 있습니다");
    expect(lines[1]).toContain("그 규칙이 응답합니다. 쿼리 조건이 더 많습니다");
    expect(lines[2]).toBe("겹치는 규칙 1개 더");
  });

  test("a long rule name wraps instead of widening the editor, and the full rule with its host shows on hover", () => {
    const api = new FakeAPI();
    const hosted = { ...withQuery("h", { page: "2" }), match: { method: "GET", host: "api.invalid", path: "/orders", query: { page: "2" } } };
    api.current = engineState(configuration([withQuery("any"), hosted]));
    const { root } = mount(api);
    click($(root, '[data-rule="any"] .ml-path'));
    expect((precedence(root).firstElementChild as HTMLElement).title).toContain("api.invalid/orders");
    expect(css).toMatch(/\.ml-precedence\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  test("past two overlapping rules it counts the rest instead of listing them", () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([withQuery("any"), withQuery("p", { page: "2" }), withQuery("s", { sort: "new" }), withQuery("f", { filter: "open" })]),
    );
    const { root } = mount(api);
    click($(root, '[data-rule="any"] .ml-path'));
    const lines = [...precedence(root).children].map((el) => el.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("겹치는 규칙 1개 더");
  });
});

test("the words a first-time user stumbled on say what they mean", () => {
  const { root } = mount();
  const allowed = [...root.querySelectorAll(".ml-head-state .necto-caption")].find((el) => el.textContent === "허용 호스트") as HTMLElement;
  expect(allowed.title).toBe("이 호스트로 가는 요청만 목업하거나 막을 수 있습니다. 나머지는 항상 실서버로 갑니다");
  expect(($(root, '[data-rule="a"] input[type=checkbox]') as HTMLElement).title).toBe("규칙 켜고 끄기");
  click($(root, '[data-rule="a"] .ml-path'));
  expect($(root, ".ml-response-grid").textContent).toContain("네트워크 오류");
});

test("the header keeps two rows whatever it holds, so nothing below moves: on and allowed hosts first, requests without a rule and quiet sharing buttons second", () => {
  const { root } = mount();
  const state = $(root, ".ml-head > .ml-head-state");
  const settings = $(root, ".ml-head > .ml-head-settings");
  const share = $(settings, ".ml-head-share");
  expect(state.classList.contains("necto-toolbar-group")).toBe(true);
  expect(share.classList.contains("necto-toolbar-group")).toBe(true);
  expect(state.querySelector('button[role="switch"]')).not.toBeNull();
  expect(state.textContent).toContain("허용 호스트");
  expect(state.querySelector('[data-field="unmatched"]')).toBeNull();
  expect(settings.querySelector('[data-field="unmatched"]')).not.toBeNull();
  expect([...share.querySelectorAll("button")].map((b) => b.getAttribute("data-action"))).toEqual(["import", "export"]);
  for (const b of share.querySelectorAll("button")) expect(b.classList.contains("necto-button-quiet")).toBe(true);
  expect(css).toMatch(/\.ml-head\s*\{[^}]*display:\s*grid/);
  expect(css).toMatch(/\.ml-head-share\s*\{[^}]*margin-left:\s*auto/);
});

test("the hint beside an empty host list shrinks with an ellipsis instead of wrapping the first row", () => {
  const api = new FakeAPI();
  api.current = engineState({ ...configuration(), allowedHosts: [] });
  const { root } = mount(api);
  const hint = $(root, ".ml-head-state .ml-host-hint");
  expect(hint.textContent).toBe("호스트를 입력하거나 트래픽 탭에서 골라 추가하세요");
  expect(hint.title).toBe(hint.textContent);
  expect(css).toMatch(/\.ml-host-hint\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
  expect(css).toMatch(/\.ml-head-settings\s*\{[^}]*display:\s*flex/);
  expect(css).toMatch(/\.ml-head\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("the capture notice floats on a layer so it does not push content, and 'Saved' sits beside the editor title — so neither covers the editor text (U2)", async () => {
  const api = new FakeAPI();
  api.current = engineState(configuration([rule("devices", "/a/{id}")]));
  const { root, model, view } = mount(api);
  click($(root, '[data-tab="traffic"]'));
  view.captureInto(trafficEntry(), networkDetail(), "/a/3");
  await model.idle();
  const capture = $(root, '[data-notice="capture"]');
  expect(capture.closest(".ml-toasts")).not.toBeNull();
  expect(capture.closest(".ml-root > :first-child")).toBeNull();
  click($(root, '[data-tab="rules"]'));
  click($(root, '[data-rule="devices"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  await model.idle();
  const saved = $(root, '[data-notice="saved"]');
  expect(saved.textContent).toBe("저장됨");
  expect(saved.closest(".ml-editor-head")).not.toBeNull();
  expect(saved.getAttribute("role")).toBe("status");
  expect($(root, ".ml-toasts").textContent).not.toContain("저장됨");
  expect($(root, ".ml-toasts").getAttribute("role")).toBe("status");
  expect(css).toMatch(/\.ml-toasts\s*\{[^}]*position:\s*fixed/);
});

test("'Allowed hosts only' does not turn itself on when a capture adds the first allowed host", async () => {
  const api = new FakeAPI();
  api.current = engineState({ ...configuration(), allowedHosts: [] });
  const { root, model, view } = mount(api);
  click($(root, '[data-tab="traffic"]'));
  view.captureInto(
    trafficEntry({ host: "dev.invalid", path: "/x", url: "https://dev.invalid/x" }),
    networkDetail(),
    "/x",
  );
  await model.idle();
  api.current = engineState({ ...configuration(), allowedHosts: ["dev.invalid"] });
  model.receiveState(api.current);
  const box = field(root, "allowed-only");
  expect(box.disabled).toBe(false);
  expect(box.checked).toBe(false);
});

test("the response editor fills the remaining height, and the body gets more of it than the headers", () => {
  const { root } = mount();
  click($(root, '[data-rule="a"] .ml-path'));
  const grid = $(root, ".ml-editor .ml-response-grid");
  expect(grid.querySelector('[data-field="headers"]')).not.toBeNull();
  expect(grid.querySelector('.ml-body-field [data-field="body"]')).not.toBeNull();
  expect(css).toMatch(/\.ml-editor\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  const rows = css.match(/\.ml-response-grid\s*\{([^}]*)\}/);
  expect(rows).not.toBeNull();
  expect(rows![1]).toMatch(/flex:\s*1/);
  const fr = [...rows![1].matchAll(/minmax\([^,]+,\s*(\d+)fr\)/g)].map((m) => Number(m[1]));
  expect(fr).toHaveLength(2);
  // The body's row comes first now, above delay and headers.
  expect(fr[0]).toBeGreaterThan(fr[1]);
  expect(css).toMatch(/\.ml-response-grid textarea\s*\{[^}]*height:\s*100%/);
  expect(css).not.toMatch(/\.ml-body\s*\{[^}]*height:\s*150px/);
});

/**
 * jsdom has no widths — measures as if the split were drawn total px wide and its first pane (the
 * list) list px wide.
 */
function geometry(total = 800, list = 300) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = this.classList.contains("ml-split")
      ? total
      : this.parentElement?.classList.contains("ml-split") && !this.previousElementSibling
        ? list
        : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
  };
  return () => { HTMLElement.prototype.getBoundingClientRect = original; };
}

test("the rules tab uses the same split handle, and the dragged width survives redraws as a ratio and is remembered per tab", async () => {
  const restore = geometry(800);
  try {
    const { root, deps, view } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const split = $(root, ".ml-main");
    expect(split.classList.contains("ml-split")).toBe(true);
    const handle = $(root, ".ml-main > .ml-split-handle");
    expect(handle.previousElementSibling?.classList.contains("ml-rules")).toBe(true);
    expect(handle.nextElementSibling?.classList.contains("ml-editor")).toBe(true);
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 300, button: 0 }));
    view.render(); // A redraw mid-drag (such as the saved notice) does not lose the grip
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 400, buttons: 1 }));
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 400 }));
    expect(deps.prefs.data.get("split.rules")).toBe("0.5");
    expect(deps.prefs.data.get("split.traffic")).toBeUndefined();
    view.render();
    expect($(root, ".ml-main").style.getPropertyValue("--ml-list-size")).toBe("50%");
  } finally {
    restore();
  }
});

test("moving without a button after pressing the handle with an inverted tap (pointerup first) is not a drag — the border does not follow the mouse", () => {
  const restore = geometry(800);
  try {
    const { root, deps } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const handle = $(root, ".ml-main > .ml-split-handle");
    const before = $(root, ".ml-main").style.getPropertyValue("--ml-list-size");
    handle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 300, button: 0 }));
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 300, button: 0, buttons: 1 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 480, buttons: 0 }));
    expect(handle.dataset.dragging).toBeUndefined();
    expect($(root, ".ml-main").style.getPropertyValue("--ml-list-size")).toBe(before);
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 400, buttons: 0 }));
    expect($(root, ".ml-main").style.getPropertyValue("--ml-list-size")).toBe(before);
    expect(deps.prefs.data.get("split.rules")).toBeUndefined();
  } finally {
    restore();
  }
});

describe("T6: the rules tab also opens the editor on selection (F2)", () => {
  test("without a selected rule, the list is full width and the editor and handle are hidden; selecting opens an editor with ×, and closing it with × moves focus to the list", () => {
    const { root } = mount();
    const closed = () => {
      expect($(root, ".ml-main").dataset.detail).toBe("closed");
      expect($(root, ".ml-main > .ml-editor").hidden).toBe(true);
      expect($(root, ".ml-main > .ml-split-handle").hidden).toBe(true);
    };
    closed();
    expect(root.textContent).not.toContain("규칙을 고르거나");
    click($(root, '[data-rule="a"] .ml-path'));
    expect($(root, ".ml-main").dataset.detail).toBe("open");
    expect($(root, ".ml-main > .ml-editor").hidden).toBe(false);
    const close = $(root, '.ml-editor [data-action="close-editor"]');
    expect(close.getAttribute("aria-label")).toBeTruthy();
    close.focus();
    click(close);
    closed();
    expect(document.activeElement).toBe($(root, ".ml-rule-list"));
  });
});

test("the response cell's stretch overrides .ml-grid's centre alignment — if the later .ml-grid won, the body cell would not grow", () => {
  expect(css).toMatch(/\.ml-grid\.ml-response-grid\s*\{[^}]*align-items:\s*stretch/);
});

describe("keyboard: the rule list, tabs and redraws (principles 2 and 9)", () => {
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  const rulesList = (root: ParentNode) => $(root, '.ml-rules [role="listbox"]');
  const three = () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("a"), rule("b"), rule("c")]));
    return mount(api);
  };

  test("the rule list is a listbox, '+ Rule' sits outside it, and the row's on checkbox is not a Tab stop", () => {
    const { root } = three();
    const list = rulesList(root);
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(list.getAttribute("aria-label")).toBeTruthy();
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(list.querySelector('[data-action="new-rule"]')).toBeNull();
    const check = $(list, '[data-rule="a"] input[type=checkbox]');
    expect(check.getAttribute("tabindex")).toBe("-1");
    expect(check.getAttribute("aria-label")).toBeTruthy();
  });

  test("selecting rules with ↓↑, Home and End makes the editor follow while focus stays in the list", () => {
    const { root } = three();
    rulesList(root).focus();
    key(rulesList(root), "ArrowDown");
    expect($(root, '[data-rule="a"]').getAttribute("aria-selected")).toBe("true");
    expect(field(root, "path").value).toBe("/a");
    key(rulesList(root), "End");
    expect($(root, '[data-rule="c"]').getAttribute("aria-selected")).toBe("true");
    expect(field(root, "path").value).toBe("/c");
    key(rulesList(root), "ArrowUp");
    expect($(root, '[data-rule="b"]').getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(rulesList(root));
    expect(rulesList(root).getAttribute("aria-activedescendant")).toBe($(root, '[data-rule="b"]').id);
  });

  test("Space toggles the selected rule", async () => {
    const { root, api, model } = three();
    rulesList(root).focus();
    key(rulesList(root), "ArrowDown");
    key(rulesList(root), " ");
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { id: "a", enabled: false } } });
  });

  test("scrolls a rule selected by key into view — but not when a new state redraws", () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const { root, model, api } = three();
      rulesList(root).focus();
      key(rulesList(root), "ArrowDown");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.contexts[0]).toBe($(root, '[data-rule="a"]'));
      model.receiveState(api.current);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("keeps focus and selection in the traffic list when the whole panel redraws (state received)", () => {
    const store = new TrafficStore(() => view.refreshTraffic());
    document.body.innerHTML = '<div id="app"></div>';
    const api = new FakeAPI();
    let view!: View;
    const model = new PanelModel(api, () => view.render());
    view = new View(document.getElementById("app")!, model, {
      api,
      drafts: memoryDrafts(),
      copy: async () => true,
      copyField: () => true,
      prefs: noPrefs,
      traffic: { store, order: new OrderDetector() },
    });
    view.connection = "connected";
    model.receiveState(api.current);
    const root = document.getElementById("app")!;
    click($(root, '[data-tab="traffic"]'));
    store.ingestNetwork([
      {
        id: "1",
        method: "GET",
        url: "https://maplocal.invalid/a/1",
        host: "maplocal.invalid",
        startedAtMilliseconds: 1,
        state: "completed",
        statusCode: 200,
      },
      {
        id: "2",
        method: "GET",
        url: "https://maplocal.invalid/b",
        host: "maplocal.invalid",
        startedAtMilliseconds: 2,
        state: "completed",
        statusCode: 200,
      },
    ]);
    const list = () => $(root, '.ml-traffic-list[role="listbox"]');
    list().focus();
    key(list(), "ArrowDown");
    key(list(), "ArrowDown");
    const chosen = list().getAttribute("aria-activedescendant");
    model.receiveState({ ...api.current, revision: 5 });
    expect(document.activeElement).toBe(list());
    expect(list().getAttribute("aria-activedescendant")).toBe(chosen);
    expect(document.getElementById(chosen!)!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("keyboard: Return and Esc on rules", () => {
  const key = (el: Element | Document, k: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };
  const rulesList = (root: ParentNode) => $(root, '.ml-rules [role="listbox"]');
  const picked = () => {
    const m = mount();
    rulesList(m.root).focus();
    key(rulesList(m.root), "ArrowDown");
    return m;
  };

  test("Return in the list moves focus to the editor's path field — on the method picker, typed letters would change the method by typeahead (K3)", () => {
    const { root } = picked();
    key(rulesList(root), "Enter");
    expect(document.activeElement).toBe(field(root, "path"));
  });

  test("Esc in the editor does not clear the input (autosave would write that) but clears the rule selection and returns focus to the list", async () => {
    const { root, api, model } = picked();
    field(root, "path").focus();
    type(field(root, "path"), "/changed");
    key(document.activeElement!, "Escape");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(lastWrite(api).input).toMatchObject({ rule: { id: "a", match: { path: "/changed" } } });
    expect(root.querySelector('[data-rule][aria-selected="true"]')).toBeNull();
    expect(root.querySelector('[data-field="path"]')).toBeNull();
    expect(document.activeElement).toBe(rulesList(root));
  });

  test("Esc in the list clears the selection and focus stays in the list", () => {
    const { root } = picked();
    key(rulesList(root), "Escape");
    expect(root.querySelector('[data-rule][aria-selected="true"]')).toBeNull();
    expect(document.activeElement).toBe(rulesList(root));
  });

  test("with a dialog open, Esc only closes the dialog and keeps the rule selection", () => {
    const { root } = picked();
    click($(root, '[data-action="import"]'));
    key($(root, '[data-dialog="cancel"]'), "Escape");
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect($(root, '[data-rule="a"]').getAttribute("aria-selected")).toBe("true");
    click($(root, '[data-action="import"]'));
    key(document, "Escape");
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect($(root, '[data-rule="a"]').getAttribute("aria-selected")).toBe("true");
  });

  test("Esc on a header control (requests without a rule) only clears the selection and leaves focus in place", () => {
    const { root } = picked();
    field(root, "unmatched").focus();
    key(document.activeElement!, "Escape");
    expect(root.querySelector('[data-rule][aria-selected="true"]')).toBeNull();
    expect(document.activeElement).toBe(field(root, "unmatched"));
  });
});

test("the rules tab's handle also resizes with ←→ and remembers the width for the rules tab", () => {
  const restore = geometry(800, 300);
  try {
    const { root, deps } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const handle = $(root, ".ml-main > .ml-split-handle");
    expect(handle.getAttribute("role")).toBe("separator");
    const press = (k: string) =>
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    press("ArrowRight"); // With no remembered width, it starts from the drawn list width (300)
    press("ArrowRight");
    expect(deps.prefs.data.get("split.rules")).toBe("0.435");
    expect($(root, ".ml-main").style.getPropertyValue("--ml-list-size")).toBe("43.5%");
    press("ArrowLeft");
    expect(deps.prefs.data.get("split.rules")).toBe("0.405");
    expect(deps.prefs.data.get("split.traffic")).toBeUndefined();
  } finally {
    restore();
  }
});

describe("ARIA matches the screen (principle 9)", () => {
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const tabbable = (root: ParentNode) =>
    (
      [...root.querySelectorAll("button, input, select, textarea, [tabindex]")] as HTMLElement[]
    ).filter(
      (el) =>
        !(el as HTMLButtonElement).disabled &&
        el.getAttribute("tabindex") !== "-1" &&
        !el.closest("[hidden]"),
    );

  test("the rules and traffic tabs form one tablist, only the selected tab is a Tab stop, and ←→ moves between them", () => {
    const { root, deps } = mount();
    const tab = (id: string) => $(root, `[role="tablist"] [data-tab="${id}"]`);
    expect(tab("rules").getAttribute("aria-selected")).toBe("true");
    expect(tab("rules").getAttribute("tabindex")).toBe("0");
    expect(tab("traffic").getAttribute("tabindex")).toBe("-1");
    tab("rules").focus();
    key(tab("rules"), "ArrowRight");
    expect(tab("traffic").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("traffic"));
    expect(deps.prefs.data.get("panel.tab")).toBe("traffic");
    key(tab("traffic"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("rules"));
  });

  test("response tabs: the tablist holds only tabs ('+ Response' is outside), only the selected tab is a Tab stop, and ←→ moves focus only (the response in use changes on press)", () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([{ ...rule("a"), responses: { ok: { status: 200 }, err: { status: 500 } } }]),
    );
    const { root } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const list = $(root, '.ml-response-tabs [role="tablist"]');
    expect(list.querySelector('[data-action="add-response"]')).toBeNull();
    expect($(root, '.ml-response-tabs [data-action="add-response"]')).not.toBeNull();
    const tabs = [...list.querySelectorAll('[role="tab"]')] as HTMLElement[];
    const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true")!;
    const other = tabs.find((t) => t !== selected)!;
    expect(selected.getAttribute("tabindex")).toBe("0");
    expect(other.getAttribute("tabindex")).toBe("-1");
    selected.focus();
    key(selected, tabs.indexOf(other) > tabs.indexOf(selected) ? "ArrowRight" : "ArrowLeft");
    expect(document.activeElement).toBe(other);
    expect(other.getAttribute("aria-selected")).toBe("false");
  });

  test("Tab order: header → tabs → (tools) → list → handle → detail, with no positive tabindex", async () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const order = tabbable(root);
    const at = (el: Element) => order.indexOf(el as HTMLElement);
    expect(order.every((el) => Number(el.getAttribute("tabindex") ?? 0) <= 0)).toBe(true);
    const head = at($(root, 'button[role="switch"]'));
    const tabs = at($(root, '[data-tab="rules"]'));
    const list = at($(root, '.ml-rule-list'));
    const handle = at($(root, ".ml-split-handle"));
    const editor = at(field(root, "method"));
    expect([head, tabs, list, handle, editor].every((i) => i >= 0)).toBe(true);
    expect(head < tabs && tabs < list && list < handle && handle < editor).toBe(true);
    click($(root, '[data-tab="traffic"]'));
    const t = tabbable(root);
    const ti = (sel: string) => t.indexOf($(root, sel));
    expect(ti('[data-tab="traffic"]') < ti('[data-field="traffic-search"]')).toBe(true);
    expect(ti('[data-field="traffic-search"]') < ti(".ml-traffic-list")).toBe(true);
    // With no selected request the detail is closed, so the handle is not a Tab stop either (F2)
    expect(ti(".ml-split-handle")).toBe(-1);
  });

  test("icon-only buttons have a name (aria-label)", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration());
    const { root, view } = mount(api);
    expect($(root, ".ml-head .ml-chip button").getAttribute("aria-label")).toBe("maplocal.invalid 허용 호스트에서 빼기");
    click($(root, '[data-tab="traffic"]'));
    expect($(root, '[data-action="pause"]').getAttribute("aria-label")).toBe("일시정지");
    click($(root, '[data-action="pause"]'));
    expect($(root, '.ml-traffic-toolbar [data-action="resume"]').getAttribute("aria-label")).toBe("이어 보기");
    void view;
  });
});

describe("notices speak the user's language — the method and path instead of internal ids (K2)", () => {
  test("creating a rule says 'Created a mock for GET /new — it applies from the next request' and shows no id", async () => {
    const { root, model, view } = mount();
    view.captureInto(trafficEntry({ path: "/new", url: "https://maplocal.invalid/new" }), networkDetail(), "/new");
    await model.idle();
    const notice = $(root, '[data-notice="capture"]').textContent!;
    expect(notice).toContain("GET /new 목업을 만들었습니다 — 다음 요청부터 적용됩니다");
    expect(notice).not.toContain("get-new");
  });

  test("adding to an existing rule says 'Added a response to the GET /a/{id} rule' and shows no id", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("devices", "/a/{id}")]));
    const { root, model, view } = mount(api);
    view.captureInto(trafficEntry(), networkDetail(), "/a/3");
    await model.idle();
    const notice = $(root, '[data-notice="capture"]').textContent!;
    expect(notice).toContain("GET /a/{id} 규칙에 응답을 추가했습니다");
    expect(notice).not.toContain("devices");
  });

  test("an empty-response rule is also named by method and path", async () => {
    const { root, store, model, api } = mountTraffic();
    store.ingestNetwork([summary("1", "/gone")]);
    await emptyRuleFrom(root, "1", model, api);
    const notice = $(root, '[data-notice="capture"]').textContent!;
    expect(notice).toContain("GET /gone 목업을 만들었습니다(빈 200 응답) — 다음 요청부터 적용됩니다");
    expect(notice).not.toContain("get-gone");
  });
});

describe("a newly created or opened rule shows selected (K3)", () => {
  const many = () => {
    const api = new FakeAPI();
    api.current = engineState(configuration(Array.from({ length: 30 }, (_, i) => rule(`r${i}`))));
    return api;
  };
  const spyScroll = () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    return { spy, restore: () => { Element.prototype.scrollIntoView = original; } };
  };

  test("+ Rule appears in the list selected before the echo, and scrolls into view", () => {
    const { spy, restore } = spyScroll();
    try {
      const { root } = mount(many());
      click($(root, '[data-action="new-rule"]'));
      const row = $(root, '[data-rule="get"]');
      expect(row).not.toBeNull();
      expect(row.getAttribute("aria-selected")).toBe("true");
      expect(spy.mock.contexts.at(-1)).toBe(row);
    } finally {
      restore();
    }
  });

  test("a rule made in traffic and opened with [Open rule] is selected before the echo and scrolls into view", async () => {
    const { spy, restore } = spyScroll();
    try {
      const { root, model, view } = mount(many());
      click($(root, '[data-tab="traffic"]'));
      view.captureInto(trafficEntry({ path: "/new", url: "https://maplocal.invalid/new" }), networkDetail(), "/new");
      await model.idle();
      click($(root, '[data-action="open-captured"]'));
      const row = $(root, '[data-rule="get-new"]');
      expect(row).not.toBeNull();
      expect(row.getAttribute("aria-selected")).toBe("true");
      expect(spy.mock.contexts.at(-1)).toBe(row);
    } finally {
      restore();
    }
  });

  test("opening the rules tab after making a rule in traffic selects that rule (when none was selected)", async () => {
    const { root, model, view } = mount(many());
    click($(root, '[data-tab="traffic"]'));
    view.captureInto(trafficEntry({ path: "/new", url: "https://maplocal.invalid/new" }), networkDetail(), "/new");
    await model.idle();
    click($(root, '[data-tab="rules"]'));
    expect($(root, '[data-rule="get-new"]').getAttribute("aria-selected")).toBe("true");
    expect(field(root, "path").value).toBe("/new");
  });

  test("making a rule in traffic does not take over an existing rule selection", async () => {
    const { root, model, view } = mount(many());
    click($(root, '[data-rule="r3"] .ml-path'));
    click($(root, '[data-tab="traffic"]'));
    view.captureInto(trafficEntry({ path: "/new", url: "https://maplocal.invalid/new" }), networkDetail(), "/new");
    await model.idle();
    click($(root, '[data-tab="rules"]'));
    expect($(root, '[data-rule="r3"]').getAttribute("aria-selected")).toBe("true");
  });
});

describe("the response tab order is the same after reopening (F3, principle 7)", () => {
  const withResponses = (names: string[]) => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([
        {
          ...rule("a"),
          active: names[0],
          responses: Object.fromEntries(names.map((n) => [n, { status: 200 }])),
        },
      ]),
    );
    return api;
  };

  test("remembers the order of responses appended with + Response, so it holds after the panel reopens and the engine sends another order", async () => {
    const first = mount(withResponses(["ok", "캡처한 응답"]));
    click($(first.root, '[data-rule="a"] .ml-path'));
    click($(first.root, '[data-action="add-response"]'));
    await first.model.idle();
    expect(tabNames(first.root)).toEqual(["ok", "캡처한 응답", "응답 2"]);
    const second = mount(withResponses(["응답 2", "캡처한 응답", "ok"]));
    for (const [k, v] of first.deps.prefs.data) second.deps.prefs.data.set(k, v);
    click($(second.root, '[data-rule="a"] .ml-path'));
    expect(tabNames(second.root)).toEqual(["ok", "캡처한 응답", "응답 2"]);
  });

  test("without a remembered order, sorts by name whatever order the engine sends (deterministic)", () => {
    const a = mount(withResponses(["캡처한 응답", "ok", "응답 2"]));
    click($(a.root, '[data-rule="a"] .ml-path'));
    const b = mount(withResponses(["응답 2", "ok", "캡처한 응답"]));
    click($(b.root, '[data-rule="a"] .ml-path'));
    expect(tabNames(a.root)).toEqual(tabNames(b.root));
  });
});

describe("pressing ⌘↩ twice does not add the same response twice (K1)", () => {
  const cmdEnter = () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  const upserts = (api: FakeAPI) => api.writes.filter((w) => w.op === "maplocal.rule.upsert");

  test("mock with this response → the detail turns to 'Mocking', and ⌘↩ again opens the rule", async () => {
    const api = new FakeAPI();
    api.detailFor = (id) => ({
      ...summary(id, "/new"),
      requestHeaders: {},
      responseHeaders: { "Content-Type": "application/json" },
      responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
    });
    const { root, store, model } = mountTraffic(api);
    store.ingestNetwork([summary("1", "/new")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    cmdEnter();
    await model.idle();
    expect(upserts(api)).toHaveLength(1);
    expect($(root, ".ml-capture").textContent).toContain("목업 중 · 다음 요청부터 적용됩니다");
    cmdEnter();
    await model.idle();
    expect(upserts(api)).toHaveLength(1);
    expect($(root, '[data-tab="rules"]').getAttribute("aria-selected")).toBe("true");
    expect($(root, '[data-rule="get-new"]').getAttribute("aria-selected")).toBe("true");
  });

  test("mock with an empty response does not create another rule (get-x-2) on the second ⌘↩", async () => {
    const { root, store, model, api } = mountTraffic();
    store.ingestNetwork([summary("1", "/gone")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    cmdEnter();
    await model.idle();
    cmdEnter();
    await model.idle();
    expect(upserts(api).map((w) => (w.input.rule as Rule).id)).toEqual(["get-gone"]);
  });

  test("⌘↩ in the '+ Host' field is the primary action too — the typed host is not added and stays in the field", async () => {
    const { root, store, model, api } = mountTraffic();
    store.ingestNetwork([summary("1", "/host-key")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    const host = field(root, "add-host");
    host.focus();
    type(host, "api.example.com");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    await model.idle();
    expect(upserts(api).map((w) => (w.input.rule as Rule).id)).toEqual(["get-host-key"]);
    expect(api.writes.some((w) => w.op !== "maplocal.rule.upsert")).toBe(false);
    expect(field(root, "add-host").value).toBe("api.example.com");
  });
});

describe("deleting does not ask, it offers undo (principle 4)", () => {
  const b: Rule = {
    id: "b",
    enabled: false,
    tags: ["beta"],
    match: { method: "POST", host: "maplocal.invalid", path: "/b/{id}" },
    active: "down",
    responses: { ok: { status: 200, json: { n: 1 } }, down: { status: 503, delayMs: 300 } },
  };
  const three = (rules: Rule[] = [rule("a"), b, rule("c")]) => {
    const api = new FakeAPI();
    api.current = engineState(configuration(rules));
    return mount(api);
  };
  /** Receives the engine echo after the delete (a configuration changed elsewhere in between) */
  const echo = (m: ReturnType<typeof mount>, rules: Rule[]) =>
    m.model.receiveState(engineState({ ...configuration(rules), revision: m.api.revision }));
  const undo = async (m: ReturnType<typeof mount>) => {
    click($(m.root, '[data-action="undo"]'));
    await m.model.idle();
  };

  test("undo restores the same id, responses, response in use, on state and tags at the same place in the list, and selects it again", async () => {
    const m = three();
    click($(m.root, '[data-rule="b"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    echo(m, [rule("a"), rule("c")]);
    const before = m.api.writes.length;
    await undo(m);
    const sent = m.api.writes.slice(before);
    expect(sent[0]).toEqual({ op: "maplocal.rule.upsert", input: { rule: b, baseRevision: expect.any(Number) } });
    expect(sent[1]).toMatchObject({ op: "maplocal.configuration.patch", input: { order: ["a", "b", "c"] } });
    expect(sent).toHaveLength(2);
    expect($(m.root, '[data-rule="b"]').getAttribute("aria-selected")).toBe("true");
    expect(m.root.querySelector('[data-notice="undo"]')).toBeNull();
  });

  test("when the configuration changed in between (another rule appeared), restores into the current list after the rule that originally preceded it", async () => {
    const m = three();
    click($(m.root, '[data-rule="b"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    echo(m, [rule("c"), rule("a"), rule("d")]);
    await undo(m);
    expect(lastWrite(m.api)).toMatchObject({
      op: "maplocal.configuration.patch",
      input: { order: ["c", "a", "b", "d"] },
    });
  });

  test("restoring the last rule sends no reorder, because the engine appends at the end", async () => {
    const m = three();
    click($(m.root, '[data-rule="c"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    echo(m, [rule("a"), b]);
    const before = m.api.writes.length;
    await undo(m);
    expect(m.api.writes.slice(before).map((w) => w.op)).toEqual(["maplocal.rule.upsert"]);
  });

  test("restores even when undone before the delete's echo (while the received state still has the rule)", async () => {
    const m = three();
    click($(m.root, '[data-rule="b"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    const before = m.api.writes.length;
    await undo(m);
    expect(m.api.writes[before]).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { id: "b" } } });
    expect(m.root.textContent).not.toContain("되돌리지 못했습니다");
  });

  test("does not overwrite a rule with the same id that reappeared in between, and says so", async () => {
    const m = three();
    click($(m.root, '[data-rule="b"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    echo(m, [rule("a"), rule("b", "/other"), rule("c")]);
    const before = m.api.writes.length;
    await undo(m);
    expect(m.api.writes.length).toBe(before);
    expect(m.root.textContent).toContain("되돌리지 못했습니다");
  });

  test("also restores the values being edited and the drafts kept before the delete", async () => {
    const m = three();
    m.drafts.set("b/ok", { headersText: "{}", bodyText: "{\"broken" });
    click($(m.root, '[data-rule="b"] .ml-path'));
    type(field(m.root, "path"), "/b/edited");
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    expect(m.drafts.data.has("b/ok")).toBe(false);
    echo(m, [rule("a"), rule("c")]);
    await undo(m);
    const restored = m.api.writes.find(
      (w) =>
        w.op === "maplocal.rule.upsert" &&
        (w.input.rule as Rule).id === "b" &&
        m.api.writes.indexOf(w) > 0,
    );
    expect((restored!.input.rule as Rule).match.path).toBe("/b/edited");
    expect(m.drafts.data.get("b/ok")).toEqual({ headersText: "{}", bodyText: "{\"broken" });
  });

  test("a new delete drops the earlier undo, and only the last one can be undone", async () => {
    const m = three();
    click($(m.root, '[data-rule="a"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    click($(m.root, '[data-rule="c"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    expect(m.root.querySelectorAll('[data-notice="undo"]')).toHaveLength(1);
    expect($(m.root, '[data-notice="undo"]').textContent).toContain("GET /c 규칙을 지웠습니다");
  });

  test("deleting an auth rule with a remaining mock session asks too — undo cannot recall tokens already sent to the real server", async () => {
    const auth = { ...rule("login"), tags: ["auth"] };
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([auth])), authMocked: true };
    const { root } = mount(api);
    click($(root, '[data-rule="login"] .ml-path'));
    click($(root, '[data-action="delete-rule"]'));
    expect($(root, ".necto-dialog").textContent).toContain("로그아웃");
    click($(root, '[data-dialog="cancel"]'));
    expect(api.writes).toHaveLength(0);
  });

  test("undo does not overwrite a response of the same name created elsewhere in between, and says so (I-C)", async () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([
        { ...rule("a"), active: "mid", responses: { ok: { status: 200 }, mid: { status: 201 } } },
      ]),
    );
    const m = mount(api);
    click($(m.root, '[data-rule="a"] .ml-path'));
    removeShown(m.root);
    await m.model.idle();
    api.current = {
      ...engineState(
        configuration([
          { ...rule("a"), active: "ok", responses: { ok: { status: 200 }, mid: { status: 418 } } },
        ]),
      ),
      revision: 50,
    };
    m.model.receiveState(api.current);
    const before = api.writes.length;
    await undo(m);
    expect(api.writes.slice(before).some((w) => w.op === "maplocal.rule.upsert")).toBe(false);
    expect(m.root.textContent).toContain("「mid」 응답이 이미 있어 되돌리지 못했습니다");
  });

  test("cancelling the delete question returns focus to [Delete rule]", () => {
    const auth = { ...rule("login"), tags: ["auth"] };
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([auth])), authMocked: true };
    const { root } = mount(api);
    click($(root, '[data-rule="login"] .ml-path'));
    $(root, '[data-action="delete-rule"]').focus();
    click($(root, '[data-action="delete-rule"]'));
    click($(root, '[data-dialog="cancel"]'));
    expect(document.activeElement).toBe($(root, '[data-action="delete-rule"]'));
  });

  test("deleting asks for a rule whose 'Auth rule' was just turned off in the editor too — both the saved and the edited tags count (I-B2)", async () => {
    const auth = { ...rule("login"), tags: ["auth"] };
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([auth])), authMocked: true };
    const { root } = mount(api);
    click($(root, '[data-rule="login"] .ml-path'));
    const box = field(root, "auth") as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    click($(root, '[data-action="delete-rule"]'));
    expect($(root, ".necto-dialog").textContent).toContain("로그아웃");
    expect(api.writes.some((w) => w.op === "maplocal.rule.delete")).toBe(false);
  });

  test("deleting asks for a rule whose 'Auth rule' was just turned on in the editor (not yet saved) too", async () => {
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([rule("login")])), authMocked: true };
    const { root } = mount(api);
    click($(root, '[data-rule="login"] .ml-path'));
    const box = field(root, "auth") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    click($(root, '[data-action="delete-rule"]'));
    expect($(root, ".necto-dialog").textContent).toContain("로그아웃");
  });

  test("asks when 'Auth rule' was just turned off in the editor and the rule is turned off in the list", async () => {
    const auth = { ...rule("login"), tags: ["auth"] };
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([auth])), authMocked: true };
    const { root } = mount(api);
    click($(root, '[data-rule="login"] .ml-path'));
    const box = field(root, "auth") as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    click($(root, '[data-rule="login"] input[type=checkbox]'));
    expect($(root, ".necto-dialog").textContent).toContain("로그아웃");
  });

  test("deleting a response does not ask either, and undo brings it back at the same tab position and in use, without showing 'Saved' alongside", async () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([
        {
          ...rule("a"),
          active: "mid",
          responses: {
            down: { status: 503 },
            mid: { status: 201, json: { m: 1 } },
            ok: { status: 200 },
          },
        },
      ]),
    );
    const m = mount(api);
    click($(m.root, '[data-rule="a"] .ml-path'));
    expect(tabNames(m.root)).toEqual(["down", "mid", "ok"]);
    removeShown(m.root);
    await m.model.idle();
    expect(m.root.querySelector(".ml-dialog-layer")).toBeNull();
    expect((lastWrite(api).input.rule as Rule).responses.mid).toBeUndefined();
    expect(tabNames(m.root)).toEqual(["down", "ok"]);
    expect($(m.root, '[data-notice="undo"]').textContent).toContain("「mid」 응답을 지웠습니다");
    expect(m.root.querySelector('[data-notice="success"]')).toBeNull();
    expect(savedShown(m.root)).toBe(false);
    await undo(m);
    const sent = lastWrite(api).input.rule as Rule;
    expect(sent.responses.mid).toEqual({ status: 201, json: { m: 1 } });
    expect(sent.active).toBe("mid");
    expect(tabNames(m.root)).toEqual(["down", "mid", "ok"]);
    expect(selectedTab(m.root)).toBe("mid");
  });

  test("does not write a response undo when the rule was deleted, and says so", async () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([{ ...rule("a"), responses: { ok: { status: 200 }, x: { status: 500 } } }]),
    );
    const m = mount(api);
    click($(m.root, '[data-rule="a"] .ml-path'));
    click($(m.root, '[data-response="x"]'));
    removeShown(m.root);
    await m.model.idle();
    echo(m, []);
    const before = api.writes.length;
    await undo(m);
    expect(api.writes.length).toBe(before);
    expect(m.root.textContent).toContain("되돌리지 못했습니다");
  });

  test("the editor's delete buttons sit in the header and response tab rows, not under the editor — so the notice floating at the bottom right does not cover them", () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([{ ...rule("a"), responses: { ok: { status: 200 }, x: { status: 500 } } }]),
    );
    const { root } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    expect(root.querySelector('.ml-editor-head [data-action="delete-rule"]')).not.toBeNull();
    expect(root.querySelector('.ml-response-tabs [data-action="remove-response"]')).not.toBeNull();
    const editor = $(root, ".ml-editor");
    expect(editor.lastElementChild?.querySelector("button")).toBeNull();
    // With the editor closed (after the delete) the list takes the full height — a '+ Rule' at the
    // bottom would be covered by the notice at narrow widths
    expect($(root, ".ml-rules").firstElementChild?.querySelector('[data-action="new-rule"]')).not.toBeNull();
    expect(css).toMatch(/\.ml-toasts\s*\{[^}]*position:\s*fixed[^}]*bottom:/);
  });
});

describe("keyboard: shortcuts work on controls that are not text fields (U3)", () => {
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };

  test("/ goes to the search field even with focus on the header's 'Requests without a rule' picker (WebKit's Tab skips buttons, so that picker is the first stop)", () => {
    const { root } = mountTraffic();
    const select = field(root, "unmatched");
    select.focus();
    expect(key(select, "/").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field(root, "traffic-search"));
    expect((select as unknown as HTMLSelectElement).value).toBe("passthrough");
  });

  test("/ goes to the search field from checkboxes and buttons too, and is not intercepted in text fields (search, numbers)", () => {
    const { root } = mountTraffic();
    const pause = $(root, '[data-action="pause"]');
    pause.focus();
    expect(key(pause, "/").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field(root, "traffic-search"));
    expect(key(field(root, "traffic-search"), "/").defaultPrevented).toBe(false);
  });
});

describe("'Saved' does not cover the editor text (U2)", () => {
  test("its slot is always there and empty, and only its text changes on save — so appearing does not push the editor", async () => {
    const { root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const head = $(root, ".ml-editor-head");
    expect($(head, '[data-notice="saved"]').textContent).toBe("");
    type(field(root, "status"), "503");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(
      [...$(root, ".ml-editor-head").children].map(
        (c) => c.getAttribute("data-notice") ?? c.getAttribute("data-action") ?? c.className,
      ),
    ).toEqual(["necto-switch", "ml-path", "saved", "delete-rule", "close-editor"]);
    await vi.advanceTimersByTimeAsync(2100);
    expect($(root, '[data-notice="saved"]').textContent).toBe("");
  });

  test("shows 'Saved' on the floating layer when a save happens with no editor on screen ([Send this response to the app] in a traffic notice)", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("devices", "/a/{id}")]));
    const { root, model, view } = mount(api);
    click($(root, '[data-tab="traffic"]'));
    view.captureInto(trafficEntry(), networkDetail(), "/a/3");
    await model.idle();
    await vi.advanceTimersByTimeAsync(2100);
    click($(root, '[data-action="activate-captured"]'));
    await model.idle();
    expect($(root, ".ml-toasts").textContent).toContain("저장됨");
  });
});

describe("notice lifetime (U1)", () => {
  const undoShown = (root: ParentNode) => root.querySelector('[data-notice="undo"]') !== null;
  const captureShown = (root: ParentNode) => root.querySelector('[data-notice="capture"]') !== null;
  const deleteA = async () => {
    const m = mount();
    click($(m.root, '[data-rule="a"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    return m;
  };
  // jsdom always treats :hover as false — the element under the mouse is set here.
  let hovering: Element | undefined;
  beforeEach(() => {
    hovering = undefined;
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":hover" ? hovering !== undefined && this.contains(hovering) : matches.call(this, selector);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  const hover = (el: Element) => { hovering = el; el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); };
  const restored = (api: FakeAPI) =>
    api.writes.some(
      (w, i) => i > 0 && w.op === "maplocal.rule.upsert" && (w.input.rule as Rule).id === "a",
    );
  const captured = async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("devices", "/a/{id}")]));
    const m = mount(api);
    click($(m.root, '[data-tab="traffic"]'));
    m.view.captureInto(trafficEntry(), networkDetail(), "/a/3");
    await m.model.idle();
    return m;
  };

  test("the undo notice does not expire with time, whatever the mouse and focus do", async () => {
    const { root } = await deleteA();
    $(root, ".ml-rule-list").focus();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(undoShown(root)).toBe(true);
  });

  test("the undo notice's × closes it and returns focus to the list — the deletion stands", async () => {
    const { root, api, model } = await deleteA();
    const close = $(root, '[data-notice="undo"] [data-action="close-undo"]');
    expect(close.getAttribute("aria-label")).toBe("알림 닫기");
    close.focus();
    click(close);
    await model.idle();
    expect(undoShown(root)).toBe(false);
    expect(restored(api)).toBe(false);
    expect(document.activeElement).toBe($(root, ".ml-rule-list"));
  });

  test("changing something else ends the undo notice — adding a rule, toggling another rule, saving an edit", async () => {
    for (const act of [
      (root: HTMLElement) => click($(root, '[data-action="new-rule"]')),
      (root: HTMLElement) => click($(root, '[data-rule="b"] input[type=checkbox]')),
      async (root: HTMLElement) => {
        click($(root, '[data-rule="b"] .ml-path'));
        type(field(root, "path"), "/b2");
        await vi.advanceTimersByTimeAsync(400);
      },
    ]) {
      const api = new FakeAPI();
      api.current = engineState(configuration([rule("a"), rule("b")]));
      const { root, model } = mount(api);
      click($(root, '[data-rule="a"] .ml-path'));
      click($(root, '[data-action="delete-rule"]'));
      await model.idle();
      expect(undoShown(root)).toBe(true);
      await act(root);
      await model.idle();
      expect(undoShown(root)).toBe(false);
    }
  });

  test("merely selecting another rule (without changing it) does not end the undo notice", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("a"), rule("b")]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    click($(root, '[data-action="delete-rule"]'));
    await model.idle();
    click($(root, '[data-rule="b"] .ml-path'));
    await model.idle();
    expect(undoShown(root)).toBe(true);
  });

  test("the capture notice disappears on its own after about 6 seconds", async () => {
    const { root } = await captured();
    await vi.advanceTimersByTimeAsync(5_900);
    expect(captureShown(root)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(captureShown(root)).toBe(false);
  });

  test("the capture notice also stays while the mouse is over it", async () => {
    const { root } = await captured();
    hover($(root, '[data-notice="capture"]'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(captureShown(root)).toBe(true);
  });

  test("the capture notice counts 6 seconds again from when the mouse leaves it (mouseleave)", async () => {
    const { root } = await captured();
    const layer = $(root, ".ml-toasts");
    hover($(root, '[data-notice="capture"]'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(captureShown(root)).toBe(true);
    hovering = undefined;
    layer.dispatchEvent(new MouseEvent("mouseleave"));
    await vi.advanceTimersByTimeAsync(5_900);
    expect(captureShown(root)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(captureShown(root)).toBe(false);
  });

  test("an app relaunch ends the undo notice — a deleted rule is not restored into another launch (possibly another app)", async () => {
    const { root, api, model } = await deleteA();
    expect(undoShown(root)).toBe(true);
    model.receiveState({ ...api.current, launchID: "launch-2", revision: 0 });
    expect(undoShown(root)).toBe(false);
    expect(restored(api)).toBe(false);
  });

  test("the capture notice is not held when no mouse-leave event arrives (the hovered notice disappeared) — holding is judged by the current :hover (S9)", async () => {
    const { root, view } = await captured();
    const layer = $(root, ".ml-toasts");
    hovering = layer;
    layer.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(captureShown(root)).toBe(true);
    hovering = undefined; // WebKit sends no mouseout from a removed node — the mouse leaves without an event
    view.render();
    await vi.advanceTimersByTimeAsync(6_100);
    expect(captureShown(root)).toBe(false);
  });

  test("deleting the rule a capture notice points to removes the notice at once — so it never offers [Open rule] for a missing rule", async () => {
    const m = await captured();
    click($(m.root, '[data-tab="rules"]'));
    click($(m.root, '[data-rule="devices"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    expect(captureShown(m.root)).toBe(false);
    expect(undoShown(m.root)).toBe(true);
  });

  test("the capture notice also disappears when the rule is deleted elsewhere (such as the CLI)", async () => {
    const m = await captured();
    m.model.receiveState(engineState({ ...configuration([rule("other")]), revision: m.api.revision }));
    expect(captureShown(m.root)).toBe(false);
  });
});

describe("⌘Z undoes the last delete (U1)", () => {
  const cmdZ = (el: Element, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };
  const deleteA = async () => {
    const m = mount();
    click($(m.root, '[data-rule="a"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    return m;
  };
  const restored = (api: FakeAPI) =>
    api.writes.some(
      (w, i) => i > 0 && w.op === "maplocal.rule.upsert" && (w.input.rule as Rule).id === "a",
    );

  test("⌘Z restores the deleted rule when focus is in the list", async () => {
    const { root, api, model } = await deleteA();
    const ev = cmdZ($(root, ".ml-rule-list"));
    await model.idle();
    expect(ev.defaultPrevented).toBe(true);
    expect(restored(api)).toBe(true);
    expect(root.querySelector('[data-notice="undo"]')).toBeNull();
  });

  test("undoes with the key in the Z position even in Korean input mode (key is 'ㅋ')", async () => {
    const { root, api, model } = await deleteA();
    expect(cmdZ($(root, ".ml-rule-list"), { key: "ㅋ", code: "KeyZ" }).defaultPrevented).toBe(true);
    await model.idle();
    expect(restored(api)).toBe(true);
  });

  test("⌘Z works with focus on a picker (requests without a rule) — it is not a text field", async () => {
    const { root, api, model } = await deleteA();
    const select = field(root, "unmatched");
    select.focus();
    expect(cmdZ(select).defaultPrevented).toBe(true);
    await model.idle();
    expect(restored(api)).toBe(true);
  });

  test("does not intercept ⌘Z in text fields (path, body) — there it is the browser's text undo", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("a"), rule("b")]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    click($(root, '[data-action="delete-rule"]'));
    await model.idle();
    click($(root, '[data-rule="b"] .ml-path'));
    const before = api.writes.length;
    for (const name of ["path", "status", "body"]) {
      const el = field(root, name);
      expect(cmdZ(el).defaultPrevented).toBe(false);
    }
    await model.idle();
    expect(api.writes.length).toBe(before);
    expect(root.querySelector('[data-notice="undo"]')).not.toBeNull();
  });

  test("does not intercept when there is nothing to undo or with ⇧, ⌃ or ⌥ (⌘⇧Z is redo)", async () => {
    const { root } = mount();
    expect(cmdZ($(root, ".ml-rule-list")).defaultPrevented).toBe(false);
    const m = await deleteA();
    expect(cmdZ($(m.root, ".ml-rule-list"), { shiftKey: true }).defaultPrevented).toBe(false);
    expect(cmdZ($(m.root, ".ml-rule-list"), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(cmdZ($(m.root, ".ml-rule-list"), { metaKey: false }).defaultPrevented).toBe(false);
    click($(m.root, '[data-action="close-undo"]'));
    expect(cmdZ($(m.root, ".ml-rule-list")).defaultPrevented).toBe(false);
  });

  test("⌘Z does not undo while waiting for the app to connect (the notice is hidden) (S6)", async () => {
    const { root, api, model, view } = await deleteA();
    view.connection = "waiting";
    view.render();
    expect(cmdZ(document.body).defaultPrevented).toBe(false);
    await model.idle();
    expect(restored(api)).toBe(false);
  });

  test("⌘Z is not the panel's while a dialog is open", async () => {
    const { root } = await deleteA();
    click($(root, '[data-action="import"]'));
    expect(cmdZ($(root, ".necto-dialog")).defaultPrevented).toBe(false);
  });

  test("⌘Z works on the traffic tab too (the notice floats regardless of the tab)", async () => {
    const { root, api, model } = await deleteA();
    click($(root, '[data-tab="traffic"]'));
    expect(cmdZ($(root, '[data-tab="traffic"]')).defaultPrevented).toBe(true);
    await model.idle();
    expect(restored(api)).toBe(true);
  });

  test("the undo button shows no '⌘Z' — Necto's Edit menu takes ⌘Z, so it never reaches the panel", async () => {
    const { root } = await deleteA();
    const button = $(root, '[data-action="undo"]');
    expect(button.textContent).toBe("되돌리기");
    expect(button.hasAttribute("data-shortcut")).toBe(false);
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});

test("focus goes to the primary action when the traffic detail arrives, even if a state after Return redrew the whole panel while it was loading (S1)", async () => {
  const store = new TrafficStore(() => view.refreshTraffic());
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  api.detailFor = (id) => networkDetail({ id });
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  view.networkAvailable = true;
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  click($(root, '[data-tab="traffic"]'));
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([
    {
      id: "n1",
      method: "GET",
      url: "https://maplocal.invalid/a/3",
      host: "maplocal.invalid",
      startedAtMilliseconds: 1,
      state: "completed",
      statusCode: 200,
    },
  ]);
  const list = $(root, '.ml-traffic-list[role="listbox"]');
  list.focus();
  list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  model.receiveState({ ...api.current, revision: 5 });
  expect($(root, ".ml-traffic-detail").contains(document.activeElement)).toBe(true);
  await vi.runAllTimersAsync();
  expect(document.activeElement).toBe($(root, '[data-action="capture"]'));
});

describe("focus on a tab survives redraws (K5, K6)", () => {
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

  test("choosing a response tab with ←→ and Return (press) keeps focus on that tab, so ←→ keeps working", async () => {
    const api = new FakeAPI();
    api.current = engineState(
      configuration([
        { ...rule("a"), responses: { ok: { status: 200 }, 'say "hi"': { status: 500 } } },
      ]),
    );
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    const tab = (name: string) =>
      [...root.querySelectorAll<HTMLElement>('.ml-response-tabs [role="tab"]')].find(
        (t) => t.dataset.response === name,
      )!;
    tab("ok").focus();
    key(tab("ok"), "ArrowRight");
    expect(document.activeElement).toBe(tab('say "hi"'));
    click(tab('say "hi"'));
    expect(document.activeElement).toBe(tab('say "hi"'));
    await model.idle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.activeElement).toBe(tab('say "hi"'));
    expect(tab('say "hi"').getAttribute("aria-selected")).toBe("true");
  });

  test("focus on a panel tab (rules, traffic) survives a redraw from an incoming state", () => {
    const { root, model, api } = mount();
    $(root, '[data-tab="rules"]').focus();
    model.receiveState({ ...api.current, revision: 3 });
    expect(document.activeElement).toBe($(root, '[data-tab="rules"]'));
  });
});

test("a mock made from our record stays created when the request pairs with a Necto record and its key changes — so ⌘↩ does not add the same response again (S3, K1)", async () => {
  const store = new TrafficStore(() => view.refreshTraffic());
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  api.detailFor = (id) => networkDetail({ id, url: "https://maplocal.invalid/new" });
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  view.networkAvailable = true;
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  click($(root, '[data-tab="traffic"]'));
  store.ingestOurs([
    {
      seq: 1,
      date: 1001,
      method: "GET",
      host: "maplocal.invalid",
      path: "/new",
      query: {},
      outcome: { passthrough: {} },
    },
  ]);
  click($(root, ".ml-traffic-group"));
  click($(root, '[data-action="empty-rule"]'));
  await model.idle();
  await vi.advanceTimersByTimeAsync(0);
  expect(root.querySelector("[data-capture-done]")).not.toBeNull();
  store.ingestNetwork([
    {
      id: "n1",
      method: "GET",
      url: "https://maplocal.invalid/new",
      host: "maplocal.invalid",
      startedAtMilliseconds: 1000,
      state: "completed",
      statusCode: 200,
    },
  ]);
  await vi.runAllTimersAsync();
  expect($(root, ".ml-traffic-detail").dataset.key).toBe("n1");
  expect(root.querySelector("[data-capture-done]")).not.toBeNull();
  expect(root.querySelector('[data-action="capture"]')).toBeNull();
});

describe("dialogs are fully keyboard-operable (K2)", () => {
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };
  const rulesList = (root: ParentNode) => $(root, '.ml-rules [role="listbox"]');
  const authSession = () => {
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([{ ...rule("a"), tags: ["auth"] }, rule("b")])), authMocked: true };
    const m = mount(api);
    rulesList(m.root).focus();
    key(rulesList(m.root), "ArrowDown");
    key(rulesList(m.root), " ");
    return m;
  };

  test("when open it is aria-modal with focus on [Cancel], and its buttons are WebKit Tab stops (tabindex=0)", () => {
    const { root } = authSession();
    const dialog = $(root, '[role="dialog"]');
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe($(root, '[data-dialog="cancel"]'));
    expect($(root, '[data-dialog="cancel"]').getAttribute("tabindex")).toBe("0");
    expect($(root, '[data-dialog="confirm"]').getAttribute("tabindex")).toBe("0");
  });

  test("Esc cancels without sending, returns focus to the list and keeps the rule selection", async () => {
    const { root, api, model } = authSession();
    key(document.activeElement!, "Escape");
    await model.idle();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(api.writes).toHaveLength(0);
    expect(document.activeElement).toBe(rulesList(root));
    expect($(root, '[data-rule="a"]').getAttribute("aria-selected")).toBe("true");
  });

  test("Return in a dialog that guards a risk is [Cancel] — the risky action is never the default (HIG)", async () => {
    const { root, api, model } = authSession();
    const ev = key(document.activeElement!, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    await model.idle();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(api.writes).toHaveLength(0);
    expect(document.activeElement).toBe(rulesList(root));
  });

  test("only Return after tabbing to [Turn off] confirms", async () => {
    const { root, api, model } = authSession();
    key(document.activeElement!, "Tab");
    expect(document.activeElement).toBe($(root, '[data-dialog="confirm"]'));
    key(document.activeElement!, "Enter");
    await model.idle();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { id: "a", enabled: false } } });
    expect(document.activeElement).toBe(rulesList(root));
  });

  test("[Cancel] looks like the default button, and the confirm button looks destructive", () => {
    const { root } = authSession();
    expect($(root, '[data-dialog="cancel"]').classList.contains("necto-button-primary")).toBe(true);
    expect($(root, '[data-dialog="confirm"]').classList.contains("necto-button-primary")).toBe(false);
    expect($(root, '[data-dialog="confirm"]').classList.contains("necto-button-danger")).toBe(true);
  });

  test("in a dialog without risk, such as import, Return still confirms", async () => {
    const { root } = mount();
    click($(root, '[data-action="import"]'));
    type(field(root, "dialog-text"), "not json");
    const cancel = $(root, '[data-dialog="cancel"]');
    cancel.focus();
    expect($(root, '[data-dialog="confirm"]').classList.contains("necto-button-primary")).toBe(true);
    key(cancel, "Enter");
    expect($(root, ".necto-dialog .ml-error").textContent).not.toBe("");
  });

  test("Tab and ⇧Tab cycle inside the dialog", () => {
    const { root } = authSession();
    const cancel = $(root, '[data-dialog="cancel"]');
    const confirm = $(root, '[data-dialog="confirm"]');
    expect(key(cancel, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
    key(confirm, "Tab");
    expect(document.activeElement).toBe(cancel);
    key(cancel, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  test("while it is open, the list keys behind it (↑↓, Return, Space) change nothing", () => {
    const { root } = authSession();
    key(rulesList(root), "ArrowDown");
    key(rulesList(root), "Enter");
    key(rulesList(root), " ");
    expect($(root, '[data-rule="a"]').getAttribute("aria-selected")).toBe("true");
    expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(root.querySelector(".ml-editor")!.contains(document.activeElement)).toBe(false);
  });

  test("the traffic list keys do nothing while a dialog is open either", () => {
    const store = new TrafficStore(() => view.refreshTraffic());
    document.body.innerHTML = '<div id="app"></div>';
    const api = new FakeAPI();
    let view!: View;
    const model = new PanelModel(api, () => view.render());
    view = new View(document.getElementById("app")!, model, {
      api,
      drafts: memoryDrafts(),
      copy: async () => true,
      copyField: () => true,
      prefs: noPrefs,
      traffic: { store, order: new OrderDetector() },
    });
    view.connection = "connected";
    model.receiveState(api.current);
    const root = document.getElementById("app")!;
    click($(root, '[data-tab="traffic"]'));
    store.ingestNetwork([
      {
        id: "1",
        method: "GET",
        url: "https://maplocal.invalid/a/1",
        host: "maplocal.invalid",
        startedAtMilliseconds: 1,
        state: "completed",
        statusCode: 200,
      },
    ]);
    click($(root, '[data-action="import"]'));
    key($(root, '.ml-traffic-list[role="listbox"]'), "ArrowDown");
    expect(root.querySelector('.ml-traffic-list [aria-selected="true"]')).toBeNull();
  });

  test("the paste dialog focuses its text box, and Return in the box is a line break (it does not import)", () => {
    const { root, api } = mount();
    click($(root, '[data-action="import"]'));
    const area = $(root, '[data-field="dialog-text"]');
    expect(document.activeElement).toBe(area);
    expect(key(area, "Enter").defaultPrevented).toBe(false);
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(api.writes).toHaveLength(0);
    key(area, "Tab");
    expect(document.activeElement).toBe($(root, '[data-dialog="cancel"]'));
  });
});

test("WebKit's Tab skips buttons and checkboxes — every control in the experience loop sets its own tabindex (K4)", async () => {
  const store = new TrafficStore(() => view.refreshTraffic());
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  api.current = engineState(
    configuration([
      { ...rule("a"), responses: { ok: { status: 200 }, err: { status: 500 } } },
      rule("b"),
    ]),
  );
  api.detailFor = (id) => networkDetail({ id });
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  view.networkAvailable = true;
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  const unreachable = () => ([...root.querySelectorAll("button, input[type=checkbox]")] as HTMLElement[])
    .filter((el) => !el.closest("[hidden]") && !el.hasAttribute("tabindex"))
    .map((el) => el.getAttribute("data-action") ?? el.getAttribute("data-field") ?? el.textContent);
  click($(root, '[data-rule="b"] .ml-path'));
  click($(root, '[data-action="delete-rule"]'));
  click($(root, '[data-rule="a"] .ml-path'));
  expect($(root, '[data-notice="undo"]')).not.toBeNull();
  expect(unreachable()).toEqual([]);
  for (const sel of [
    'button[role="switch"]',
    '[data-action="import"]',
    '[data-action="export"]',
    '[data-action="new-rule"]',
    '[data-action="add-response"]',
    '[data-action="remove-response"][data-remove="ok"]',
    '[data-action="delete-rule"]',
    '[data-action="close-editor"]',
    '[data-action="undo"]',
    ".ml-split-handle",
  ]) {
    expect($(root, sel).getAttribute("tabindex"), sel).toBe("0");
  }
  click($(root, '[data-tab="traffic"]'));
  store.ingestNetwork([
    {
      id: "n1",
      method: "GET",
      url: "https://maplocal.invalid/a/1",
      host: "maplocal.invalid",
      startedAtMilliseconds: 1,
      state: "completed",
      statusCode: 200,
    },
    {
      id: "n2",
      method: "GET",
      url: "https://maplocal.invalid/a/2",
      host: "maplocal.invalid",
      startedAtMilliseconds: 2,
      state: "completed",
      statusCode: 200,
    },
  ]);
  click($(root, ".ml-traffic-group"));
  await vi.runAllTimersAsync();
  click($(root, '[data-chip="4xx"]'));
  expect($(root, '[data-action="clear-filters"]')).not.toBeNull();
  expect(unreachable()).toEqual([]);
  for (const sel of [
    '[data-mode="time"]',
    '[data-chip="2xx"]',
    '[data-action="pause"]',
    '[data-field="allowed-only"]',
    '[data-action="older"]',
    '[data-action="deselect"]',
    '[data-action="clear-filters"]',
    '[data-action="capture"]',
  ]) {
    expect($(root, sel).getAttribute("tabindex"), sel).toBe("0");
  }
});

describe("saving leaves the field being typed in as it is — 'Saved' only changes its own text (K7, S5)", () => {
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

  test("while typing a body, the box stays the same node and keeps focus and caret through the save and 'Saved' coming and going (text undo lives on that node)", async () => {
    const { root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const body = field(root, "body") as unknown as HTMLTextAreaElement;
    body.focus();
    type(body, '{"x": 1}');
    body.setSelectionRange(3, 3);
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(savedShown(root)).toBe(true);
    expect(field(root, "body")).toBe(body);
    expect(document.activeElement).toBe(body);
    expect(body.selectionStart).toBe(3);
    await vi.advanceTimersByTimeAsync(2500);
    expect(savedShown(root)).toBe(false);
    expect(field(root, "body")).toBe(body);
    expect(document.activeElement).toBe(body);
  });

  test("the path field behaves the same", async () => {
    const { root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const path = field(root, "path");
    path.focus();
    type(path, "/a/next");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(field(root, "path")).toBe(path);
    await vi.advanceTimersByTimeAsync(2500);
    expect(field(root, "path")).toBe(path);
  });

  test("a menu opened right after an edit keeps its choice when the edit's save lands while it is open", async () => {
    const { api, root, model } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "delay"), "100");
    const menu = field(root, "error") as unknown as HTMLSelectElement;
    menu.focus();
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(field(root, "error")).toBe(menu);
    menu.value = "connectionLost";
    menu.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(lastWrite(api).input).toMatchObject({
      rule: { id: "a", responses: { ok: { delayMs: 100, error: "connectionLost" } } },
    });
  });

  test("does not show 'Saved' in b's editor when a's save finishes after editing rule a and moving to b with ↓", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("a"), rule("b")]));
    const { root, model } = mount(api);
    const list = () => $(root, '.ml-rules [role="listbox"]');
    list().focus();
    key(list(), "ArrowDown");
    type(field(root, "path"), "/a2");
    list().focus();
    key(list(), "ArrowDown");
    expect(field(root, "path").value).toBe("/b");
    await model.idle();
    await flush();
    expect(savedShown(root)).toBe(false);
  });

  test("moving to another rule while 'Saved' shows leaves it out of that rule's editor", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("a"), rule("b")]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    type(field(root, "path"), "/a2");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(savedShown(root)).toBe(true);
    click($(root, '[data-rule="b"] .ml-path'));
    expect(savedShown(root)).toBe(false);
  });
});

describe("typing an allowed host", () => {
  const hostField = (root: ParentNode) => field(root, "add-host");
  const submit = (root: ParentNode, value: string) => {
    const el = hostField(root);
    el.focus();
    type(el, value);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  };
  const hint = (root: ParentNode) => root.querySelector('[data-hint="add-host"]')?.textContent ?? "";
  /** The fake app does not apply writes — it echoes the last write's allowed hosts as the state. */
  const echo = (api: FakeAPI, model: PanelModel) => {
    api.current = engineState({
      ...api.current.configuration,
      allowedHosts: lastWrite(api).input.allowedHosts as string[],
    });
    model.receiveState(api.current);
  };

  test("Return adds just the host from a pasted URL, and leaves the field empty and focused", async () => {
    const { api, root, model } = mount();
    expect(hostField(root).getAttribute("placeholder")).toBe("api.example.com");
    submit(root, "https://Api.Example.com:8443/v1");
    await model.idle();
    expect(lastWrite(api)).toMatchObject({
      op: "maplocal.configuration.patch",
      input: { allowedHosts: ["maplocal.invalid", "api.example.com"] },
    });
    echo(api, model);
    expect(hostField(root).value).toBe("");
    expect(document.activeElement).toBe(hostField(root));
    expect(
      [...root.querySelectorAll(".ml-head .ml-chip")].map((x) => x.firstChild?.textContent),
    ).toContain("api.example.com");
    expect(hint(root)).toBe("");
  });

  test("can add two in a row", async () => {
    const { api, root, model } = mount();
    submit(root, "a.example.com");
    await model.idle();
    echo(api, model);
    submit(root, "b.example.com");
    await model.idle();
    expect(lastWrite(api).input).toMatchObject({
      allowedHosts: ["maplocal.invalid", "a.example.com", "b.example.com"],
    });
  });

  test("does not write a host that is already allowed, says so beside the field, and keeps the text and the chip", async () => {
    const { api, root, model } = mount();
    submit(root, "MAPLOCAL.invalid");
    await model.idle();
    expect(api.writes).toHaveLength(0);
    expect(hint(root)).toContain("이미 허용");
    expect(hostField(root).value).toBe("MAPLOCAL.invalid");
    expect(root.querySelector(".ml-head .ml-chip")?.firstChild?.textContent).toBe("maplocal.invalid");
    expect(root.querySelector(".ml-toasts")?.textContent ?? "").not.toContain("이미 허용");
  });

  test("does not write a Unicode host, which the engine cannot match, and asks for punycode", async () => {
    const { api, root, model } = mount();
    submit(root, "https://한국.kr/a");
    await model.idle();
    expect(api.writes).toHaveLength(0);
    expect(hint(root)).toBe("유니코드 호스트는 punycode(xn--…)로 입력하세요");
    expect(hostField(root).value).toBe("https://한국.kr/a");
    submit(root, "xn--3e0b707e.kr");
    await model.idle();
    expect(lastWrite(api).input).toMatchObject({ allowedHosts: ["maplocal.invalid", "xn--3e0b707e.kr"] });
  });

  test("says a host blocked in the app code cannot be allowed", async () => {
    const api = new FakeAPI();
    api.current = { ...engineState(), blockedHosts: ["prod.example.com"] };
    const { root, model } = mount(api);
    submit(root, "https://prod.example.com/login");
    await model.idle();
    expect(api.writes).toHaveLength(0);
    expect(hint(root)).toContain("허용할 수 없습니다");
    expect(hostField(root).value).toBe("https://prod.example.com/login");
  });

  test("gives the reason for text that does not read as a host, and keeps the text", async () => {
    const { api, root, model } = mount();
    submit(root, "a b");
    await model.idle();
    expect(api.writes).toHaveLength(0);
    expect(hint(root)).not.toBe("");
    expect(hostField(root).value).toBe("a b");
  });

  test("Return in an empty field does nothing", async () => {
    const { api, root, model } = mount();
    submit(root, "   ");
    await model.idle();
    expect(api.writes).toHaveLength(0);
    expect(hint(root)).toBe("");
  });

  test("the reason disappears once editing starts, and the typed text survives redraws", () => {
    const { api, root, model } = mount();
    submit(root, "a b");
    type(hostField(root), "a b.example");
    expect(hint(root)).toBe("");
    model.receiveState(api.current);
    expect(hostField(root).value).toBe("a b.example");
    expect(document.activeElement).toBe(hostField(root));
  });

  test("adding a host ends the undo notice", async () => {
    const api = new FakeAPI();
    api.current = engineState(configuration([rule("a"), rule("b")]));
    const { root, model } = mount(api);
    click($(root, '[data-rule="a"] .ml-path'));
    click($(root, '[data-action="delete-rule"]'));
    await model.idle();
    expect(root.querySelector('[data-notice="undo"]')).not.toBeNull();
    submit(root, "new.example.com");
    await model.idle();
    expect(root.querySelector('[data-notice="undo"]')).toBeNull();
  });

  test("the field sits inside the allowed-hosts group, and the first row scrolls sideways instead of wrapping, so the header keeps its height", () => {
    const { root } = mount();
    expect($(root, ".ml-head-state").contains(hostField(root))).toBe(true);
    expect(css).toMatch(/\.ml-head-state\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.ml-host-group\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.ml-add-host\s*\{[^}]*min-width/);
  });
});

describe("query condition editing", () => {
  const paged = (query: Record<string, string>) => {
    const r = rule("a", "/api/sites");
    r.match.query = query;
    return r;
  };
  const mountWith = (r: Rule) => {
    const api = new FakeAPI();
    api.current = engineState(configuration([r]));
    const m = mount(api);
    click($(m.root, '[data-rule="a"] .ml-path'));
    return m;
  };
  const enter = (el: Element) => {
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  };
  const upserts = (api: FakeAPI) =>
    api.writes.filter((w) => w.op === "maplocal.rule.upsert").map((w) => w.input.rule as Rule);

  test("'Query conditions' under the path says 'Any query' when empty, and '+ Condition' adds a key=value row and saves", async () => {
    const { api, root, model } = mountWith(rule("a", "/api/sites"));
    expect($(root, '[data-caption="query"]').textContent).toBe("쿼리 조건");
    expect($(root, "[data-query-empty]").textContent).toBe("모든 쿼리");
    click($(root, '[data-action="add-query"]'));
    expect(root.querySelector("[data-query-empty]")).toBeNull();
    expect(document.activeElement).toBe(field(root, "query-key:0"));
    type(field(root, "query-key:0"), "page");
    type(field(root, "query-value:0"), "2");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(upserts(api).at(-1)!.match).toEqual({ method: "GET", path: "/api/sites", query: { page: "2" } });
  });

  test("removing a condition with × saves without query (the engine ignores empty conditions too) and goes back to 'Any query'", async () => {
    const { api, root, model } = mountWith(paged({ page: "2" }));
    expect(field(root, "query-key:0").value).toBe("page");
    expect(field(root, "query-value:0").value).toBe("2");
    const remove = $(root, '[data-action="remove-query"]');
    expect(remove.getAttribute("aria-label")).toBe("page 조건 지우기");
    click(remove);
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    const saved = upserts(api).at(-1)!;
    expect(saved.match).toEqual({ method: "GET", path: "/api/sites" });
    expect("query" in saved.match).toBe(false);
    expect($(root, "[data-query-empty]").textContent).toBe("모든 쿼리");
  });

  test("empty and duplicate keys show a reason on their row and are not saved; fixing them saves", async () => {
    const { api, root, model } = mountWith(paged({ page: "1" }));
    click($(root, '[data-action="add-query"]'));
    type(field(root, "query-value:1"), "2");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(upserts(api)).toHaveLength(0);
    expect($(root, '[data-query-problem="1"]').textContent).toBe("키를 입력하세요");
    type(field(root, "query-key:1"), "page");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(upserts(api)).toHaveLength(0);
    expect($(root, '[data-query-problem="1"]').textContent).toBe("같은 키가 이미 있습니다");
    expect(document.activeElement).toBe(field(root, "query-key:1"));
    type(field(root, "query-key:1"), "siteId");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(root.querySelector("[data-query-problem]")).toBeNull();
    expect(upserts(api).at(-1)!.match.query).toEqual({ page: "1", siteId: "2" });
  });

  test("a value with %XX gets a hint on its row that it is compared decoded, without blocking the save", async () => {
    const { api, root, model } = mountWith(paged({ page: "1" }));
    type(field(root, "query-value:0"), "%ED%95%9C");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(upserts(api).at(-1)!.match.query).toEqual({ page: "%ED%95%9C" });
    expect($(root, '[data-query-hint="0"]').textContent).toBe("%XX는 풀어서 비교합니다 — 원래 글자로 입력하세요(「한」)");
    expect(root.querySelector("[data-query-problem]")).toBeNull();
    type(field(root, "query-value:0"), "한");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(root.querySelector("[data-query-hint]")).toBeNull();
  });

  test("a key containing = shows a reason on its row and is not saved", async () => {
    const { api, root, model } = mountWith(paged({ page: "1" }));
    type(field(root, "query-key:0"), "page=2");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(upserts(api)).toHaveLength(0);
    expect($(root, '[data-query-problem="0"]').textContent).toBe("키에 = & ? #는 쓸 수 없습니다");
  });

  test("removing the row before a row with a reason keeps the reason with its own row", async () => {
    const { root, model } = mountWith(paged({ a: "1" }));
    click($(root, '[data-action="add-query"]'));
    type(field(root, "query-value:1"), "2");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect($(root, '[data-query-problem="1"]').textContent).toBe("키를 입력하세요");
    click($(root, '[data-query-row="0"] [data-action="remove-query"]'));
    expect(root.querySelector('[data-query-problem="1"]')).toBeNull();
    expect($(root, '[data-query-problem="0"]').textContent).toBe("키를 입력하세요");
  });

  test("the rule list and the editor title show query conditions, telling apart two rules with the same path", () => {
    const api = new FakeAPI();
    const two = paged({ page: "2" });
    two.id = "b";
    api.current = engineState(configuration([rule("a", "/api/sites"), two]));
    const { root } = mount(api);
    expect($(root, '[data-rule="b"] .ml-path').textContent).toBe("GET /api/sites ?page=2");
    expect($(root, '[data-rule="b"] .ml-query').textContent).toBe("?page=2");
    expect($(root, '[data-rule="b"] .ml-path').getAttribute("title")).toBe("GET /api/sites?page=2");
    expect($(root, '[data-rule="a"] .ml-query')).toBeNull();
    click($(root, '[data-rule="b"] .ml-path'));
    expect($(root, ".ml-editor-head .ml-path").textContent).toBe("GET /api/sites ?page=2");
  });

  test("Return moves from a key field to its value, from a value field to the next row's key, and from the last row's value adds a row and moves to its key; it adds nothing on an empty last row", () => {
    const { root } = mountWith(paged({ page: "2", siteId: "101" }));
    field(root, "query-key:0").focus();
    expect(enter(field(root, "query-key:0")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field(root, "query-value:0"));
    enter(field(root, "query-value:0"));
    expect(document.activeElement).toBe(field(root, "query-key:1"));
    field(root, "query-value:1").focus();
    enter(field(root, "query-value:1"));
    expect(document.activeElement).toBe(field(root, "query-key:2"));
    expect(field(root, "query-value:2").value).toBe("");
    field(root, "query-value:2").focus();
    enter(field(root, "query-value:2"));
    expect(root.querySelector('[data-field="query-key:3"]')).toBeNull();
    expect(document.activeElement).toBe(field(root, "query-value:2"));
  });

  test("every field is reachable by Tab: inputs do not block tabindex, and × and '+ Condition' have tabindex=0", () => {
    const { root } = mountWith(paged({ page: "2" }));
    for (const name of ["query-key:0", "query-value:0"])
      expect(field(root, name).getAttribute("tabindex")).not.toBe("-1");
    expect($(root, '[data-action="remove-query"]').getAttribute("tabindex")).toBe("0");
    expect($(root, '[data-action="add-query"]').getAttribute("tabindex")).toBe("0");
    expect(field(root, "query-key:0").getAttribute("aria-label")).toBe("쿼리 키");
    expect(field(root, "query-value:0").getAttribute("aria-label")).toBe("쿼리 값");
  });

  test("removing with × moves focus to the next row (else the previous row, else '+ Condition')", () => {
    const { root } = mountWith(paged({ a: "1", b: "2" }));
    $(root, '[data-action="remove-query"]').focus();
    click($(root, '[data-action="remove-query"]'));
    expect(document.activeElement).toBe(field(root, "query-key:0"));
    expect(field(root, "query-key:0").value).toBe("b");
    click($(root, '[data-action="remove-query"]'));
    expect(document.activeElement).toBe($(root, '[data-action="add-query"]'));
  });

  test("the field being typed in survives as the same node when a save or 'Saved' redraws mid-typing (K7)", async () => {
    const { root, model } = mountWith(paged({ page: "2" }));
    const key = field(root, "query-key:0");
    key.focus();
    type(key, "pages");
    key.setSelectionRange(2, 2);
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    expect(document.activeElement).toBe(key);
    expect(key.isConnected).toBe(true);
    expect(key.selectionStart).toBe(2);
    expect($(root, '[data-action="remove-query"]').getAttribute("aria-label")).toBe("pages 조건 지우기");
  });

  test("keeps the row order when the engine echoes the conditions reordered", async () => {
    const { root, model } = mountWith(paged({ page: "2" }));
    click($(root, '[data-action="add-query"]'));
    type(field(root, "query-key:1"), "siteId");
    type(field(root, "query-value:1"), "101");
    await vi.advanceTimersByTimeAsync(400);
    await model.idle();
    const echoed = paged({ siteId: "101", page: "2" });
    model.receiveState(engineState({ ...configuration([echoed]), revision: 1 }));
    expect([0, 1].map((i) => field(root, `query-key:${i}`).value)).toEqual(["page", "siteId"]);
  });
});

describe("query conditions when creating from traffic", () => {
  const entry = trafficEntry({
    path: "/api/sites",
    query: { page: "2" },
    url: "https://maplocal.invalid/api/sites?page=2",
  });

  test("creates without query conditions by default — behaviour does not change", async () => {
    const { api, model, view } = mount();
    view.captureInto(entry, networkDetail(), "/api/sites");
    await model.idle();
    expect((lastWrite(api).input.rule as Rule).match).toEqual({
      method: "GET",
      host: "maplocal.invalid",
      path: "/api/sites",
    });
  });

  test("choosing 'Only for this query' moves the request's query into query conditions (for both response capture and empty response)", async () => {
    const { api, model, view } = mount();
    view.captureInto(entry, networkDetail(), "/api/sites", undefined, { page: "2" });
    await model.idle();
    expect((lastWrite(api).input.rule as Rule).match).toEqual({
      method: "GET",
      host: "maplocal.invalid",
      path: "/api/sites",
      query: { page: "2" },
    });
    const second = mount();
    second.view.emptyRuleFrom(
      { ...entry, key: "n2", path: "/api/other", url: "https://maplocal.invalid/api/other?page=2" },
      "/api/other",
      { page: "2" },
    );
    await second.model.idle();
    expect((lastWrite(second.api).input.rule as Rule).match).toEqual({
      method: "GET",
      host: "maplocal.invalid",
      path: "/api/other",
      query: { page: "2" },
    });
  });
});

describe("a redraw that arrives during a press does not swallow the click (Q2)", () => {
  /** Holds writes and resolves them on demand — to make a save result or echo arrive mid-press. */
  function holdWrites(api: FakeAPI) {
    const held: Array<() => void> = [];
    const write = api.write.bind(api);
    api.write = (op, input) => new Promise((resolve) => { held.push(() => void write(op, input).then(resolve)); });
    return async () => {
      await vi.advanceTimersByTimeAsync(0);
      while (held.length) held.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    };
  }

  /**
   * A WebKit press: mousedown takes focus from a text field, and click fires only when mousedown
   * and mouseup hit the same (attached) node.
   * If the node is replaced in between, the click goes nowhere — so this checks that the pressed
   * node is still attached before clicking.
   */
  async function press(el: HTMLElement, during: () => Promise<void>) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    (document.activeElement as HTMLElement | null)?.blur();
    await during();
    expect(el.isConnected, "누른 노드가 그 사이 바뀌면 WebKit은 click을 보내지 않는다").toBe(true);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
    click(el);
    await vi.advanceTimersByTimeAsync(0);
  }

  test("clicking '+ Condition' right after editing the path adds a condition row even when a save result arrives in between", async () => {
    const { api, root } = mount();
    const release = holdWrites(api);
    click($(root, '[data-rule="a"] .ml-path'));
    field(root, "path").focus();
    type(field(root, "path"), "/a/b");
    await vi.advanceTimersByTimeAsync(400);
    await press(field(root, "add-query"), release);
    expect(field(root, "query-key:0")).not.toBeNull();
    expect(document.activeElement).toBe(field(root, "query-key:0"));
  });

  test("clicking the traffic tab right after adding a host with Return switches tabs even when a save result arrives in between", async () => {
    const { api, root } = mount();
    const release = holdWrites(api);
    const host = field(root, "add-host");
    host.focus();
    type(host, "api.example.com");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await press(field(root, "tab-traffic"), release);
    expect(field(root, "tab-traffic").getAttribute("aria-selected")).toBe("true");
  });

  test("draws the redraw deferred during a press on release (even when dragged off without a click)", async () => {
    const { api, root } = mount();
    const release = holdWrites(api);
    const host = field(root, "add-host");
    host.focus();
    type(host, "api.example.com");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const tab = field(root, "tab-traffic");
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await release();
    expect(tab.isConnected).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.isConnected).toBe(false); // The deferred redraw has now happened
  });

  test("drawing is never blocked for good when the release is missed for a long time (released outside the window)", async () => {
    const { api, root } = mount();
    const release = holdWrites(api);
    const host = field(root, "add-host");
    host.focus();
    type(host, "api.example.com");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const tab = field(root, "tab-traffic");
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await release();
    await vi.advanceTimersByTimeAsync(3000);
    expect(tab.isConnected).toBe(false);
  });

  test("keyboard actions (adding a host with Return) draw right away without deferring", () => {
    const { root } = mount();
    const host = field(root, "add-host");
    host.focus();
    type(host, "api.example.com");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(field(root, "add-host").value).toBe("");
    expect(document.activeElement).toBe(field(root, "add-host"));
  });
});

test("clicking 'Pause' while new requests pour in pauses on the first click, because requests arriving mid-press do not replace the button (Q2)", async () => {
  const store = new TrafficStore(() => view.refreshTraffic());
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  click($(root, '[data-tab="traffic"]'));
  const pause = field(root, "pause-toggle");
  pause.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  store.ingestNetwork([
    {
      id: "1",
      method: "GET",
      url: "https://maplocal.invalid/a/1",
      host: "maplocal.invalid",
      startedAtMilliseconds: 1,
      state: "completed",
      statusCode: 200,
    },
  ]);
  expect(pause.isConnected).toBe(true);
  pause.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
  click(pause);
  await vi.advanceTimersByTimeAsync(0);
  expect(store.paused).toBe(true);
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(1);
});

test("clicking 'Show newest' while new requests pour in works on the first click and goes to the newest at that moment", async () => {
  const store = new TrafficStore(() => view.refreshTraffic());
  document.body.innerHTML = '<div id="app"></div>';
  const api = new FakeAPI();
  let view!: View;
  const model = new PanelModel(api, () => view.render());
  view = new View(document.getElementById("app")!, model, {
    api,
    drafts: memoryDrafts(),
    copy: async () => true,
    copyField: () => true,
    prefs: noPrefs,
    traffic: { store, order: new OrderDetector() },
  });
  view.connection = "connected";
  model.receiveState(api.current);
  const root = document.getElementById("app")!;
  const request = (id: string, at: number): NetworkSummary => ({
    id, method: "GET", url: `https://maplocal.invalid/a/${id}`, host: "maplocal.invalid", startedAtMilliseconds: at, state: "completed", statusCode: 200,
  });
  click($(root, '[data-tab="traffic"]'));
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([request("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  store.ingestNetwork([request("2", 2)]);
  const show = $(root, '[data-newer] [data-action="show-newest"]');
  show.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  store.ingestNetwork([request("3", 3)]);
  expect(show.isConnected).toBe(true);
  show.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
  click(show);
  await vi.advanceTimersByTimeAsync(0);
  expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("3");
  expect(root.querySelector("[data-newer]")).toBeNull();
});

test("pressing a picker does not defer drawing — the macOS popup sends no mouseup or click to the page (Q2)", async () => {
  const { api, root } = mount();
  const held: Array<() => void> = [];
  const write = api.write.bind(api);
  api.write = (op, input) => new Promise((resolve) => { held.push(() => void write(op, input).then(resolve)); });
  click($(root, '[data-rule="a"] .ml-path'));
  type(field(root, "status"), "503");
  await vi.advanceTimersByTimeAsync(400);
  const unmatched = field(root, "unmatched");
  unmatched.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  while (held.length) held.shift()!();
  await vi.advanceTimersByTimeAsync(0);
  expect(unmatched.isConnected).toBe(false);
});

describe("with focus in a text field, Necto's web view sends a tap's mouseup before its mousedown — the click is not lost (Q2)", () => {
  /** The order measured in Necto 0.2.0: mouseup (detail 0) → mousedown a few ms later, and no click after it. */
  const invertedTap = (el: HTMLElement) => {
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 0, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1, clientX: 10, clientY: 10 }));
    (document.activeElement as HTMLElement | null)?.blur();
  };

  test("tapping '+ Condition' with focus in a query key field adds a row in one go", async () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    click(field(root, "add-query"));
    expect(document.activeElement).toBe(field(root, "query-key:0"));
    invertedTap(field(root, "add-query"));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelectorAll(".ml-query-row")).toHaveLength(2);
  });

  test("tapping the traffic tab with focus in the host field switches tabs in one go", async () => {
    const { root } = mount();
    field(root, "add-host").focus();
    invertedTap(field(root, "tab-traffic"));
    await vi.advanceTimersByTimeAsync(0);
    expect(field(root, "tab-traffic").getAttribute("aria-selected")).toBe("true");
  });

  test("treats a leading mouseup as the same tap when no press is active, even when its detail is not 0 (measured) — a row's ×", async () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    click(field(root, "add-query"));
    const remove = $(root, '[data-action="remove-query"]');
    remove.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1, clientX: 5, clientY: 5 }));
    remove.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1, clientX: 5, clientY: 5 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelectorAll(".ml-query-row")).toHaveLength(0);
  });

  test("a click in the usual order (mousedown → mouseup → click) happens only once", async () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const add = field(root, "add-query");
    add.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    add.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
    click(add);
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelectorAll(".ml-query-row")).toHaveLength(1);
  });

  test("even in the inverted order, pickers and text fields get no synthesized click, and a mousedown long after a stray mouseup is not a tap", async () => {
    const { root } = mount();
    click($(root, '[data-rule="a"] .ml-path'));
    const add = field(root, "add-query");
    add.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 0 }));
    await vi.advanceTimersByTimeAsync(1000);
    add.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelectorAll(".ml-query-row")).toHaveLength(0);
    const method = field(root, "method") as unknown as HTMLSelectElement;
    const changes = vi.fn();
    method.addEventListener("click", changes);
    invertedTap(method);
    const path = field(root, "path");
    path.addEventListener("click", changes);
    invertedTap(path);
    await vi.advanceTimersByTimeAsync(0);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe("the state that recognises inverted taps and presses stays consistent (T9C)", () => {
  /**
   * Clears a press (a mousedown without mouseup) and a leading mouseup left by earlier tests — the
   * same starting point as before the fix.
   */
  const settleTaps = () => {
    document.body.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        detail: 1,
        clientX: -500,
        clientY: -500,
      }),
    );
    vi.advanceTimersByTime(1000);
  };
  /**
   * A real time gap: advances the fake timers and Date.now together and checks they really moved
   * (so the gap does not fall back to 0 ms).
   */
  const wait = (ms: number) => {
    const from = Date.now();
    vi.advanceTimersByTime(ms);
    vi.setSystemTime(from + ms);
    expect(Date.now() - from).toBe(ms);
  };
  interface Tap { detail?: number; button?: number; ctrlKey?: boolean; gapMs?: number; down?: { x: number; y: number } }
  /** The order measured in Necto: mouseup → (a few ms) → mousedown, with no click. */
  const invertedTap = (el: HTMLElement, tap: Tap = {}) => {
    const { detail = 0, button = 0, ctrlKey = false, gapMs = 3, down = { x: 10, y: 10 } } = tap;
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button, ctrlKey, detail, clientX: 10, clientY: 10 }));
    wait(gapMs);
    el.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button,
        ctrlKey,
        detail: 1,
        clientX: down.x,
        clientY: down.y,
      }),
    );
  };
  const rows = (root: ParentNode) => root.querySelectorAll(".ml-query-row").length;
  /** Opens rule a with one condition row, with focus in that row's key field. */
  const withRow = () => {
    const mounted = mount();
    click($(mounted.root, '[data-rule="a"] .ml-path'));
    click(field(mounted.root, "add-query"));
    return mounted;
  };

  describe("C1: an inverted tap that moves to a text field does not hold back drawing", () => {
    test("Return after tapping from the path field to a query value field adds a row at once and moves focus to the new key field", async () => {
      settleTaps();
      const { root } = withRow();
      field(root, "path").focus();
      invertedTap(field(root, "query-value:0"));
      field(root, "query-value:0").focus();
      await vi.advanceTimersByTimeAsync(0);
      type(field(root, "query-key:0"), "page");
      type(field(root, "query-value:0"), "1");
      field(root, "query-value:0").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      expect(rows(root)).toBe(2);
      expect(document.activeElement).toBe(field(root, "query-key:1"));
    });

    test("Return after tapping from the path field to the '+ Host' field empties the field at once and keeps focus", async () => {
      settleTaps();
      const { root } = withRow();
      field(root, "path").focus();
      invertedTap(field(root, "add-host"));
      field(root, "add-host").focus();
      await vi.advanceTimersByTimeAsync(0);
      type(field(root, "add-host"), "api.example.com");
      field(root, "add-host").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      expect(field(root, "add-host").value).toBe("");
      expect(document.activeElement).toBe(field(root, "add-host"));
    });

    test("a button pressed with an inverted tap keeps its node until the synthesized click, so the click lands", async () => {
      settleTaps();
      const { root, view } = withRow();
      invertedTap(field(root, "add-query"));
      view.render(); // A redraw arriving mid-press (such as a save result)
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(2);
    });
  });

  describe("C2: a press whose mouseup never came does not block the next tap", () => {
    test("tapping '+ Condition' from a query key field after choosing a method in a picker (the popup takes the mouseup) adds a row", async () => {
      settleTaps();
      const { root } = withRow();
      field(root, "method").dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          detail: 1,
          clientX: 50,
          clientY: 50,
        }),
      );
      field(root, "query-key:0").focus();
      invertedTap(field(root, "add-query"), { detail: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(2);
    });

    test("tapping '+ Condition' works in one go after a right click too (the context menu takes the mouseup)", async () => {
      settleTaps();
      const { root } = withRow();
      const key = field(root, "query-key:0");
      key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2, detail: 1, clientX: 50, clientY: 50 }));
      key.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 50, clientY: 50 }));
      invertedTap(field(root, "add-query"), { detail: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(2);
    });

    test("a ctrl+click is a context menu action, so it does not remain as a press", async () => {
      settleTaps();
      const { root } = withRow();
      const key = field(root, "query-key:0");
      key.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: true,
          detail: 1,
          clientX: 50,
          clientY: 50,
        }),
      );
      invertedTap(field(root, "add-query"), { detail: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(2);
    });

    test("the next tap works in one go after pressing, leaving the window and releasing outside (the window loses focus)", async () => {
      settleTaps();
      const { root } = withRow();
      $(root, ".ml-editor").dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          detail: 1,
          clientX: 50,
          clientY: 50,
        }),
      );
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);
      invertedTap(field(root, "add-query"), { detail: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(2);
    });

    test("an inverted tap with ctrl held synthesizes no click", async () => {
      settleTaps();
      const { root } = withRow();
      invertedTap(field(root, "add-query"), { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(1);
    });
  });
  describe("C5: the inverted tap's time and distance thresholds are measured in real time and coordinates", () => {
    test.each([
      ["a 200 ms gap is the same tap", { gapMs: 200 }, 2],
      ["a 251 ms gap is a different action", { gapMs: 251 }, 1],
      ["a 3 px offset (horizontal and vertical) is the same tap", { down: { x: 13, y: 13 } }, 2],
      ["a horizontal 5 px offset is a different action", { down: { x: 15, y: 10 } }, 1],
      ["a vertical 5 px offset is a different action", { down: { x: 10, y: 15 } }, 1],
      ["the right button synthesizes no click", { button: 2 }, 1],
    ] as Array<[string, Tap, number]>)("%s", async (_, tap, expected) => {
      settleTaps();
      const { root } = withRow();
      invertedTap(field(root, "add-query"), tap);
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(expected);
    });

    test.each([
      ["a right mousedown after a left mouseup", 0, 2],
      ["a left mousedown after a right mouseup", 2, 0],
    ])("%s is not one tap and synthesizes no click", async (_, upButton, downButton) => {
      settleTaps();
      const { root } = withRow();
      const add = field(root, "add-query");
      add.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: upButton,
          detail: 0,
          clientX: 10,
          clientY: 10,
        }),
      );
      wait(3);
      add.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: downButton,
          detail: 1,
          clientX: 10,
          clientY: 10,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(root)).toBe(1);
    });
  });

  describe("C6: the other ways PressHold is released", () => {
    test("draws the deferred redraw at once when the window loses focus mid-press (released outside the window)", async () => {
      settleTaps();
      const { root, view } = mount();
      const tab = field(root, "tab-traffic");
      tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
      view.render();
      expect(tab.isConnected).toBe(true);
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);
      expect(tab.isConnected).toBe(false);
    });

    test("draws the deferred redraw afterwards when the synthesized click's handler does not draw", async () => {
      settleTaps();
      const { root, view } = mount();
      const caption = $(root, ".ml-add-host .necto-caption");
      invertedTap(caption);
      view.render();
      expect(caption.isConnected).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1); // A 0 ms timer set inside a timer fires 1 ms later on the fake clock
      expect(caption.isConnected).toBe(false);
    });
  });
});

describe("when the auth rule confirmation asks (D8)", () => {
  const auth = { ...rule("login"), tags: ["auth"] };

  test("without a mock session, turning off or deleting an auth rule sends at once without asking", async () => {
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([auth, rule("b")])), authMocked: false };
    const { root, model } = mount(api);
    click($(root, '[data-rule="login"] input[type=checkbox]'));
    await model.idle();
    expect(root.querySelector(".necto-dialog")).toBeNull();
    expect(lastWrite(api)).toMatchObject({
      op: "maplocal.rule.upsert",
      input: { rule: { id: "login", enabled: false } },
    });
    click($(root, '[data-rule="login"] .ml-path'));
    click($(root, '[data-action="delete-rule"]'));
    await model.idle();
    expect(root.querySelector(".necto-dialog")).toBeNull();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.delete", input: { id: "login" } });
  });

  test("turning on a disabled auth rule sends at once without asking, even with a mock session remaining", async () => {
    const api = new FakeAPI();
    api.current = { ...engineState(configuration([{ ...auth, enabled: false }])), authMocked: true };
    const { root, model } = mount(api);
    click($(root, '[data-rule="login"] input[type=checkbox]'));
    await model.idle();
    expect(root.querySelector(".necto-dialog")).toBeNull();
    expect(lastWrite(api)).toMatchObject({
      op: "maplocal.rule.upsert",
      input: { rule: { id: "login", enabled: true } },
    });
  });
});

describe("everything that could send a mocked token to the real server asks first, like turning off an auth rule", () => {
  const auth = { ...rule("login"), tags: ["auth"] };
  const session = (rules: Rule[], over: Partial<EngineState> = {}) => {
    const api = new FakeAPI();
    api.current = { ...engineState(configuration(rules)), authMocked: true, ...over };
    return api;
  };
  const masterSwitch = (root: HTMLElement) => $(root, '.ml-head button[role="switch"]');
  const hostRemove = (root: HTMLElement) => $(root, ".ml-head .ml-chip button");

  test("turning Map Local off with an auth rule on and a mocked session asks, sends nothing on cancel, and returns focus to the switch", async () => {
    const api = session([auth]);
    const { root, model } = mount(api);
    masterSwitch(root).focus();
    click(masterSwitch(root));
    expect($(root, ".necto-dialog").textContent).toContain("로그아웃");
    click($(root, '[data-dialog="cancel"]'));
    expect(api.writes).toHaveLength(0);
    expect(document.activeElement).toBe(masterSwitch(root));
    click(masterSwitch(root));
    click($(root, '[data-dialog="confirm"]'));
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.configuration.patch", input: { enabled: false } });
  });

  test("removing an allowed host an auth rule answers asks, and sends nothing on cancel", () => {
    const api = session([auth]);
    const { root } = mount(api);
    click(hostRemove(root));
    expect($(root, ".necto-dialog").textContent).toContain("로그아웃");
    click($(root, '[data-dialog="cancel"]'));
    expect(api.writes).toHaveLength(0);
  });

  test.each([
    ["no mocked session", [auth], { authMocked: false }],
    ["the auth rule is off", [{ ...auth, enabled: false }], {}],
    ["no auth rule", [rule("a")], {}],
    ["the auth rule answers another host", [{ ...auth, match: { ...auth.match, host: "other.invalid" } }], {}],
  ] as Array<[string, Rule[], Partial<EngineState>]>)("does not ask with %s", async (_name, rules, over) => {
    const api = session(rules, over);
    const { root, model } = mount(api);
    click(hostRemove(root));
    expect(root.querySelector(".necto-dialog")).toBeNull();
    click(masterSwitch(root));
    expect(root.querySelector(".necto-dialog")).toBeNull();
    await model.idle();
    expect(api.writes.map((w) => w.op)).toEqual(["maplocal.configuration.patch", "maplocal.configuration.patch"]);
  });

  test("turning Map Local on never asks", async () => {
    const api = session([auth], {});
    api.current = { ...api.current, configuration: { ...api.current.configuration, enabled: false } };
    const { root, model } = mount(api);
    click(masterSwitch(root));
    expect(root.querySelector(".necto-dialog")).toBeNull();
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ input: { enabled: true } });
  });

  test("[Turn on rule] on the traffic reason line asks for an auth rule, since its next login would be mocked", async () => {
    const off = { ...rule("login", "/a/{id}"), tags: ["auth"], enabled: false };
    const api = session([off], { authMocked: false });
    api.detailFor = (id) => networkDetail({ id });
    const m = mountTraffic(api);
    m.store.ingestNetwork([summary("1", "/a/3")]);
    click($(m.root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    click($(m.root, '[data-action="why-fix"]'));
    expect($(m.root, ".necto-dialog").textContent).toContain("인증 규칙");
    click($(m.root, '[data-dialog="cancel"]'));
    expect(api.writes).toHaveLength(0);
    click($(m.root, '[data-action="why-fix"]'));
    click($(m.root, '[data-dialog="confirm"]'));
    await m.model.idle();
    expect(lastWrite(api)).toMatchObject({ op: "maplocal.rule.upsert", input: { rule: { id: "login", enabled: true } } });
  });

  test("[Add to that rule and turn it on] asks for an auth rule, and adds nothing on cancel", async () => {
    const off = { ...rule("devices", "/a/{id}"), tags: ["auth"], enabled: false };
    const api = session([off], { authMocked: false });
    const { view, root, model } = mount(api);
    view.captureInto(trafficEntry(), networkDetail(), "/a/3", "devices", undefined, true);
    expect($(root, ".necto-dialog").textContent).toContain("인증 규칙");
    click($(root, '[data-dialog="cancel"]'));
    expect(api.writes).toHaveLength(0);
    view.captureInto(trafficEntry(), networkDetail(), "/a/3", "devices", undefined, true);
    click($(root, '[data-dialog="confirm"]'));
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ input: { rule: { id: "devices", enabled: true } } });
  });

  test("adding to an auth rule without turning it on does not ask", async () => {
    const off = { ...rule("devices", "/a/{id}"), tags: ["auth"], enabled: false };
    const api = session([off], { authMocked: false });
    const { view, root, model } = mount(api);
    view.captureInto(trafficEntry(), networkDetail(), "/a/3", "devices");
    expect(root.querySelector(".necto-dialog")).toBeNull();
    await model.idle();
    expect(lastWrite(api)).toMatchObject({ input: { rule: { id: "devices", enabled: false } } });
  });
});

describe("every write the panel sends ends the undo (D8)", () => {
  type M = ReturnType<typeof mountTraffic>;
  const select = (el: Element, value: string) => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const toRules = (m: M) => click($(m.root, '[data-tab="rules"]'));
  const toTraffic = (m: M) => click($(m.root, '[data-tab="traffic"]'));
  const cases: Array<
    [
      string,
      Partial<EngineState["configuration"]> & { observedHosts?: string[] },
      (m: M) => unknown,
    ]
  > = [
    ["allowed host chip ×", {}, (m) => click($(m.root, ".ml-head .ml-chip button"))],
    [
      "observed host '+ Host' chip",
      { observedHosts: ["dev.invalid"] },
      (m) => click($(m.root, '[data-add-host="dev.invalid"]')),
    ],
    ["Map Local on switch", {}, (m) => click($(m.root, 'button[role="switch"]'))],
    [
      "choosing requests without a rule",
      {},
      (m) => select($(m.root, '[data-field="unmatched"]'), "block"),
    ],
    [
      "typing into the '+ Host' field to add",
      {},
      (m) => {
        const input = $(m.root, '[data-field="add-host"]') as HTMLInputElement;
        input.focus();
        type(input, "typed.example.com");
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      },
    ],
    ["rule on checkbox", {}, (m) => click($(m.root, '[data-rule="b"] input[type=checkbox]'))],
    [
      "mock with an empty response from traffic (saveFromTraffic)",
      {},
      async (m) => {
        toTraffic(m);
        m.store.ingestNetwork([summary("1", "/gone")]);
        click($(m.root, '.ml-traffic-row[data-key="1"]'));
        await vi.runAllTimersAsync();
        click($(m.root, '[data-action="empty-rule"]'));
      },
    ],
    [
      "'Add to allowed hosts' on the traffic detail's reason line (allowHost)",
      { allowedHosts: [] },
      async (m) => {
        toTraffic(m);
        m.store.ingestNetwork([summary("1", "/a")]);
        click($(m.root, '.ml-traffic-row[data-key="1"]'));
        await vi.runAllTimersAsync();
        click($(m.root, '[data-why="hostNotAllowed"] [data-action="why-fix"]'));
      },
    ],
  ];

  test.each(cases)("%s", async (_name, over, act) => {
    const api = new FakeAPI();
    const { observedHosts, ...config } = over;
    api.current = {
      ...engineState({ ...configuration([rule("a"), rule("b")]), ...config }),
      observedHosts: observedHosts ?? [],
    };
    const m = mountTraffic(api);
    toRules(m);
    click($(m.root, '[data-rule="a"] .ml-path'));
    click($(m.root, '[data-action="delete-rule"]'));
    await m.model.idle();
    expect(m.root.querySelector('[data-notice="undo"]')).not.toBeNull();
    const before = api.writes.length;
    await act(m);
    await m.model.idle();
    expect(api.writes.length).toBeGreaterThan(before);
    expect(m.root.querySelector('[data-notice="undo"]')).toBeNull();
  });
});
