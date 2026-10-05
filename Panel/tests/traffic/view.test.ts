//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OrderDetector } from "../../src/traffic/order";
import { TrafficStore } from "../../src/traffic/store";
import { TrafficView, type TrafficDeps } from "../../src/traffic/view";
import css from "../../src/style.css?raw";
import type { NetworkDetail, NetworkSummary, RequestEvent, Rule } from "../../src/types";

const net = (id: string, at: number, path = "/a/1", host = "api.invalid"): NetworkSummary => ({
  id,
  method: "GET",
  url: `https://${host}${path}`,
  host,
  startedAtMilliseconds: at,
  state: "completed",
  statusCode: 200,
  durationMilliseconds: 12,
});

function mount(allowed: string[] = ["api.invalid"], over: Partial<TrafficDeps> = {}) {
  document.body.innerHTML = '<div id="t"></div>';
  const root = document.getElementById("t")!;
  const prefs = new Map<string, string>();
  let view!: TrafficView;
  const store = new TrafficStore(() => view?.refreshList());
  const deps: TrafficDeps = {
    store,
    order: new OrderDetector(),
    allowedHosts: () => allowed,
    isBlockedHost: () => false,
    addAllowedHost: vi.fn(),
    detail: vi.fn(async (id: string): Promise<NetworkDetail> => ({
      ...net(id, 0),
      requestHeaders: {},
      responseHeaders: {},
      responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
    })),
    networkAvailable: () => true,
    rules: () => [],
    capture: vi.fn(),
    emptyRule: vi.fn(),
    ruleForQuery: vi.fn(),
    unkept: () => undefined,
    removeCondition: vi.fn(),
    openRule: vi.fn(),
    captured: () => undefined,
    activate: vi.fn(),
    mapLocalEnabled: () => true,
    enableMapLocal: vi.fn(),
    enableRule: vi.fn(),
    prefs: { get: (k) => prefs.get(k), set: (k, v) => void prefs.set(k, v) },
    ...over,
  };
  view = new TrafficView(root, deps);
  view.render();
  return { root, store, deps, view, prefs };
}
const $ = (r: ParentNode, s: string) => r.querySelector(s) as HTMLElement;
const click = (el: Element | null) => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("starts in the endpoint view and remembers a changed view", () => {
  const { root, prefs } = mount();
  expect($(root, '[data-mode="endpoint"]').getAttribute("aria-pressed")).toBe("true");
  click($(root, '[data-mode="time"]'));
  expect(prefs.get("traffic.mode")).toBe("time");
});

test("the endpoint view keeps the row order when a new sample arrives in the same group", () => {
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
  const before = [...root.querySelectorAll(".ml-traffic-group")].map((e) => e.getAttribute("data-group"));
  store.ingestNetwork([net("3", 3, "/a/2")]);
  const after = [...root.querySelectorAll(".ml-traffic-group")].map((e) => e.getAttribute("data-group"));
  expect(after).toEqual(before);
});

test("the endpoint view updates the count and 'Recent' of the group that got a new sample, and draws no dot without visible meaning (U4)", () => {
  vi.setSystemTime(10_000);
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1_000, "/a/1"), net("2", 2_000, "/b")]);
  store.ingestNetwork([net("3", 10_000, "/a/2")]);
  const group = $(root, '.ml-traffic-group[data-group="GET api.invalid /a/{id}"]');
  expect($(group, '[data-cell="count"]').textContent).toBe("×2");
  expect(group.textContent).toContain("0초 전");
  expect(group.querySelector("[data-fresh], .ml-fresh")).toBeNull();
  expect(css).not.toContain(".ml-fresh");
});

describe("selecting in the time view keeps the list flowing", () => {
  test("a new request shows up, the selection stays, and the strip counts it with one way to the newest", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    expect(store.paused).toBe(false);
    expect(root.querySelector("[data-newer]")).toBeNull();
    store.ingestNetwork([net("2", 2)]);
    expect(store.paused).toBe(false);
    expect(root.querySelectorAll(".ml-traffic-row")).toHaveLength(2);
    expect($(root, '.ml-traffic-row[data-key="1"]').getAttribute("aria-selected")).toBe("true");
    expect($(root, ".ml-traffic-detail").dataset.key).toBe("1");
    expect($(root, "[data-newer]").textContent).toContain("고른 뒤 새 요청 1개");
    click($(root, '[data-newer] [data-action="show-newest"]'));
    expect($(root, '.ml-traffic-row[data-key="2"]').getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector("[data-newer]")).toBeNull();
  });

  test("the count is what the current filters would show", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    click($(root, '[data-chip="4xx"]'));
    store.ingestNetwork([{ ...net("1", 1), statusCode: 404 }]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    store.ingestNetwork([net("2", 2), { ...net("3", 3), statusCode: 404 }]);
    expect($(root, "[data-newer]").textContent).toContain("고른 뒤 새 요청 1개");
  });

  test("clearing the selection neither pauses nor resumes, and a pause the user made stays", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-action="deselect"]'));
    expect(store.paused).toBe(false);
    click($(root, '[data-action="pause"]'));
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-action="deselect"]'));
    expect(store.paused).toBe(true);
  });

  test("moving the selection keeps counting from the first one, since the rows above are still out of view", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1), net("2", 2)]);
    click($(root, '.ml-traffic-row[data-key="2"]'));
    store.ingestNetwork([net("3", 3), net("4", 4)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    expect($(root, "[data-newer]").textContent).toContain("고른 뒤 새 요청 2개");
    click($(root, '.ml-traffic-row[data-key="3"]'));
    expect($(root, "[data-newer]").textContent).toContain("고른 뒤 새 요청 1개");
  });

  test("switching views keeps the count, and counts what came while the other view showed", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    store.ingestNetwork([net("2", 2)]);
    click($(root, '[data-mode="time"]'));
    expect($(root, "[data-newer]").textContent).toContain("고른 뒤 새 요청 1개");
    click($(root, '[data-mode="endpoint"]'));
    store.ingestNetwork([net("3", 3)]);
    click($(root, '[data-mode="time"]'));
    expect($(root, "[data-newer]").textContent).toContain("고른 뒤 새 요청 2개");
  });

  test("requests that came during a pause, before the selection, are not counted as after it", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '[data-action="pause"]'));
    store.ingestNetwork([net("2", 2)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-pause-strip] [data-action="resume"]'));
    expect(root.querySelector("[data-newer]")).toBeNull();
  });

  test("while paused the strip says so, with Resume, whatever came after the selection", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    store.ingestNetwork([net("2", 2)]);
    click($(root, '[data-action="pause"]'));
    expect(root.querySelector("[data-newer]")).toBeNull();
    expect($(root, "[data-pause-strip] [data-action=\"resume\"]")).not.toBeNull();
  });

  test("keyboard focus on 'Show newest' survives an arrival, and after it the list has focus", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    store.ingestNetwork([net("2", 2)]);
    $(root, '[data-newer] [data-action="show-newest"]').focus();
    store.ingestNetwork([net("3", 3)]);
    const focused = document.activeElement as HTMLElement;
    expect(focused.dataset.action).toBe("show-newest");
    click(focused);
    expect(document.activeElement).toBe($(root, '[role="listbox"]'));
  });

  test("keyboard focus on the strip's Resume survives an arrival, and after it the list has focus", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    click($(root, '[data-action="pause"]'));
    store.ingestNetwork([net("1", 1)]);
    $(root, '[data-pause-strip] [data-action="resume"]').focus();
    store.ingestNetwork([net("2", 2)]);
    const focused = document.activeElement as HTMLElement;
    expect(focused.closest("[data-pause-strip]")).not.toBeNull();
    click(focused);
    expect(document.activeElement).toBe($(root, '[role="listbox"]'));
  });

  test("the endpoint view, where rows keep their places, shows no count", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, '.ml-traffic-group'));
    store.ingestNetwork([net("2", 2, "/b")]);
    expect(root.querySelector("[data-newer]")).toBeNull();
  });
});

describe("pause banner", () => {
  const pairedOurs = (seq: number, at: number, path: string): RequestEvent =>
    ({ seq, date: at + 1, method: "GET", host: "api.invalid", path, query: {}, outcome: { passthrough: {} } });

  test("the banner sits right above the list and counts 30 requests (Necto records plus ours) as 30", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    click($(root, '[data-action="pause"]'));
    const strip = $(root, "[data-pause-strip]");
    expect(strip.nextElementSibling?.classList.contains("ml-traffic-list")).toBe(true);
    for (let i = 0; i < 30; i++) {
      store.ingestNetwork([net(`n${i}`, 10_000 + i * 1000, `/p${i}`)]);
      store.ingestOurs([pairedOurs(i + 1, 10_000 + i * 1000, `/p${i}`)]);
    }
    expect($(root, "[data-pause-strip]").textContent).toContain("새 요청 30개");
    click($(root, '[data-pause-strip] [data-action="resume"]'));
    expect(root.querySelectorAll(".ml-traffic-row")).toHaveLength(30);
    expect(store.paused).toBe(false);
  });

  test("N is the number of rows that resuming would newly show under the current filter", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    click($(root, '[data-chip="4xx"]'));
    click($(root, '[data-action="pause"]'));
    store.ingestNetwork([net("1", 1), { ...net("2", 2), statusCode: 404 }, net("3", 3, "/a/1", "other.invalid")]);
    expect($(root, "[data-pause-strip]").textContent).toContain("새 요청 1개");
    const before = root.querySelectorAll(".ml-traffic-row").length;
    click($(root, '[data-pause-strip] [data-action="resume"]'));
    expect(root.querySelectorAll(".ml-traffic-row").length - before).toBe(1);
  });

  test("in the endpoint view, calls to an existing group count as new requests too", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, '[data-action="pause"]'));
    store.ingestNetwork([net("2", 2, "/a/2"), net("3", 3, "/a/3")]);
    expect($(root, "[data-pause-strip]").textContent).toContain("새 요청 2개");
    click($(root, '[data-pause-strip] [data-action="resume"]'));
    expect($(root, ".ml-traffic-group").textContent).toContain("×3");
  });

  test("reads 'No new requests' when nothing arrived", () => {
    const { root } = mount();
    click($(root, '[data-action="pause"]'));
    expect($(root, "[data-pause-strip]").textContent).toContain("새 요청 없음");
  });

});

test("Esc and clicking the same row again also clear the selection", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(root.querySelector('[aria-selected="true"]')).toBeNull();
  click($(root, '.ml-traffic-row[data-key="1"]'));
  click($(root, '.ml-traffic-row[data-key="1"]'));
  expect(root.querySelector('[aria-selected="true"]')).toBeNull();
});

test("changing the view keeps the selected request — in the endpoint view its group is selected and the sample is that request", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  click($(root, '[data-mode="endpoint"]'));
  expect($(root, '.ml-traffic-group[aria-selected="true"]').getAttribute("data-group")).toBe("GET api.invalid /a/{id}");
  expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
  expect($(root, ".ml-sample-nav").textContent).toContain("2/2");
});

test("the pager states its direction in words — 'Newest ‹ 1/2 › Older'", () => {
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
  click($(root, ".ml-traffic-group"));
  expect($(root, ".ml-sample-nav").textContent!.replace(/\s+/g, " ").trim()).toBe("최신 ‹ 1/2 › 이전");
  expect($(root, '[data-action="newer"]').getAttribute("title")).toContain("최신");
  expect($(root, '[data-action="older"]').getAttribute("title")).toContain("이전");
});

describe("the detail follows the newest call", () => {
  test("with a group selected, a new call in the same group moves the detail to the newest call", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
    click($(root, ".ml-traffic-group"));
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("2");
    store.ingestNetwork([net("3", 3, "/a/3")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("3");
    expect($(root, ".ml-sample-nav").textContent).toContain("1/3");
    expect(root.querySelector("[data-new-sample]")).toBeNull();
    expect($(root, '.ml-traffic-group[aria-selected="true"]').getAttribute("data-group")).toBe(
      "GET api.invalid /a/{id}",
    );
  });

  test("a call to another group does not move the detail", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
    click($(root, '.ml-traffic-group[data-group="GET api.invalid /a/{id}"]'));
    store.ingestNetwork([net("3", 3, "/b")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
  });

  test("while paging through older calls it stays and shows 'New calls [Show newest]', which jumps to the newest and follows again", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
    click($(root, ".ml-traffic-group"));
    click($(root, '[data-action="older"]'));
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
    expect(root.querySelector("[data-new-sample]")).toBeNull();
    store.ingestNetwork([net("3", 3, "/a/3")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
    expect($(root, ".ml-sample-nav").textContent).toContain("3/3");
    expect($(root, "[data-new-sample]").textContent).toContain("새 호출 있음");
    click($(root, '[data-action="latest"]'));
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("3");
    expect(root.querySelector("[data-new-sample]")).toBeNull();
    store.ingestNetwork([net("4", 4, "/a/4")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("4");
    click($(root, ".ml-traffic-group"));
    expect(root.querySelector('[aria-selected="true"]')).toBeNull();
  });

  test("follows again after paging back to the newest with ‹", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
    click($(root, ".ml-traffic-group"));
    click($(root, '[data-action="older"]'));
    click($(root, '[data-action="newer"]'));
    store.ingestNetwork([net("3", 3, "/a/3")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("3");
  });

  test("does not follow when switching to the endpoint view with an older call selected in the time view", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-mode="endpoint"]'));
    store.ingestNetwork([net("3", 3, "/a/3")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
    expect($(root, "[data-new-sample]")).not.toBeNull();
  });

  test("the detail does not jump on switching to the endpoint view when newer calls arrived in the time view, even with the newest selected there", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    store.ingestNetwork([net("2", 2, "/a/2")]);
    click($(root, '[data-mode="endpoint"]'));
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
    expect($(root, "[data-new-sample]")).not.toBeNull();
    click($(root, '[data-action="latest"]'));
    store.ingestNetwork([net("3", 3, "/a/3")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("3");
  });

  test("the time view stays on the selected request while the list flows", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    store.ingestNetwork([net("2", 2, "/a/2")]);
    expect(store.paused).toBe(false);
    expect(root.querySelector('.ml-traffic-row[data-key="2"]')).not.toBeNull();
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
  });

  test("does not follow while the user paused, and goes to the newest on resume", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, ".ml-traffic-group"));
    click($(root, '[data-action="pause"]'));
    store.ingestNetwork([net("2", 2, "/a/2")]);
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
    click($(root, '[data-pause-strip] [data-action="resume"]'));
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("2");
  });
});

test("the sample being paged through is not dropped beyond the retention cap", () => {
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
  click($(root, ".ml-traffic-group"));
  click($(root, '[data-action="older"]'));
  store.ingestNetwork(Array.from({ length: TrafficStore.capacity + 100 }, (_, i) => net(`f${i}`, 100 + i, `/f/${i}`)));
  expect(store.entries().some((e) => e.key === "1")).toBe(true);
  expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
});

test("a selected request filtered out by search leaves the list (filters apply strictly), and the detail stays open and says it is hidden (U5)", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1, "/a/1")]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  const search = $(root, '[data-field="traffic-search"]') as HTMLInputElement;
  search.value = "zzz";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(root.querySelectorAll(".ml-traffic-row")).toHaveLength(0);
  expect(root.querySelector('tr[data-filtered-out="true"], tr[data-filtered-out=""]')).toBeNull();
  expect(root.textContent).not.toContain("필터로 숨겨짐");
  expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
  expect($(root, ".ml-traffic-detail [data-hidden-note]").textContent).toContain("지금 필터에 맞지 않아 목록에서 숨겨졌습니다");
});

test("searching by query in the time view leaves only the requests that sent it", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([
    net("1", 1, "/api/sites?page=1"),
    net("2", 2, "/api/sites?page=2&siteId=101"),
    net("3", 3, "/api/other"),
  ]);
  const search = $(root, '[data-field="traffic-search"]') as HTMLInputElement;
  search.value = "page=2";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect([...root.querySelectorAll(".ml-traffic-row")].map((e) => e.getAttribute("data-key"))).toEqual(["2"]);
  search.value = "siteId=101";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect([...root.querySelectorAll(".ml-traffic-row")].map((e) => e.getAttribute("data-key"))).toEqual(["2"]);
});

test("searching by query in the endpoint view leaves only the groups with a call that sent it", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="endpoint"]'));
  store.ingestNetwork([
    net("1", 1, "/api/sites?page=1"),
    net("2", 2, "/api/sites?page=2"),
    net("3", 3, "/api/other?page=1"),
  ]);
  const search = $(root, '[data-field="traffic-search"]') as HTMLInputElement;
  search.value = "page=2";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(
    [...root.querySelectorAll(".ml-traffic-group")].map((e) => e.getAttribute("data-group")),
  ).toEqual(["GET api.invalid /api/sites"]);
  search.value = "page=9";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(0);
});

test("chips of the same kind filter with OR", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1), { ...net("2", 2), statusCode: 404 }, { ...net("3", 3), statusCode: 500 }]);
  click($(root, '[data-chip="4xx"]'));
  click($(root, '[data-chip="5xx"]'));
  expect([...root.querySelectorAll(".ml-traffic-row")].map((e) => e.getAttribute("data-key"))).toEqual(["3", "2"]);
  expect($(root, '[data-chip="4xx"]').getAttribute("aria-pressed")).toBe("true");
});

test("'Allowed hosts only' is off and disabled without allowed hosts, and shows the hidden count when there are some", () => {
  const empty = mount([]);
  const box = $(empty.root, '[data-field="allowed-only"]') as HTMLInputElement;
  expect(box.disabled).toBe(true);
  expect(box.checked).toBe(false);
  expect(empty.root.textContent).toContain("허용 호스트가 없어 전체를 보여 줍니다");
  const { root, store } = mount(["api.invalid"]);
  store.ingestNetwork([net("1", 1), net("2", 2, "/x", "firebase.invalid")]);
  expect($(root, "[data-hidden-count]").textContent).toContain("1");
  click($(root, "[data-hidden-count]"));
  expect(($(root, '[data-field="allowed-only"]') as HTMLInputElement).checked).toBe(false);
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(2);
});

test("the pause snapshot does not jump on renders outside the list (state events)", () => {
  const { root, store, view } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '[data-action="pause"]'));
  store.ingestNetwork([net("2", 2)]);
  view.render();
  expect(root.querySelectorAll(".ml-traffic-row")).toHaveLength(1);
  click($(root, '[data-action="resume"]'));
  expect(root.querySelectorAll(".ml-traffic-row")).toHaveLength(2);
});

test("fetches the detail on selection, collapses the headers and shows the JSON body formatted", async () => {
  const { root, store, deps } = mount(["api.invalid"], {
    detail: vi.fn(async (id: string) => ({
      ...net(id, 0),
      requestHeaders: { Accept: "*/*" },
      responseHeaders: { "X-Map-Local": "devices/ok" },
      responseBody: { byteCount: 9, isTruncated: true, text: '{"a":1}' },
    })),
  });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect(deps.detail).toHaveBeenCalledWith("1");
  const detail = $(root, ".ml-traffic-detail");
  expect(detail.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect(detail.querySelector(".ml-body")?.textContent).toBe('{\n  "a": 1\n}');
  expect(detail.textContent).toContain("일부만 표시");
  expect(detail.textContent).toContain("devices/ok");
  expect(detail.querySelector(".ml-capture")).not.toBeNull();
});

test("shows Necto's unavailableReason as-is beside the hint when the network plugin is missing", async () => {
  const reason = "The selected app does not provide this operation";
  const missing = mount(["api.invalid"], { networkAvailable: () => false, networkUnavailableReason: () => reason });
  missing.store.ingestNetwork([net("1", 1)]);
  click($(missing.root, ".ml-traffic-group"));
  await vi.runAllTimersAsync();
  const detail = $(missing.root, ".ml-traffic-detail").textContent ?? "";
  expect(detail).toContain(reason);
  expect(detail).toContain("URLSessionNetworkPlugin");
});

test("when the detail cannot be fetched, tells a missing plugin apart from a deleted record", async () => {
  const missing = mount(["api.invalid"], { networkAvailable: () => false });
  missing.store.ingestNetwork([net("1", 1)]);
  click($(missing.root, ".ml-traffic-group"));
  await vi.runAllTimersAsync();
  expect(missing.deps.detail).not.toHaveBeenCalled();
  expect($(missing.root, ".ml-traffic-detail").textContent).toContain("URLSessionNetworkPlugin");

  const gone = mount(["api.invalid"], { detail: vi.fn(async () => { throw new Error("notFound"); }) });
  gone.store.ingestNetwork([net("1", 1)]);
  click($(gone.root, ".ml-traffic-group"));
  await vi.runAllTimersAsync();
  expect($(gone.root, ".ml-traffic-detail").textContent).toContain("이 기록은 앱에서 지워졌습니다(앱 재실행·보관 상한)");
});

test("after one failed fetch, selecting again fetches and shows the detail, and capture works", async () => {
  let fail = true;
  const detail = vi.fn(async (id: string): Promise<NetworkDetail> => {
    if (fail) throw new Error("bridge");
    return {
      ...net(id, 0),
      requestHeaders: {},
      responseHeaders: {},
      responseBody: { byteCount: 7, isTruncated: false, text: '{"a":1}' },
    };
  });
  const { root, store } = mount(["api.invalid"], { detail });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect($(root, ".ml-traffic-detail").textContent).toContain("이 기록은 앱에서 지워졌습니다");
  expect(detail).toHaveBeenCalledTimes(1);
  fail = false;
  click($(root, '[data-action="deselect"]'));
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect(detail).toHaveBeenCalledTimes(2);
  expect($(root, ".ml-traffic-detail .ml-body")?.textContent).toBe('{\n  "a": 1\n}');
  expect(($(root, '[data-action="capture"]') as HTMLButtonElement).disabled).toBe(false);
});

test("an app relaunch clears the selected request, so the new launch's record with the same number does not show as selected", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.reset("launch-1");
  store.ingestOurs([mocked(7, 1, "/old")]);
  click($(root, '.ml-traffic-row[data-key="ours:7"]'));
  expect($(root, '.ml-traffic-detail').getAttribute("data-key")).toBe("ours:7");
  store.reset("launch-2");
  store.ingestOurs([mocked(7, 2, "/new")]);
  expect(root.querySelector('[aria-selected="true"]')).toBeNull();
  expect($(root, ".ml-traffic-detail").hidden).toBe(true);
  expect($(root, ".ml-traffic-main").dataset.detail).toBe("closed");
  expect(root.querySelectorAll(".ml-traffic-row")).toHaveLength(1);
  expect(root.querySelector('[data-action="resume"]')).toBeNull();
});

test("drops a detail from the previous launch that arrives after the relaunch, and fetches the new launch's same id afresh", async () => {
  const pending: Array<(d: NetworkDetail) => void> = [];
  const detail = vi.fn((id: string) => new Promise<NetworkDetail>((resolve) => { pending.push(resolve); void id; }));
  const { root, store } = mount(["api.invalid"], { detail });
  const body = (text: string): NetworkDetail => ({
    ...net("1", 1),
    requestHeaders: {},
    responseHeaders: { "X-Map-Local": "old/rule" },
    responseBody: { byteCount: text.length, isTruncated: false, text },
  });
  click($(root, '[data-mode="time"]'));
  store.reset("launch-1");
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  expect(detail).toHaveBeenCalledTimes(1);
  store.reset("launch-2");
  store.ingestNetwork([net("1", 1)]);
  pending[0](body('"old"'));
  await vi.runAllTimersAsync();
  expect(store.entries()[0].result).toBe("unknown");
  click($(root, '.ml-traffic-row[data-key="1"]'));
  expect(detail).toHaveBeenCalledTimes(2);
  pending[1]({ ...body('"new"'), responseHeaders: {} });
  await vi.runAllTimersAsync();
  expect($(root, ".ml-traffic-detail .ml-body")?.textContent).toBe('"new"');
});

test("mocking a request outside the allowed hosts says, right under its button, that it allows the host too, with no separate step to take first", async () => {
  const { root, store } = mount(["api.invalid"]);
  click($(root, '[data-mode="time"]'));
  click($(root, '[data-field="allowed-only"]'));
  store.ingestNetwork([net("1", 1), net("2", 2, "/x", "cdn.invalid")]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect(root.querySelector(".ml-traffic-detail [data-host-note]")).toBeNull();
  click($(root, '.ml-traffic-row[data-key="2"]'));
  expect(root.querySelector('.ml-traffic-detail [data-action="allow-host"]')).toBeNull();
  const note = $(root, ".ml-traffic-detail .ml-capture [data-host-note]");
  expect(note.textContent).toBe("목업하면 cdn.invalid 호스트도 허용 호스트에 추가합니다");
  expect(note.previousElementSibling?.getAttribute("data-action")).toBe("capture");
});

test("rows have no 'Add to allowed hosts', and a request outside the allowed hosts shows its host dimmed with the reason in the title", () => {
  const { root, store } = mount(["api.invalid"]);
  click($(root, '[data-field="allowed-only"]'));
  store.ingestNetwork([net("1", 1), net("2", 2, "/x", "cdn.invalid")]);
  for (const mode of ["endpoint", "time"]) {
    click($(root, `[data-mode="${mode}"]`));
    expect(root.querySelector('.ml-traffic-list [data-action="allow-host"]')).toBeNull();
    const off = root.querySelectorAll(".ml-traffic-list .ml-req-host-off");
    expect(off).toHaveLength(1);
    expect(off[0].textContent).toBe("cdn.invalid");
    expect((off[0] as HTMLElement).title).toBe("허용 호스트가 아니라 목업·차단이 적용되지 않습니다");
    // With a single allowed host, allowed rows do not show the host separately
    expect(root.querySelectorAll(".ml-traffic-list .ml-req-host")).toHaveLength(1);
  }
});

test("group rows have no active response picker — the response in use is chosen in one place, the rule editor's tabs", () => {
  const devices: Rule = {
    id: "devices",
    match: { method: "GET", path: "/a/{id}" },
    active: "ok",
    responses: { ok: {}, empty: {} },
  };
  const { root, store } = mount(["api.invalid"], { rules: () => [devices] });
  store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
  store.ingestOurs([
    {
      seq: 1,
      date: 1,
      method: "GET",
      host: "api.invalid",
      path: "/a/1",
      query: {},
      outcome: { mocked: { rule: "devices", response: "ok" } },
    },
    {
      seq: 2,
      date: 2,
      method: "GET",
      host: "api.invalid",
      path: "/a/2",
      query: {},
      outcome: { mocked: { rule: "devices", response: "ok" } },
    },
  ]);
  expect(root.querySelector(".ml-traffic-list select")).toBeNull();
});

test("shows the warning banner when the registration-order warning holds", () => {
  vi.setSystemTime(0);
  const { root, deps, view } = mount();
  deps.order.networkStarted();
  vi.setSystemTime(2000); // After the grace period that follows the subscription
  for (const [i, at] of [
    [1, 100],
    [2, 200],
    [3, 300],
  ])
    deps.order.liveOurs({
      seq: i,
      date: at,
      method: "GET",
      host: "api.invalid",
      path: "/m",
      query: {},
      outcome: { mocked: { rule: "r", response: "ok" } },
    });
  vi.setSystemTime(5000);
  view.render();
  expect($(root, '[data-warning="order"]')).not.toBeNull();
});

test("the detail updates in place when a pending request selected in the time view finishes, even while paused", async () => {
  const { root, store, deps } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([{ ...net("1", 1), state: "pending", statusCode: undefined }]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  click($(root, '[data-action="pause"]'));
  expect($(root, ".ml-traffic-detail").textContent).toContain("응답을 기다리는 중…");
  store.ingestNetwork([net("1", 1)]);
  await vi.runAllTimersAsync();
  expect(store.paused).toBe(true);
  expect(deps.detail).toHaveBeenCalledWith("1");
  expect($(root, ".ml-traffic-detail").textContent).not.toContain("응답을 기다리는 중…");
});

test("unchanged row nodes stay when a request arrives in another group", () => {
  const { root, store } = mount(["api.invalid"]);
  store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
  store.ingestOurs([
    {
      seq: 1,
      date: 1,
      method: "GET",
      host: "api.invalid",
      path: "/a/1",
      query: {},
      outcome: { mocked: { rule: "devices", response: "ok" } },
    },
  ]);
  const groupA = $(root, '.ml-traffic-group[data-group="GET api.invalid /a/{id}"]');
  store.ingestNetwork([net("3", 3, "/b")]);
  expect($(root, '.ml-traffic-group[data-group="GET api.invalid /a/{id}"]')).toBe(groupA);
  expect($(root, '.ml-traffic-group[data-group="GET api.invalid /b"]').textContent).toContain("×2");
});

test("the time view does not rebuild existing row nodes when a new request arrives", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  const first = $(root, '.ml-traffic-row[data-key="1"]');
  store.ingestNetwork([net("2", 2)]);
  expect($(root, '.ml-traffic-row[data-key="1"]')).toBe(first);
  expect([...root.querySelectorAll(".ml-traffic-row")].map((e) => e.getAttribute("data-key"))).toEqual(["2", "1"]);
});

const mocked = (seq: number, date: number, path = "/m"): RequestEvent => ({
  seq,
  date,
  method: "GET",
  host: "api.invalid",
  path,
  query: {},
  outcome: { mocked: { rule: "r", response: "ok" } },
});

test("the banner appears without an explicit redraw when the registration-order warning holds after mounting", () => {
  vi.setSystemTime(10_000);
  const { root, store, deps } = mount();
  deps.order.networkStarted();
  vi.setSystemTime(12_000); // After the grace period that follows the subscription
  for (const i of [1, 2, 3]) {
    deps.order.liveOurs(mocked(i, 10_000 + i));
    store.ingestOurs([mocked(i, 10_000 + i)]);
  }
  expect(root.querySelector('[data-warning="order"]')).toBeNull();
  vi.advanceTimersByTime(1500);
  expect(root.querySelector('[data-warning="order"]')).not.toBeNull();
});

test("the detail's capture button uses the plan's wording, and when blocked it is disabled with the reason in a tooltip", async () => {
  const { root, store, deps } = mount(["api.invalid"], {
    detail: vi.fn(async (id: string): Promise<NetworkDetail> => ({
      ...net(id, 0),
      statusCode: 421,
      requestHeaders: {},
      responseHeaders: { "X-Map-Local": "unmocked" },
      responseBody: { byteCount: 0, isTruncated: false },
    })),
  });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  store.ingestOurs([
    {
      seq: 1,
      date: 2,
      method: "GET",
      host: "api.invalid",
      path: "/a/1",
      query: {},
      outcome: { unmocked: { status: 421 } },
    },
  ]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  const button = $(root, '[data-action="capture"]') as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.title).toContain("막은 요청");
  click(button);
  expect(deps.capture).not.toHaveBeenCalled();
});

test("the capture button reads 'Mock with this response' without a target rule and 'Add this response to the rule' with one (K1), names the target rule in its title, and captures the visible request and detail", async () => {
  const devices: Rule = {
    id: "devices",
    match: { method: "GET", path: "/a/{id}" },
    active: "ok",
    responses: { ok: { status: 200 } },
  };
  let rules: Rule[] = [];
  const { root, store, deps, view } = mount(["api.invalid"], { rules: () => rules });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect($(root, '[data-action="capture"]').textContent).toBe("이 응답으로 목업");
  click($(root, '[data-action="capture"]'));
  expect(deps.capture).toHaveBeenCalledWith(
    expect.objectContaining({ key: "1", path: "/a/1" }),
    expect.objectContaining({ id: "1", responseBody: expect.objectContaining({ text: "{}" }) }),
    "/a/1",
    undefined,
  );
  rules = [devices];
  view.update();
  expect($(root, '[data-action="capture"]').textContent).toBe("이 응답을 규칙에 추가");
  expect($(root, '[data-action="capture"]').title).toBe("GET /a/{id} 규칙에 응답으로 더합니다");
});

describe("the 'Only for this query' checkbox", () => {
  const withQuery = (id: string, at: number, path: string) => net(id, at, path);
  const open = async (over: Partial<TrafficDeps> = {}, path = "/api/sites?page=2&siteId=101") => {
    const m = mount(["api.invalid"], {
      detail: vi.fn(async (id: string): Promise<NetworkDetail> => ({
        ...net(id, 0, path),
        requestHeaders: {},
        responseHeaders: {},
        responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
      })),
      ...over,
    });
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork([withQuery("1", 1, path)]);
    click($(m.root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    return m;
  };

  test("shows only for requests with a query, is off by default and shows the query in its label", async () => {
    const { root } = await open();
    const box = $(root, '[data-field="capture-query"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.getAttribute("tabindex")).toBe("0");
    expect(box.closest("label")!.textContent).toBe("이 쿼리일 때만 (page=2&siteId=101)");
    const plain = await open({}, "/api/sites");
    expect(plain.root.querySelector('[data-field="capture-query"]')).toBeNull();
  });

  test("capturing with it off passes no query, and with it on passes the request's query", async () => {
    const { root, deps } = await open();
    click($(root, '[data-action="capture"]'));
    expect(deps.capture).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), "/api/sites", undefined);
    click($(root, '[data-field="capture-query"]'));
    expect(($(root, '[data-field="capture-query"]') as HTMLInputElement).checked).toBe(true);
    click($(root, '[data-action="capture"]'));
    expect(deps.capture).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "/api/sites",
      undefined,
      { page: "2", siteId: "101" },
    );
  });

  test("is hidden when adding a response to a matching rule — no new rule is made", async () => {
    const r: Rule = {
      id: "sites",
      match: { method: "GET", path: "/api/sites" },
      active: "ok",
      responses: { ok: { status: 200 } },
    };
    const { root } = await open({ rules: () => [r] });
    expect($(root, '[data-action="capture"]').textContent).toBe("이 응답을 규칙에 추가");
    expect(root.querySelector('[data-field="capture-query"]')).toBeNull();
  });

  test("passes the query when on for an empty response too", async () => {
    const emptyRule = vi.fn();
    const { root } = await open({ networkAvailable: () => false, emptyRule });
    click($(root, '[data-field="capture-query"]'));
    click($(root, '[data-action="empty-rule"]'));
    expect(emptyRule).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "1" }),
      "/api/sites",
      { page: "2", siteId: "101" },
    );
  });
});

test("the path to create defaults to the actual path, and choosing a template previews other paths it would catch", async () => {
  const { root, store, deps, view } = mount(["api.invalid"], {
    detail: vi.fn(async (id: string): Promise<NetworkDetail> => ({
      ...net(id, 0, "/devices/3"),
      requestHeaders: {},
      responseHeaders: {},
      responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
    })),
  });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1, "/devices/3"), net("2", 2, "/devices/summary")]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  const path = $(root, '[data-field="capture-path"]') as HTMLSelectElement;
  expect(path.value).toBe("/devices/3");
  expect(root.querySelector("[data-capture-preview]")).toBeNull();
  path.value = "/devices/{id}";
  path.dispatchEvent(new Event("change", { bubbles: true }));
  expect($(root, "[data-capture-preview]").textContent).toContain("/devices/summary");
  view.update();
  expect(($(root, '[data-field="capture-path"]') as HTMLSelectElement).value).toBe("/devices/{id}");
  click($(root, '[data-action="capture"]'));
  expect(deps.capture).toHaveBeenCalledWith(expect.anything(), expect.anything(), "/devices/{id}", undefined);
});

test("opens the rule instead of capturing for a mocked response", async () => {
  const { root, store, deps } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  store.ingestOurs([
    {
      seq: 1,
      date: 2,
      method: "GET",
      host: "api.invalid",
      path: "/a/1",
      query: {},
      outcome: { mocked: { rule: "devices", response: "ok" } },
    },
  ]);
  deps.detail = vi.fn(async (id: string): Promise<NetworkDetail> => ({
    ...net(id, 0),
    requestHeaders: {},
    responseHeaders: { "X-Map-Local": "devices/ok" },
  }));
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  expect(root.querySelector('[data-action="capture"]')).toBeNull();
  click($(root, '[data-action="open-rule"]'));
  expect(deps.openRule).toHaveBeenCalledWith("devices", "ok");
});

describe("a request mocked by a rule for every query can get a rule for its own query", () => {
  const ordersRule = (query?: Record<string, string>): Rule => ({
    id: "orders",
    enabled: true,
    tags: [],
    match: { method: "GET", path: "/api/orders", ...(query ? { query } : {}) },
    active: "ok",
    responses: { ok: { status: 200 } },
  });
  const pageTwo = (query: Record<string, string> = { page: "2" }): RequestEvent => ({
    seq: 1,
    date: 1000,
    method: "GET",
    host: "api.invalid",
    path: "/api/orders",
    query,
    outcome: { mocked: { rule: "orders", response: "ok", status: 200 } },
  });
  const open = async (over: Partial<TrafficDeps>, event: RequestEvent) => {
    const m = mount(["api.invalid"], over);
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestOurs([event]);
    click($(m.root, '.ml-traffic-row[data-key="ours:1"]'));
    await vi.runAllTimersAsync();
    return m;
  };

  test("offers it beside Open rule when the request has a query key the rule doesn't check, and makes it from that rule", async () => {
    const ruleForQuery = vi.fn();
    const { root } = await open({ rules: () => [ordersRule()], ruleForQuery }, pageTwo());
    expect($(root, ".ml-capture [data-primary]").getAttribute("data-action")).toBe("open-rule");
    const button = $(root, '[data-action="rule-for-query"]');
    expect(button.textContent).toBe("이 쿼리 전용 규칙 (page=2)");
    click(button);
    expect(ruleForQuery).toHaveBeenCalledWith(expect.objectContaining({ query: { page: "2" } }), "orders");
  });

  test("offers it when the rule checks some of the request's keys but not all", async () => {
    const { root } = await open(
      { rules: () => [ordersRule({ page: "2" })], ruleForQuery: vi.fn() },
      pageTwo({ page: "2", sort: "new" }),
    );
    expect($(root, '[data-action="rule-for-query"]').textContent).toBe("이 쿼리 전용 규칙 (page=2&sort=new)");
  });

  test.each([
    ["the rule already checks every key", ordersRule({ page: "2" }), { page: "2" }],
    ["the request has no query", ordersRule(), {}],
    ["the rule is off now", { ...ordersRule(), enabled: false }, { page: "2" }],
    ["the rule's path changed since", { ...ordersRule(), match: { method: "GET", path: "/api/orders/{id}" } }, { page: "2" }],
  ])("doesn't offer it when %s", async (_n, rule, query) => {
    const { root } = await open({ rules: () => [rule], ruleForQuery: vi.fn() }, pageTwo(query));
    expect(root.querySelector('[data-action="rule-for-query"]')).toBeNull();
  });

  test("a response captured into the rule that answered is no reason to hide it", async () => {
    const { root } = await open(
      {
        rules: () => [ordersRule()],
        ruleForQuery: vi.fn(),
        captured: () => ({ rule: "orders", response: "ok", applies: true }),
      },
      pageTwo(),
    );
    expect(root.querySelector('[data-action="rule-for-query"]')).not.toBeNull();
  });

  test("once made, says so and opens the new rule, while the request still shows the old rule's mock", async () => {
    const openRule = vi.fn();
    const { root } = await open(
      {
        rules: () => [ordersRule()],
        ruleForQuery: vi.fn(),
        captured: () => ({ rule: "orders-page-2", response: "ok", applies: true }),
        openRule,
      },
      pageTwo(),
    );
    expect(root.querySelector('[data-action="rule-for-query"]')).toBeNull();
    expect($(root, ".ml-capture").textContent).toContain("다음 요청부터 적용됩니다");
    click($(root, '[data-action="open-rule"]'));
    expect(openRule).toHaveBeenCalledWith("orders-page-2", "ok");
  });
});

describe("a rule made from traffic that then doesn't answer says why, beside the other actions", () => {
  const made: Rule = {
    id: "page2",
    enabled: true,
    tags: [],
    match: { method: "GET", path: "/api/orders", query: { page: "2", _: "100" } },
    active: "ok",
    responses: { ok: { status: 200 } },
  };
  const later: RequestEvent = {
    seq: 1,
    date: 1000,
    method: "GET",
    host: "api.invalid",
    path: "/api/orders",
    query: { page: "2", _: "200" },
    outcome: { passthrough: {} },
  };
  const open = async (over: Partial<TrafficDeps>) => {
    const m = mount(["api.invalid"], { rules: () => [made], ...over });
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestOurs([later]);
    click($(m.root, '.ml-traffic-row[data-key="ours:1"]'));
    await vi.runAllTimersAsync();
    return m;
  };

  test("names what the rule needs and what the request had, and offers the fix it was given without taking the primary action", async () => {
    const removeCondition = vi.fn();
    const { root } = await open({
      unkept: () => ({ rule: made, misses: [{ key: "_", expected: "100", actual: "200" }], remove: "_" }),
      removeCondition,
    });
    expect($(root, '[data-reason="unkept"]').textContent).toContain(
      "GET /api/orders ?page=2&_=100 규칙이 이 요청에 응답하지 않았습니다. 규칙 조건: _=100 · 이 요청: _=200",
    );
    const fix = $(root, '[data-action="remove-condition"]');
    expect(fix.textContent).toBe("_ 조건 지우기");
    expect(fix.hasAttribute("data-primary")).toBe(false);
    expect($(root, ".ml-capture [data-primary]").getAttribute("data-action")).toBe("empty-rule");
    click(fix);
    expect(removeCondition).toHaveBeenCalledWith("page2", "_");
  });

  test("offers no fix it wasn't given, and writes a missing key as missing and a long value cut short", async () => {
    const long = "x".repeat(60);
    const { root } = await open({
      unkept: () => ({
        rule: made,
        misses: [
          { key: "page", expected: "2", actual: long },
          { key: "_", expected: "100" },
        ],
      }),
    });
    const line = $(root, '[data-reason="unkept"]').textContent!;
    expect(line).toContain("규칙 조건: page=2, _=100 · 이 요청: page=" + "x".repeat(32) + "…, _ 없음");
    expect(root.querySelector('[data-action="remove-condition"]')).toBeNull();
  });

  test("a reason about a rule that fits, such as Map Local being off, comes first", async () => {
    const { root } = await open({
      unkept: () => ({ rule: made, misses: [{ key: "_", expected: "100", actual: "200" }] }),
      rules: () => [{ ...made, match: { method: "GET", path: "/api/orders" } }],
      mapLocalEnabled: () => false,
    });
    expect(root.querySelector('[data-reason="unkept"]')).toBeNull();
  });
});

describe("the endpoint list at narrow widths keeps the path (O10)", () => {
  test("hides the host when every row shown has the same host, even with several allowed hosts", () => {
    const { root, store } = mount(["api.invalid", "cdn.invalid"]);
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
    expect(root.querySelectorAll(".ml-traffic-list .ml-req-host")).toHaveLength(0);
    store.ingestNetwork([net("3", 3, "/c", "cdn.invalid")]);
    expect(root.querySelectorAll(".ml-traffic-list .ml-req-host").length).toBeGreaterThan(0);
  });

  test("the host gives up its width long before the path", () => {
    const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    const shrink = (body: string) => Number(/flex:\s*\d+\s+(\d+)/.exec(body)?.[1]);
    expect(shrink(rule(".ml-req-host"))).toBeGreaterThanOrEqual(100 * shrink(rule(".ml-where > .ml-path")));
  });
});

test("before capturing, the detail says how many server headers the mock leaves out, naming them on hover (O9)", async () => {
  const detail = vi.fn(async (id: string): Promise<NetworkDetail> => ({
    ...net(id, 0),
    requestHeaders: {},
    responseHeaders: { "Content-Type": "application/json", "Cache-Control": "no-store", Server: "nginx", "X-Request-Id": "r" },
    responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
  }));
  const { root, store } = mount(["api.invalid"], { detail });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  const note = $(root, "[data-omitted]");
  expect(note.textContent).toBe("복사하지 않는 서버 헤더 3개");
  expect(note.title).toBe("Cache-Control, Server, X-Request-Id");
});

describe("why a request was not mocked (O12)", () => {
  const devices: Rule = {
    id: "devices",
    match: { method: "GET", path: "/a/{id}" },
    active: "ok",
    responses: { ok: { status: 200 } },
  };
  const open = async (allowed: string[], over: Partial<TrafficDeps>) => {
    const m = mount(allowed, over);
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork([net("1", 1)]);
    click($(m.root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    return { ...m, why: () => m.root.querySelector<HTMLElement>("[data-why]") };
  };

  test("Map Local off: one line says so, and [Turn on] turns it on", async () => {
    const { why, deps } = await open(["api.invalid"], { rules: () => [devices], mapLocalEnabled: () => false });
    expect(why()?.dataset.why).toBe("off");
    expect(why()?.textContent).toContain("Map Local이 꺼져 있어 목업되지 않았습니다");
    click(why()!.querySelector('[data-action="why-fix"]'));
    expect(deps.enableMapLocal).toHaveBeenCalled();
  });

  test("host not allowed: the line names the host and its button allows it, with no second allow button", async () => {
    const { why, deps, root } = await open([], { rules: () => [devices] });
    expect(why()?.dataset.why).toBe("hostNotAllowed");
    expect(why()?.textContent).toContain("api.invalid");
    expect(root.querySelectorAll('[data-action="allow-host"], [data-action="why-fix"]')).toHaveLength(1);
    click(why()!.querySelector('[data-action="why-fix"]'));
    expect(deps.addAllowedHost).toHaveBeenCalledWith("api.invalid");
  });

  test("the matching rule is off: [Turn on rule] turns that rule on", async () => {
    const { why, deps } = await open(["api.invalid"], { rules: () => [{ ...devices, enabled: false }] });
    expect(why()?.dataset.why).toBe("ruleOff");
    expect(why()?.textContent).toContain("GET /a/{id} 규칙이 꺼져 있어 목업되지 않았습니다");
    click(why()!.querySelector('[data-action="why-fix"]'));
    expect(deps.enableRule).toHaveBeenCalledWith("devices");
  });

  test("a host blocked in app code: says it is never mocked, offers nothing to press, and does not repeat the note", async () => {
    const { why, root } = await open(["api.invalid"], { rules: () => [devices], isBlockedHost: () => true });
    expect(why()?.dataset.why).toBe("blockedHost");
    expect(why()?.textContent).toContain("목업되지 않습니다");
    expect(why()?.querySelector("button")).toBeNull();
    expect(root.querySelector("[data-host-blocked]")).toBeNull();
  });

  test("a mocked request names the matching rule a more specific rule took precedence over", async () => {
    const paged: Rule = { ...devices, id: "paged", match: { method: "GET", path: "/a/{id}", query: { page: "2" } } };
    const { root, store } = mount(["api.invalid"], { rules: () => [devices, paged] });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([
      {
        seq: 1,
        date: 2,
        method: "GET",
        host: "api.invalid",
        path: "/a/1",
        query: { page: "2" },
        outcome: { mocked: { rule: "paged", response: "ok" } },
      },
    ]);
    click($(root, ".ml-traffic-row"));
    await vi.runAllTimersAsync();
    const why = root.querySelector<HTMLElement>("[data-why]");
    expect(why?.dataset.why).toBe("shadowed");
    expect(why?.textContent).toContain("GET /a/{id}");
    expect(why?.textContent).toContain("GET /a/{id} ?page=2");
  });

  test("says nothing when no rule matches", async () => {
    const { why } = await open([], { mapLocalEnabled: () => false });
    expect(why()).toBeNull();
  });
});

test("when only a disabled rule matches, the primary action adds to that rule and turns it on, and a new rule is the secondary choice (O5)", async () => {
  const off: Rule = {
    id: "old",
    enabled: false,
    match: { method: "GET", path: "/a/{id}" },
    active: "ok",
    responses: { ok: { status: 200 } },
  };
  const { root, store, deps } = mount(["api.invalid"], { rules: () => [off] });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  const primary = $(root, ".ml-capture [data-primary]");
  expect(primary.getAttribute("data-action")).toBe("capture");
  expect(primary.textContent).toBe("그 규칙에 추가하고 켜기");
  click(primary);
  expect(deps.capture).toHaveBeenLastCalledWith(expect.objectContaining({ key: "1" }), expect.anything(), "/a/1", "old", undefined, true);
  const secondary = $(root, '[data-action="capture-new"]');
  expect(secondary.textContent).toBe("새 규칙으로 만들기");
  expect(secondary.hasAttribute("data-primary")).toBe(false);
  click(secondary);
  expect(deps.capture).toHaveBeenLastCalledWith(expect.objectContaining({ key: "1" }), expect.anything(), "/a/1", undefined);
});

test("a response Map Local blocked (X-Map-Local: unmocked) is not captured into a disabled rule or a new one either — a blocked button does nothing even when pressed (I-C)", async () => {
  const off: Rule = {
    id: "old",
    enabled: false,
    match: { method: "GET", path: "/a/{id}" },
    active: "ok",
    responses: { ok: { status: 200 } },
  };
  const detail = vi.fn(async (id: string): Promise<NetworkDetail> => ({
    ...net(id, 0),
    requestHeaders: {},
    responseHeaders: { "X-Map-Local": "unmocked" },
    responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
  }));
  const { root, store, deps } = mount(["api.invalid"], { rules: () => [off], detail });
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  // With no response to carry, neither capture button is offered, so there is nothing to
  // press by mistake; the rule that is off is turned on instead of duplicated.
  expect(root.querySelector('[data-action="capture"], [data-action="capture-new"], [data-action="empty-rule"]')).toBeNull();
  expect(deps.capture).not.toHaveBeenCalled();
});

describe("only a rule that is off matches and there is no response to capture", () => {
  const off: Rule = {
    id: "old",
    enabled: false,
    match: { method: "GET", path: "/a/{id}" },
    active: "ok",
    responses: { ok: { status: 200 } },
  };
  const blockedDetail = vi.fn(async (id: string): Promise<NetworkDetail> => ({
    ...net(id, 0),
    requestHeaders: {},
    responseHeaders: { "X-Map-Local": "unmocked" },
    responseBody: { byteCount: 0, isTruncated: false, text: "" },
  }));

  test("the primary action turns that rule on, so ⌘↩ can't make a duplicate empty rule", async () => {
    const emptyRule = vi.fn();
    const { root, store, deps } = mount(["api.invalid"], { rules: () => [off], detail: blockedDetail, emptyRule });
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    const primary = root.querySelectorAll(".ml-capture [data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toBe("규칙 켜기");
    expect(root.querySelector('[data-action="empty-rule"]')).toBeNull();
    click(primary[0]);
    expect(deps.enableRule).toHaveBeenCalledWith("old");
    expect(emptyRule).not.toHaveBeenCalled();
  });

  test("without the network plugin, too", async () => {
    const emptyRule = vi.fn();
    const { root, store, deps } = mount(["api.invalid"], { rules: () => [off], networkAvailable: () => false, emptyRule });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([
      { seq: 1, date: 2, method: "GET", host: "api.invalid", path: "/a/1", query: {}, outcome: { passthrough: {} } },
    ]);
    click($(root, '.ml-traffic-row[data-key="ours:1"]'));
    const primary = root.querySelectorAll(".ml-capture [data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toBe("규칙 켜기");
    expect(root.querySelector('[data-action="empty-rule"]')).toBeNull();
    click(primary[0]);
    expect(deps.enableRule).toHaveBeenCalledWith("old");
  });

  test("when Map Local is off, the primary fixes that first, and the rule is opened rather than duplicated for a blocked host", async () => {
    const m = mount(["api.invalid"], { rules: () => [off], detail: blockedDetail, mapLocalEnabled: () => false });
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork([net("1", 1)]);
    click($(m.root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    expect($(m.root, ".ml-capture [data-primary]").textContent).toBe("켜기");
    const blocked = mount(["api.invalid"], { rules: () => [off], detail: blockedDetail, isBlockedHost: () => true });
    click($(blocked.root, '[data-mode="time"]'));
    blocked.store.ingestNetwork([net("1", 1)]);
    click($(blocked.root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    const primary = $(blocked.root, ".ml-capture [data-primary]");
    expect(primary.getAttribute("data-action")).toBe("open-rule");
    click(primary);
    expect(blocked.deps.openRule).toHaveBeenCalledWith("old");
  });
});

test("without the network plugin, offers a button that creates an empty rule without a response", () => {
  const emptyRule = vi.fn();
  const { root, store } = mount(["api.invalid"], { networkAvailable: () => false, emptyRule });
  click($(root, '[data-mode="time"]'));
  store.ingestOurs([
    {
      seq: 1,
      date: 2,
      method: "GET",
      host: "api.invalid",
      path: "/a/1",
      query: {},
      outcome: { passthrough: {} },
    },
  ]);
  click($(root, '.ml-traffic-row[data-key="ours:1"]'));
  expect(root.querySelector('[data-action="capture"]')).toBeNull();
  click($(root, '[data-action="empty-rule"]'));
  expect(emptyRule).toHaveBeenCalledWith(expect.objectContaining({ key: "ours:1" }), "/a/1");
});

test("shows the reason instead of an empty detail for a request missing from the Necto records while the plugin is present", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestOurs([
    {
      seq: 1,
      date: 2,
      method: "GET",
      host: "api.invalid",
      path: "/a/1",
      query: {},
      outcome: { passthrough: {} },
    },
  ]);
  click($(root, '.ml-traffic-row[data-key="ours:1"]'));
  expect($(root, ".ml-traffic-detail").textContent).toContain("Necto 기록에 없는 요청이라 응답을 볼 수 없습니다");
});

test("Esc does not clear the selection on a hidden screen (not in the document)", () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  root.remove();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(root.querySelector('.ml-traffic-row[data-key="1"]')!.getAttribute("aria-selected")).toBe("true");
});

test("shows the fractional-ms durations Necto reports briefly in both rows and the detail", () => {
  const { root, store } = mount();
  store.ingestNetwork([
    { ...net("1", 1), durationMilliseconds: 0.6129741668701172 },
    { ...net("2", 2, "/b"), durationMilliseconds: 1192.09289 },
  ]);
  click($(root, '[data-mode="time"]'));
  const durations = [...root.querySelectorAll(".ml-traffic-row")].map((r) => r.children[5].textContent);
  expect(durations.sort()).toEqual(["1.2s", "<1ms"]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  expect($(root, ".ml-traffic-detail").textContent).toContain("<1ms");
  expect($(root, ".ml-traffic-detail").textContent).not.toContain("0.6129");
});

test("the time column wraps the hour separately so CSS can fold it in a narrow list", () => {
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1)]);
  click($(root, '[data-mode="time"]'));
  const clock = $(root, ".ml-traffic-row .ml-clock");
  expect(clock.querySelector(".ml-clock-hour")).not.toBeNull();
  expect(clock.textContent).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
});

test("list width CSS contract: the path column takes all remaining width, other columns fit their content, and the list is a container query target", () => {
  expect(css).toMatch(/\.ml-traffic-list\s*\{[^}]*container-type:\s*inline-size/);
  expect(css).not.toMatch(/\.ml-col-path\s*\{[^}]*width/);
  // A fixed layout always reserved each cell's worst-case width (connection failure, rule name), so
  // the path was cut while space went unused (seen on screen in T3)
  expect(css).toMatch(/\.ml-traffic-table\s*\{[^}]*table-layout:\s*auto/);
  expect(css).not.toMatch(/\.ml-col-(time|method|count|status|result|duration|ago)\s*\{[^}]*width/);
  expect(css).not.toMatch(/\.ml-traffic-table\s*\{[^}]*min-width:\s*56ch/);
  expect(css).toMatch(
    /\.ml-traffic-table td:not\(\[data-cell="path"\]\)[^{]*\{[^}]*width:\s*1%[^}]*white-space:\s*nowrap/,
  );
  expect(css).toMatch(/\.ml-traffic-table \[data-cell="path"\][^{]*\{[^}]*width:\s*100%[^}]*max-width:\s*0/);
  expect(css).toMatch(/\.ml-result-cell\s*\{[^}]*max-width:/);
  const wide = css.match(/@container\s*\([^)]*\)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/);
  expect(wide).not.toBeNull();
  expect(wide![1]).toMatch(/\.ml-clock-hour\s*\{\s*display:\s*inline/);
  expect(wide![1]).toMatch(/\.ml-result-rule\s*\{\s*display:\s*inline/);
  // Left truncation (keeping the end of the path) only works on a block — inline inside a table
  // cell, the cell's right truncation takes over
  expect(css).toMatch(/\.ml-tail\s*\{[^}]*display:\s*block/);
});

test("on-state CSS contract: a filter chip's aria-pressed fills with the accent colour, and the view switch is drawn by the host's necto-segmented", () => {
  const rule = css.match(/\.ml-traffic-toolbar \.ml-chip\[aria-pressed="true"\][^{]*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule![1]).toMatch(/background:\s*var\(--necto-accent\)/);
  expect(rule![1]).toMatch(/color:\s*var\(--necto-bg\)/);
  expect(rule![1]).toMatch(/border-color:\s*var\(--necto-accent\)/);
  expect(css).not.toMatch(/\.ml-traffic-toolbar \[aria-pressed/);
  const { root } = mount();
  for (const b of root.querySelectorAll("[data-mode]")) {
    expect(b.parentElement!.classList.contains("necto-segmented")).toBe(true);
    expect(b.classList.contains("necto-button")).toBe(false);
  }
});

test("segments and chips report their on state with aria-pressed", () => {
  const { root } = mount();
  expect($(root, '[data-mode="time"]').getAttribute("aria-pressed")).toBe("false");
  click($(root, '[data-chip="mocked"]'));
  expect($(root, '[data-chip="mocked"]').getAttribute("aria-pressed")).toBe("true");
  expect($(root, '[data-chip="2xx"]').getAttribute("aria-pressed")).toBe("false");
});

test("does not search every group for the selected request on redraw, even with many groups", () => {
  const { root, store } = mount();
  store.ingestNetwork(Array.from({ length: 40 }, (_, i) => net(`${i}`, i, `/g${i}`)));
  click($(root, '.ml-traffic-group[data-group="GET api.invalid /g3"]'));
  const spy = vi.spyOn(store, "liveEntry");
  store.ingestNetwork([net("new", 100, "/g5")]);
  expect(spy.mock.calls.length).toBeGreaterThan(0);
  expect(spy.mock.calls.length).toBeLessThan(10);
});

describe("only the user pauses the list", () => {
  const groupSelected = (root: HTMLElement) => click($(root, ".ml-traffic-group"));

  test("switching views with a selection neither pauses nor resumes", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1)]);
    groupSelected(root);
    click($(root, '[data-mode="time"]'));
    expect(store.paused).toBe(false);
    click($(root, '[data-mode="endpoint"]'));
    expect(store.paused).toBe(false);
  });

  test("switching to the time view without a selection does not pause", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1)]);
    click($(root, '[data-mode="time"]'));
    expect(store.paused).toBe(false);
  });

  test("a user pause is not released by switching to the endpoint view", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '[data-action="pause"]'));
    expect(store.paused).toBe(true);
    click($(root, '[data-mode="endpoint"]'));
    expect(store.paused).toBe(true);
  });

  test("stays paused when the user selects and deselects a row during a user pause", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '[data-action="pause"]'));
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-action="deselect"]'));
    expect(store.paused).toBe(true);
  });

  test("stays paused when entering the time view with a selection during a user pause and returning to the endpoint view", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1)]);
    groupSelected(root);
    click($(root, '[data-action="pause"]'));
    click($(root, '[data-mode="time"]'));
    click($(root, '[data-mode="endpoint"]'));
    expect(store.paused).toBe(true);
  });

});

describe("terms: the traffic tab", () => {
  test("the result filters are mocked, real server, blocked and unverified, and the status filter's failure is 'Connection failed'", () => {
    const { root } = mount();
    expect(
      ["mocked", "passthrough", "blocked", "unknown"].map(
        (k) => $(root, `[data-chip="${k}"]`).textContent,
      ),
    ).toEqual(["목업", "실서버", "차단", "확인 불가"]);
    expect($(root, '[data-chip="failed"]').textContent).toBe("연결 실패");
  });

  test("the search field hints 'Find by path or query'", () => {
    const { root } = mount();
    expect(($(root, '[data-field="traffic-search"]') as HTMLInputElement).placeholder).toBe("경로·쿼리로 찾기");
  });

  test("the button reads 'Mock with an empty response' when there is no response to copy", () => {
    const { root, store } = mount(["api.invalid"], { networkAvailable: () => false });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([
      {
        seq: 1,
        date: 2,
        method: "GET",
        host: "api.invalid",
        path: "/a/1",
        query: {},
        outcome: { passthrough: {} },
      },
    ]);
    click($(root, '.ml-traffic-row[data-key="ours:1"]'));
    expect($(root, '[data-action="empty-rule"]').textContent).toBe("빈 응답으로 목업");
  });
});

describe("visual language: Necto tables, status dots and result pills", () => {
  const ours = (seq: number, path: string, outcome: object) =>
    ({
      seq,
      date: seq,
      method: "GET",
      host: "api.invalid",
      path,
      query: {},
      outcome,
    }) as RequestEvent;
  const cell = (root: HTMLElement, key: string, name: string) =>
    $(root, `.ml-traffic-row[data-key="${key}"] [data-cell="${name}"]`);

  test("the time view is a necto-table with column headers and its rows are trs in tbody", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1)]);
    click($(root, '[data-mode="time"]'));
    const table = $(root, ".ml-traffic-list table.necto-table");
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "시작 시간",
      "메서드",
      "경로",
      "상태 코드",
      "결과",
      "소요 시간",
    ]);
    expect($(root, '.ml-traffic-row[data-key="1"]').tagName).toBe("TR");
    expect($(root, '.ml-traffic-row[data-key="1"]').parentElement!.tagName).toBe("TBODY");
  });

  test("the endpoint view has the same table shape", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1)]);
    const table = $(root, ".ml-traffic-list table.necto-table");
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "메서드",
      "경로",
      "횟수",
      "상태 코드",
      "결과",
      "최근",
    ]);
    const group = $(root, ".ml-traffic-group");
    expect(group.tagName).toBe("TR");
    expect(group.querySelector('[data-cell="status"] .necto-status-ok')!.textContent).toBe("200");
    expect(group.querySelector('[data-cell="result"] .ml-result')!.textContent).toBe("확인 불가");
  });

  test("HTTP status is a coloured dot as in Necto: 2xx ok · 3xx info · 4xx warning · 5xx danger · connection failure danger · in progress idle", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([
      { ...net("1", 1, "/a"), statusCode: 200 },
      { ...net("2", 2, "/b"), statusCode: 304 },
      { ...net("3", 3, "/c"), statusCode: 404 },
      { ...net("4", 4, "/d"), statusCode: 503 },
      { ...net("5", 5, "/e"), state: "failed", statusCode: undefined },
      { ...net("6", 6, "/f"), state: "pending", statusCode: undefined },
    ]);
    const status = (k: string) => cell(root, k, "status").querySelector(".necto-status") as HTMLElement;
    expect(
      ["1", "2", "3", "4", "5", "6"].map((k) =>
        [...status(k).classList].find((c) => c.startsWith("necto-status-")),
      ),
    ).toEqual([
      "necto-status-ok",
      "necto-status-info",
      "necto-status-warning",
      "necto-status-danger",
      "necto-status-danger",
      "necto-status-idle",
    ]);
    expect(status("5").textContent).toBe("연결 실패");
    expect(status("1").textContent).toBe("200");
    expect(status("6").title).toBe("응답을 기다리는 중");
  });

  test("a completed request with an unknown status code does not show a bare dot", () => {
    const { root, store } = mount(["api.invalid"], { networkAvailable: () => false });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([ours(1, "/a", { passthrough: {} })]);
    expect(cell(root, "ours:1", "status").querySelector(".necto-status")).toBeNull();
  });

  test("results are pills of distinct shapes: mocked (rule name in the title and secondary text) · blocked · real server · unverified", () => {
    const { root, store } = mount(["api.invalid"], { networkAvailable: () => false });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([
      ours(1, "/a", { mocked: { rule: "get-sites", response: "캡처한 응답" } }),
      ours(2, "/b", { unmocked: { status: 421 } }),
      ours(3, "/c", { passthrough: {} }),
    ]);
    store.ingestNetwork([net("9", 9, "/z")]);
    const pill = (k: string) => cell(root, k, "result").querySelector(".ml-result") as HTMLElement;
    expect(pill("ours:1").classList.contains("ml-result-mocked")).toBe(true);
    expect(pill("ours:1").classList.contains("necto-badge")).toBe(true);
    expect(pill("ours:1").textContent).toBe("목업");
    expect(pill("ours:1").title).toBe("목업 · 규칙 get-sites · 응답 캡처한 응답");
    expect(cell(root, "ours:1", "result").querySelector(".ml-result-rule")!.textContent).toBe("get-sites");
    expect([pill("ours:2"), pill("ours:3"), pill("9")].map((p) => [p.dataset.result, p.textContent])).toEqual(
      [["blocked", "차단"], ["passthrough", "실서버"], ["unknown", "확인 불가"]]);
    expect(pill("ours:2").classList.contains("ml-result-blocked")).toBe(true);
    expect(pill("ours:3").classList.contains("ml-result-passthrough")).toBe(true);
    expect(pill("9").classList.contains("ml-result-unknown")).toBe(true);
  });

  test("durations are necto-numeric and marked slow from 1 second, and methods are not coloured", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([
      { ...net("1", 1, "/a"), durationMilliseconds: 999 },
      { ...net("2", 2, "/b"), durationMilliseconds: 1000 },
    ]);
    expect(cell(root, "1", "duration").classList.contains("necto-numeric")).toBe(true);
    expect(cell(root, "1", "duration").classList.contains("ml-slow")).toBe(false);
    expect(cell(root, "2", "duration").classList.contains("ml-slow")).toBe(true);
    expect(cell(root, "1", "method").className).toBe("");
    expect(cell(root, "1", "method").textContent).toBe("GET");
  });

  test("CSS contract: result pill and slow response colours", () => {
    const body = (sel: string) =>
      css.match(new RegExp(`${sel.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(body(".ml-result-mocked")).toMatch(/color:\s*var\(--ml-mock\)/);
    expect(body(".ml-result-mocked")).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--ml-mock\) 10%,\s*transparent\)/,
    );
    expect(body(".ml-result-blocked")).toMatch(/color:\s*var\(--ml-block\)/);
    expect(body(".ml-result-blocked")).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--ml-block\) 10%,\s*transparent\)/,
    );
    expect(body(".ml-result-passthrough")).toMatch(/background:\s*none/);
    expect(body(".ml-result-passthrough")).toMatch(/color:\s*var\(--necto-text-tertiary\)/);
    expect(body(".ml-result-unknown")).toMatch(/border:\s*1px dashed/);
    expect(body(".ml-result-unknown")).toMatch(/color:\s*var\(--necto-text-tertiary\)/);
    expect(body(".ml-slow")).toMatch(/color:\s*var\(--necto-warning\)/);
    expect(body(".ml-req-host-off")).toMatch(/color:\s*var\(--necto-text-tertiary\)/);
    // A dimmed host is still meaningful text — no extra opacity on top of the tertiary text colour (≥4.5:1)
    expect(body(".ml-req-host-off")).not.toMatch(/opacity/);
  });
});

test("'Allowed hosts only' does not turn itself on when the first allowed host appears, so the list stays as it is", () => {
  const allowed: string[] = [];
  const { root, store, view } = mount(allowed);
  store.ingestNetwork([net("1", 1), net("2", 2, "/x", "cdn.invalid")]);
  allowed.push("api.invalid");
  view.update();
  const box = $(root, '[data-field="allowed-only"]') as HTMLInputElement;
  expect(box.disabled).toBe(false);
  expect(box.checked).toBe(false);
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(2);
  click(box);
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(1);
});

test("the detail's capture area sits right under the summary line, before the body", async () => {
  const { root, store } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  const detail = $(root, ".ml-traffic-detail");
  const capture = detail.querySelector(".ml-capture")!;
  expect(capture.previousElementSibling?.querySelector(".ml-sample-nav")).not.toBeNull();
  for (const later of [detail.querySelector("details")!, detail.querySelector(".ml-body")!]) {
    expect(capture.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

test("the path cell shows the full URL in its title even when truncated", () => {
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1, "/v1/reports/daily/summary")]);
  expect($(root, '.ml-traffic-group [data-cell="path"]').title).toBe("api.invalid/v1/reports/daily/summary");
  click($(root, '[data-mode="time"]'));
  expect($(root, '.ml-traffic-row [data-cell="path"] .ml-tail').title).toBe(
    "https://api.invalid/v1/reports/daily/summary",
  );
});

const drag = (handle: Element, ...xs: number[]) => {
  handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: xs[0], button: 0 }));
  for (const x of xs.slice(1))
    document.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: x, buttons: 1 }),
    );
  document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: xs.at(-1) }));
};

test("width CSS contract: both tabs share one split rule — stacked when narrow, side by side at normal widths, and the detail takes the remaining width when wide", () => {
  expect(css).toMatch(/\.ml-root\s*\{[^}]*container:\s*ml-panel\s*\/\s*inline-size/);
  const split = css.match(/\.ml-split\s*\{([^}]*)\}/);
  expect(split).not.toBeNull();
  expect(split![1]).toMatch(/grid-template-columns:\s*clamp\([^;]*var\(--ml-list-size[^;]*\)\s+0\s+minmax\(0,\s*1fr\)/);
  expect(css).toMatch(/\.ml-main\s*\{[^}]*--ml-list-default:/);
  expect(css).toMatch(/\.ml-traffic-main\s*\{[^}]*--ml-list-default:/);
  const narrow = css.match(/@container ml-panel \(max-width: 639px\)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/);
  expect(narrow).not.toBeNull();
  expect(narrow![1]).toMatch(/\.ml-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  expect(narrow![1]).toMatch(/\.ml-split-handle\s*\{[^}]*display:\s*none/);
  // If the old per-tab width rules remained, the two tabs would drift apart again
  expect(css).not.toMatch(/@media \(max-width: 640px\)/);
  expect(css).toMatch(/\.ml-split-handle\s*\{[^}]*cursor:\s*ew-resize/);
});

test("the search field does not shrink to an empty box when the toolbar wraps (M5)", () => {
  expect(css).toMatch(/\.ml-traffic-toolbar input\[type="search"\]\s*\{[^}]*min-width:\s*10em/);
});

describe("keyboard: the list (principles 2 and 9)", () => {
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  const listbox = (root: ParentNode) => $(root, '[role="listbox"]');
  const options = (root: ParentNode) => [...root.querySelectorAll('[role="listbox"] [role="option"]')] as HTMLElement[];
  const selectedIndex = (root: ParentNode) =>
    options(root).findIndex((o) => o.getAttribute("aria-selected") === "true");
  const timeMount = () => {
    const m = mount();
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b"), net("3", 3, "/c"), net("4", 4, "/d")]);
    listbox(m.root).focus();
    return m;
  };

  test("the list is a single listbox reachable by Tab with option rows — table headers do not mix into rows for assistive technology", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
    const list = listbox(root);
    expect(list.classList.contains("ml-traffic-list")).toBe(true);
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(list.getAttribute("aria-label")).toBeTruthy();
    expect(options(root)).toHaveLength(2);
    expect(options(root).every((o) => o.id && o.getAttribute("tabindex") === null)).toBe(true);
    expect($(root, ".ml-traffic-table").getAttribute("role")).toBe("presentation");
    expect($(root, ".ml-traffic-table thead").getAttribute("aria-hidden")).toBe("true");
  });

  test("↓↑ move the selection and the detail follows, while focus stays in the list and activedescendant points to the selected row", () => {
    const { root } = timeMount();
    const list = listbox(root);
    key(list, "ArrowDown");
    expect(selectedIndex(root)).toBe(0);
    const first = options(root)[0];
    expect($(root, ".ml-traffic-detail").dataset.key).toBe(first.dataset.target);
    key(listbox(root), "ArrowDown");
    expect(selectedIndex(root)).toBe(1);
    expect($(root, ".ml-traffic-detail").dataset.key).toBe(options(root)[1].dataset.target);
    key(listbox(root), "ArrowUp");
    expect(selectedIndex(root)).toBe(0);
    expect(document.activeElement).toBe(listbox(root));
    expect(listbox(root).getAttribute("aria-activedescendant")).toBe(options(root)[0].id);
    key(listbox(root), "ArrowUp");
    expect(selectedIndex(root)).toBe(0);
  });

  test("Home and End go to the first and last, ⇟ and ⇞ move by page and stop at the ends — moving to the already selected row keeps the selection", () => {
    const { root } = timeMount();
    key(listbox(root), "End");
    expect(selectedIndex(root)).toBe(3);
    key(listbox(root), "End");
    expect(selectedIndex(root)).toBe(3);
    key(listbox(root), "Home");
    expect(selectedIndex(root)).toBe(0);
    key(listbox(root), "Home");
    expect(selectedIndex(root)).toBe(0);
    key(listbox(root), "PageDown");
    expect(selectedIndex(root)).toBe(3);
    key(listbox(root), "PageUp");
    expect(selectedIndex(root)).toBe(0);
  });

  test("without a selection, ↓ selects the first row and ↑ the last", () => {
    const { root } = timeMount();
    key(listbox(root), "ArrowUp");
    expect(selectedIndex(root)).toBe(3);
  });

  test("in the endpoint view too, ↓ moves between groups and shows each group's newest call in the detail", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2"), net("3", 3, "/b")]);
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    key(listbox(root), "ArrowDown");
    expect(selectedIndex(root)).toBe(1);
    const group = options(root)[1].dataset.group!;
    const newest = store
      .entries()
      .filter(
        (e) => `${e.method} ${e.host} ${e.path.startsWith("/a") ? "/a/{id}" : e.path}` === group,
      )[0];
    expect($(root, ".ml-traffic-detail").dataset.key).toBe(newest.key);
  });

  test("scrolls a row selected by key into view, but not on a redraw for a new request", () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const { root, store } = mount();
      store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
      listbox(root).focus();
      key(listbox(root), "ArrowDown");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.contexts[0]).toBe(options(root)[0]);
      store.ingestNetwork([net("3", 3, "/c")]);
      vi.advanceTimersByTime(2000);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("keeps focus and selection (activedescendant) in the list when a new request arrives", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    key(listbox(root), "ArrowDown");
    const chosen = options(root)[selectedIndex(root)].dataset.group;
    store.ingestNetwork([net("3", 3, "/c"), net("4", 4, "/a/9")]);
    vi.advanceTimersByTime(2000);
    expect(document.activeElement).toBe(listbox(root));
    const active = document.getElementById(listbox(root).getAttribute("aria-activedescendant")!)!;
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.dataset.group).toBe(chosen);
  });

  test("activedescendant keeps pointing to the selected row when paging samples with the detail's ‹›", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    click($(root, '[data-action="older"]'));
    const id = listbox(root).getAttribute("aria-activedescendant");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)!.getAttribute("aria-selected")).toBe("true");
  });

  test("clearing the selection clears activedescendant too", () => {
    const { root } = timeMount();
    key(listbox(root), "ArrowDown");
    click($(root, '[data-action="deselect"]'));
    expect(listbox(root).hasAttribute("aria-activedescendant")).toBe(false);
  });
});

test("focus ring CSS contract: list containers draw the host's :focus-visible ring inset (so scroll panes do not clip it), and our CSS never removes outline", () => {
  expect(css).toMatch(/\[role="listbox"\]:focus-visible\s*\{[^}]*outline-offset:\s*-2px/);
  // The detail where Return lands while loading (tabindex=-1) is a scroll pane too — the ring goes inset (S1)
  expect(css).toMatch(/\.ml-traffic-detail:focus-visible\s*\{[^}]*outline-offset:\s*-2px/);
  expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  // A selected rule row also gets a left accent line, as in Necto tables
  expect(css).toMatch(/\.ml-rule\[aria-selected="true"\]\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--necto-accent\)/);
});

describe("keyboard: Return, Esc, ⌘↩ and / (principle 2, scenario ① without a mouse)", () => {
  const key = (el: Element | Document, k: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };
  const listbox = (root: ParentNode) => $(root, '[role="listbox"]');
  const picked = async (over: Partial<TrafficDeps> = {}) => {
    const m = mount(["api.invalid"], over);
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
    listbox(m.root).focus();
    key(listbox(m.root), "ArrowDown");
    await vi.runAllTimersAsync();
    return m;
  };

  test("scenario ①: selecting with ↓ and one ⌘↩ mocks with that response — the button shows the shortcut", async () => {
    const { root, deps } = await picked();
    const capture = $(root, '[data-action="capture"]');
    expect(capture.getAttribute("data-shortcut")).toBe("⌘↩");
    expect(capture.getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
    const ev = key(listbox(root), "Enter", { metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.capture).toHaveBeenCalledWith(
      expect.objectContaining({ key: options1(root) }),
      expect.anything(),
      expect.any(String),
      undefined,
    );
  });
  const options1 = (root: ParentNode) => $(root, '[role="option"][aria-selected="true"]').dataset.target;

  test("⌘↩ captures once even with focus on that button, and does nothing without a selection or on a hidden screen", async () => {
    const { root, deps } = await picked();
    $(root, '[data-action="capture"]').focus();
    key(document.activeElement!, "Enter", { metaKey: true });
    expect(deps.capture).toHaveBeenCalledTimes(1);
    key(listbox(root), "Escape");
    expect(key(listbox(root), "Enter", { metaKey: true }).defaultPrevented).toBe(false);
    expect(deps.capture).toHaveBeenCalledTimes(1);
  });

  test("⌘↩ performs the primary action in place (mock with an empty response) when there is no response to capture", async () => {
    const { root, deps } = await picked({ networkAvailable: () => false });
    expect($(root, '[data-action="empty-rule"]').getAttribute("data-shortcut")).toBe("⌘↩");
    key(listbox(root), "Enter", { metaKey: true });
    expect(deps.emptyRule).toHaveBeenCalledTimes(1);
  });

  test("Return in the list moves focus to the detail's primary action — or to its first control without one", async () => {
    const { root } = await picked();
    key(listbox(root), "Enter");
    expect(document.activeElement).toBe($(root, '[data-action="capture"]'));
    const other = await picked({ networkAvailable: () => false });
    key(listbox(other.root), "Enter");
    expect(document.activeElement).toBe($(other.root, '[data-action="empty-rule"]'));
  });

  test("Return goes nowhere without a selection", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1)]);
    listbox(root).focus();
    key(listbox(root), "Enter");
    expect(document.activeElement).toBe(listbox(root));
  });

  test("Esc ladder: in the detail, Esc clears the selection and returns focus to the list; in the list, Esc clears the selection", async () => {
    const { root } = await picked();
    key(listbox(root), "Enter");
    key(document.activeElement!, "Escape");
    expect(root.querySelector('[role="option"][aria-selected="true"]')).toBeNull();
    expect(document.activeElement).toBe(listbox(root));
    key(listbox(root), "ArrowDown");
    key(listbox(root), "Escape");
    expect(root.querySelector('[role="option"][aria-selected="true"]')).toBeNull();
    expect(document.activeElement).toBe(listbox(root));
  });

  test("Esc in the search field first clears the text (keeping the selection), and in an empty field returns to the list", async () => {
    const { root } = await picked();
    const search = () => $(root, '[data-field="traffic-search"]') as HTMLInputElement;
    search().focus();
    search().value = "zzz";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    const ev = key(search(), "Escape");
    expect(ev.defaultPrevented).toBe(true);
    expect(search().value).toBe("");
    expect(document.activeElement).toBe(search());
    expect(root.querySelectorAll('[role="option"]').length).toBe(2);
    expect(root.querySelector('[role="option"][aria-selected="true"]')).not.toBeNull();
    key(search(), "Escape");
    expect(document.activeElement).toBe(listbox(root));
    expect(root.querySelector('[role="option"][aria-selected="true"]')).not.toBeNull();
  });

  test("/ moves focus to the search field when not typing, and is not intercepted while typing or with modifiers", () => {
    const { root } = mount();
    listbox(root).focus();
    const ev = key(listbox(root), "/");
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe($(root, '[data-field="traffic-search"]'));
    expect(key(document.activeElement!, "/").defaultPrevented).toBe(false);
    listbox(root).focus();
    expect(key(listbox(root), "/", { metaKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(listbox(root));
  });

  test("⌘F is the host's 'Find in panel' — it is not intercepted", () => {
    const { root } = mount();
    listbox(root).focus();
    expect(key(listbox(root), "f", { metaKey: true }).defaultPrevented).toBe(false);
  });

  test("shortcut label CSS contract: data-shortcut follows the button text quietly (the button name is unchanged)", () => {
    expect(css).toMatch(/\[data-shortcut\]::after\s*\{[^}]*content:[^;]*attr\(data-shortcut\)/);
  });
});

test("the traffic keys (Esc, ⌘↩, /) do nothing while a dialog is open", async () => {
  const { root, store, deps } = mount();
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }),
  );
  expect($(root, '.ml-traffic-row[data-key="1"]').getAttribute("aria-selected")).toBe("true");
  expect(deps.capture).not.toHaveBeenCalled();
});

test("the detail's icon buttons (×, ‹, ›) have names (aria-label)", () => {
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2")]);
  click($(root, ".ml-traffic-group"));
  expect($(root, '[data-action="deselect"]').getAttribute("aria-label")).toBe("선택 해제");
  expect($(root, '[data-action="newer"]').getAttribute("aria-label")).toBe("더 최신 호출");
  expect($(root, '[data-action="older"]').getAttribute("aria-label")).toBe("더 이전 호출");
});

test("focus on a toolbar control (view, chips, pause) survives a new request — it is the Tab path to the list in scenario ①", () => {
  const { root, store } = mount();
  for (const sel of ['[data-mode="time"]', '[data-chip="2xx"]', '[data-chip="mocked"]', '[data-action="pause"]']) {
    $(root, sel).focus();
    store.ingestNetwork([net(`f${sel}`, Date.now(), `/f/${sel.length}`)]);
    expect(document.activeElement).toBe($(root, sel));
  }
  $(root, '.ml-traffic-toolbar [data-action="pause"]').focus();
  click($(root, '.ml-traffic-toolbar [data-action="pause"]'));
  expect(document.activeElement).toBe($(root, '.ml-traffic-toolbar [data-action="resume"]'));
});

describe("T6: the detail summary and the toolbar (F5, F6)", () => {
  test("the detail summary's status is a coloured dot (necto-status), as in Necto's detail title", async () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([{ ...net("1", 1), statusCode: 503 }]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    const mark = $(root, ".ml-traffic-detail .ml-detail-facts .necto-status");
    expect(mark).not.toBeNull();
    expect(mark.classList.contains("necto-status-danger")).toBe(true);
    expect(mark.textContent).toBe("503");
  });

  test("the toolbar wraps by group — status chips | result chips with pause, so pause never drops onto a line of its own (F6, V1)", () => {
    const { root, store } = mount();
    const group = (name: string) => $(root, `.ml-traffic-toolbar > .ml-toolbar-group[data-group="${name}"]`);
    expect(
      [...group("status").querySelectorAll("[data-chip]")].map((c) => c.getAttribute("data-chip")),
    ).toEqual(["2xx", "3xx", "4xx", "5xx", "failed"]);
    const tail = group("result-pause");
    expect(
      [...tail.querySelectorAll('[data-group="result"] [data-chip]')].map((c) =>
        c.getAttribute("data-chip"),
      ),
    ).toEqual(["mocked", "passthrough", "blocked", "unknown"]);
    expect(tail.lastElementChild?.getAttribute("data-field")).toBe("pause-toggle");
    expect(root.querySelector('.ml-traffic-toolbar > [data-group="pause"]')).toBeNull();
    store.pause();
    expect(group("result-pause").lastElementChild?.getAttribute("data-action")).toBe("resume");
    expect(css).toMatch(/\.ml-toolbar-group\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap/);
  });
});

describe("T6: the pause banner reserves its space (F1, principles 3 and 5)", () => {
  test("the banner slot exists even when not paused and shows 'Live', and the same slot counts what came after a selection", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1), net("2", 2, "/b")]);
    const live = $(root, ".ml-traffic-listcol > .ml-pause-strip");
    expect(live.hidden).toBe(false);
    expect(live.hasAttribute("data-live")).toBe(true);
    expect(live.textContent).toContain("실시간");
    expect(live.nextElementSibling?.classList.contains("ml-traffic-list")).toBe(true);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    expect($(root, ".ml-traffic-listcol > .ml-pause-strip").hasAttribute("data-live")).toBe(true);
    store.ingestNetwork([net("3", 3)]);
    const newer = $(root, ".ml-traffic-listcol > .ml-pause-strip");
    expect(newer.hasAttribute("data-newer")).toBe(true);
    expect(newer.hasAttribute("data-live")).toBe(false);
    expect(newer.nextElementSibling?.classList.contains("ml-traffic-list")).toBe(true);
  });

  test("CSS contract: the banner has the same fixed height in both states, does not wrap, and has no rule that hides and collapses it", () => {
    const rule = css.match(/\.ml-pause-strip\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/(^|;)\s*height:/);
    expect(rule![1]).toMatch(/box-sizing:\s*border-box/);
    expect(rule![1]).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule![1]).toMatch(/-webkit-user-select:\s*none/);
    expect(css).not.toMatch(/\.ml-pause-strip\[hidden\]/);
  });
});

/**
 * jsdom has no widths — measures as if the split were drawn total px wide (at left) and its first
 * pane (the list) list px wide.
 */
function geometry(total = 800, list = 464, left = 100) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = this.classList.contains("ml-split")
      ? total
      : this.parentElement?.classList.contains("ml-split") && !this.previousElementSibling
        ? list
        : 0;
    return {
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 0,
      width,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => { HTMLElement.prototype.getBoundingClientRect = original; };
}

describe("T6: the detail opens on selection — as in Necto Network (F2, F4)", () => {
  test("without a selection the list is full width and the handle and detail are hidden; selecting opens a detail with ×, and closing with × or Esc returns to full width", () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1)]);
    const main = () => $(root, ".ml-traffic-main");
    const closed = () => {
      expect(main().dataset.detail).toBe("closed");
      expect($(root, ".ml-split-handle").hidden).toBe(true);
      expect($(root, ".ml-traffic-detail").hidden).toBe(true);
    };
    closed();
    click($(root, ".ml-traffic-group"));
    expect(main().dataset.detail).toBe("open");
    expect($(root, ".ml-split-handle").hidden).toBe(false);
    expect($(root, ".ml-traffic-detail").hidden).toBe(false);
    click($(root, '.ml-traffic-detail [data-action="deselect"]'));
    closed();
    click($(root, ".ml-traffic-group"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    closed();
  });

  test("the open state follows a selection change on the list-only redraw path (new requests)", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.reset("launch-1");
    store.ingestOurs([
      {
        seq: 7,
        date: 1,
        method: "GET",
        host: "api.invalid",
        path: "/old",
        query: {},
        outcome: { passthrough: {} },
      },
    ]);
    click($(root, '.ml-traffic-row[data-key="ours:7"]'));
    expect($(root, ".ml-traffic-main").dataset.detail).toBe("open");
    store.reset("launch-2");
    store.ingestOurs([
      {
        seq: 8,
        date: 2,
        method: "GET",
        host: "api.invalid",
        path: "/new",
        query: {},
        outcome: { passthrough: {} },
      },
    ]);
    expect($(root, ".ml-traffic-main").dataset.detail).toBe("closed");
    expect($(root, ".ml-split-handle").hidden).toBe(true);
  });

  test("CSS contract: a closed split is one pane, a hidden pane beats the author display and collapses, and there is no rule pinning the empty hint to the bottom when narrow", () => {
    expect(css).toMatch(/\.ml-split\[data-detail="closed"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.ml-split > \[hidden\]\s*\{[^}]*display:\s*none/);
    const narrow = css.match(/@container ml-panel \(max-width: 639px\)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/);
    expect(narrow![1]).toMatch(/\.ml-split\[data-detail="closed"\]\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/);
    expect(css).not.toMatch(/necto-empty:last-child/);
  });
});

describe("T6: the split width is remembered as a ratio of the full width (F2, principle 7)", () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());
  const key = (el: Element, k: string) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  };
  const picked = (stored?: string) => {
    const prefs = new Map<string, string>(stored === undefined ? [] : [["split.traffic", stored]]);
    const m = mount(["api.invalid"], { prefs: { get: (k) => prefs.get(k), set: (k, v) => void prefs.set(k, v) } });
    m.store.ingestNetwork([net("1", 1)]);
    click($(m.root, ".ml-traffic-group"));
    return {
      ...m,
      prefs,
      handle: () => $(m.root, ".ml-split-handle"),
      size: () => $(m.root, ".ml-traffic-main").style.getPropertyValue("--ml-list-size"),
    };
  };

  test("a dragged width is remembered as a ratio and applied in % — so a width shrunk in a narrow window does not make a narrow list in a wide one, and it survives redraws", () => {
    restore = geometry(800);
    const { root, prefs, view, handle, size } = picked();
    expect(handle().classList.contains("necto-resize")).toBe(true);
    expect(handle().previousElementSibling?.classList.contains("ml-traffic-listcol")).toBe(true);
    expect(handle().nextElementSibling?.classList.contains("ml-traffic-detail")).toBe(true);
    drag(handle(), 300, 380, 500);
    expect(prefs.get("split.traffic")).toBe("0.5");
    expect(size()).toBe("50%");
    view.render();
    expect(size()).toBe("50%");
    void root;
  });

  test("the dragged width moves only within the list's and the detail's minimum widths", () => {
    restore = geometry(800);
    const { prefs, handle } = picked();
    drag(handle(), 400, 120);
    expect(prefs.get("split.traffic")).toBe("0.25");
    drag(handle(), 400, 880);
    expect(prefs.get("split.traffic")).toBe("0.65");
  });

  test("opens at the remembered ratio, opens old px values and unreadable values at the default width, and a double click returns to the default width", () => {
    expect(picked("0.4").size()).toBe("40%");
    expect(picked("420").size()).toBe("");
    expect(picked("abc").size()).toBe("");
    const { prefs, handle, size } = picked("0.4");
    handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(prefs.get("split.traffic")).toBe("");
    expect(size()).toBe("");
  });

  test("the handle is a separator reachable by Tab that reports the current width in px in aria-valuenow (as Necto's detail handle does)", () => {
    restore = geometry(800);
    const { handle } = picked("0.5");
    handle().focus();
    expect(handle().getAttribute("role")).toBe("separator");
    expect(handle().getAttribute("tabindex")).toBe("0");
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
    expect(handle().getAttribute("aria-label")).toBeTruthy();
    expect(handle().getAttribute("aria-valuenow")).toBe("400");
    expect(handle().getAttribute("aria-valuemin")).toBe("200");
    expect(handle().getAttribute("aria-valuemax")).toBe("520");
  });

  test("←→ change the width by 24px (converted to a ratio) and remember it, stop at the minimum width and keep focus on the handle", () => {
    restore = geometry(800);
    const { prefs, handle, size } = picked("0.5");
    handle().focus();
    expect(key(handle(), "ArrowRight").defaultPrevented).toBe(true);
    expect(prefs.get("split.traffic")).toBe("0.53");
    expect(size()).toBe("53%");
    expect(handle().getAttribute("aria-valuenow")).toBe("424");
    for (let i = 0; i < 20; i++) key(handle(), "ArrowLeft");
    expect(prefs.get("split.traffic")).toBe("0.25");
    expect(handle().getAttribute("aria-valuenow")).toBe("200");
    expect(document.activeElement).toBe(handle());
  });

  test("with no remembered width, starts from the visible list width and does not exceed the detail's minimum width", () => {
    restore = geometry(800, 500);
    const { prefs, handle } = picked();
    handle().focus();
    expect(handle().getAttribute("aria-valuenow")).toBe("500");
    key(handle(), "ArrowRight");
    expect(prefs.get("split.traffic")).toBe("0.65");
    key(handle(), "ArrowRight");
    expect(prefs.get("split.traffic")).toBe("0.65");
  });

  test("←→ remember nothing when the width is unknown (before drawing)", () => {
    const { prefs, handle } = picked();
    key(handle(), "ArrowRight");
    expect(prefs.get("split.traffic")).toBeUndefined();
  });

  test("focus on the handle survives a redraw", () => {
    const { view, handle } = picked("0.5");
    handle().focus();
    view.render();
    expect(document.activeElement).toBe(handle());
  });
});

describe("on an already mocked request the primary action follows its state — it never silently adds the same response again (K1)", () => {
  const cmdEnter = () => {
    const ev = new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
  };
  const devices: Rule = {
    id: "devices",
    match: { method: "GET", path: "/a/{id}" },
    active: "캡처한 응답",
    responses: { ok: { status: 200 }, "캡처한 응답": { status: 200 } },
  };

  test("after a mock is made from this request it reads 'Mocking · applies from the next request [Open rule]', and ⌘↩ opens the rule", async () => {
    const { root, store, deps } = mount(["api.invalid"], {
      rules: () => [devices],
      captured: (key) =>
        key === "1" ? { rule: "devices", response: "캡처한 응답", applies: true } : undefined,
    });
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    const area = $(root, ".ml-capture");
    expect(area.textContent).toContain("목업 중 · 다음 요청부터 적용됩니다");
    expect(area.querySelector('[data-action="capture"]')).toBeNull();
    expect(area.querySelector("[data-primary]")?.getAttribute("data-action")).toBe("open-rule");
    cmdEnter();
    expect(deps.openRule).toHaveBeenCalledWith("devices", "캡처한 응답");
    expect(deps.capture).not.toHaveBeenCalled();
  });

  test("says so and offers [Send this response to the app] when the response was added to an existing rule but the app still gets another one", async () => {
    const { root, store, deps } = mount(["api.invalid"], {
      rules: () => [{ ...devices, active: "ok" }],
      captured: (key) =>
        key === "1" ? { rule: "devices", response: "캡처한 응답", applies: false } : undefined,
    });
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    const area = $(root, ".ml-capture");
    expect(area.textContent).toContain("GET /a/{id} 규칙에 추가했습니다");
    expect(area.querySelector("[data-primary]")?.getAttribute("data-action")).toBe("open-rule");
    click(area.querySelector('[data-action="activate-done"]'));
    expect(deps.activate).toHaveBeenCalledWith("devices", "캡처한 응답");
  });

  test("says the rule is off when added to a disabled rule, and offers no [Send this response to the app], which would not turn it on", async () => {
    const { root, store } = mount(["api.invalid"], {
      rules: () => [{ ...devices, enabled: false }],
      captured: (key) =>
        key === "1" ? { rule: "devices", response: "캡처한 응답", applies: false } : undefined,
    });
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1)]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    await vi.runAllTimersAsync();
    expect($(root, ".ml-capture").textContent).toContain("규칙이 꺼져 있어");
    expect(root.querySelector('[data-action="activate-done"]')).toBeNull();
  });

  test("opens the matching rule instead of a new empty (overlapping) rule when there is no response to copy", () => {
    const { root, store, deps } = mount(["api.invalid"], {
      networkAvailable: () => false,
      rules: () => [{ ...devices, active: "ok" }],
    });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([
      {
        seq: 1,
        date: 2,
        method: "GET",
        host: "api.invalid",
        path: "/a/1",
        query: {},
        outcome: { passthrough: {} },
      },
    ]);
    click($(root, '.ml-traffic-row[data-key="ours:1"]'));
    expect(root.querySelector('[data-action="empty-rule"]')).toBeNull();
    expect($(root, ".ml-capture [data-primary]").getAttribute("data-action")).toBe("open-rule");
    cmdEnter();
    expect(deps.openRule).toHaveBeenCalledWith("devices");
  });
});

describe("T6: filters are remembered per viewer (principle 7)", () => {
  const shared = (prefs: Map<string, string>, allowed = ["api.invalid"]) =>
    mount(allowed, { prefs: { get: (k) => prefs.get(k), set: (k, v) => void prefs.set(k, v) } });
  const type = (el: Element, value: string) => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  test("remembers the status and result chips, the search text and 'Allowed hosts only', so they are unchanged on reopening", () => {
    const prefs = new Map<string, string>();
    const first = shared(prefs);
    click($(first.root, '[data-chip="4xx"]'));
    click($(first.root, '[data-chip="mocked"]'));
    type($(first.root, '[data-field="traffic-search"]'), "rep");
    const box = $(first.root, '[data-field="allowed-only"]') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const { root } = shared(prefs);
    expect($(root, '[data-chip="4xx"]').getAttribute("aria-pressed")).toBe("true");
    expect($(root, '[data-chip="mocked"]').getAttribute("aria-pressed")).toBe("true");
    expect($(root, '[data-chip="2xx"]').getAttribute("aria-pressed")).toBe("false");
    expect(($(root, '[data-field="traffic-search"]') as HTMLInputElement).value).toBe("rep");
    expect(($(root, '[data-field="allowed-only"]') as HTMLInputElement).checked).toBe(false);
  });

  test("remembers an empty search after clearing the field with Esc", () => {
    const prefs = new Map<string, string>();
    const first = shared(prefs);
    type($(first.root, '[data-field="traffic-search"]'), "rep");
    const search = $(first.root, '[data-field="traffic-search"]'); // Every input redraws the toolbar
    search.focus();
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(($(shared(prefs).root, '[data-field="traffic-search"]') as HTMLInputElement).value).toBe("");
  });

  test("does not remember 'Allowed hosts only' unless chosen directly — so the rule that the first host does not turn it on still holds", () => {
    const prefs = new Map<string, string>();
    const first = shared(prefs, []);
    click($(first.root, '[data-chip="5xx"]'));
    expect(JSON.parse(prefs.get("traffic.filters")!)).not.toHaveProperty("allowedOnly");
  });

  test("opens with the default filters when the stored value is broken or unknown", () => {
    const broken = shared(new Map([["traffic.filters", "{bad"]]));
    expect(broken.root.querySelector('[data-chip][aria-pressed="true"]')).toBeNull();
    const odd = shared(
      new Map([
        [
          "traffic.filters",
          JSON.stringify({ statuses: ["9xx", "2xx"], results: ["nope"], search: 3 }),
        ],
      ]),
    );
    expect(
      [...odd.root.querySelectorAll('[data-chip][aria-pressed="true"]')].map((c) =>
        c.getAttribute("data-chip"),
      ),
    ).toEqual(["2xx"]);
    expect(($(odd.root, '[data-field="traffic-search"]') as HTMLInputElement).value).toBe("");
  });
});

describe("T6: the viewed position holds while new requests stack on top (principle 5)", () => {
  const rowH = 26;
  let restore: () => void = () => undefined;
  afterEach(() => restore());
  /**
   * jsdom does no layout — measures as if the list pane (260 high) and rows (26px each below the
   * header, shifted up by the scroll) were drawn.
   */
  const layout = () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const rect = (top: number, height: number) =>
        ({
          x: 0,
          y: top,
          left: 0,
          top,
          right: 600,
          bottom: top + height,
          width: 600,
          height,
          toJSON: () => ({}),
        }) as DOMRect;
      if (this.classList.contains("ml-traffic-list")) return rect(100, 260);
      const list = this.closest(".ml-traffic-list") as HTMLElement | null;
      if (this.matches("tbody > tr") && list)
        return rect(
          100 + rowH + [...this.parentElement!.children].indexOf(this) * rowH - list.scrollTop,
          rowH,
        );
      return original.call(this);
    };
    restore = () => { HTMLElement.prototype.getBoundingClientRect = original; };
  };
  const timeView = () => {
    const m = mount();
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork(Array.from({ length: 12 }, (_, i) => net(`${i}`, i + 1, `/p/${i}`)));
    return { ...m, list: () => $(m.root, ".ml-traffic-list") };
  };

  test("while scrolled down in the time view, the viewed row does not move on screen as new requests stack on top", () => {
    layout();
    const { store, list, root } = timeView();
    list().scrollTop = 52;
    const top = () =>
      [...root.querySelectorAll("tbody > tr")]
        .find((r) => r.getBoundingClientRect().bottom > 100)!
        .getAttribute("data-key");
    const seen = top();
    store.ingestNetwork([net("new1", 100, "/n/1"), net("new2", 101, "/n/2")]);
    expect(list().scrollTop).toBe(52 + 2 * rowH);
    expect(top()).toBe(seen);
  });

  test("holds the position with focus in the list (browsing by keyboard) too — restoring focus does not undo the scroll", () => {
    layout();
    const { store, list } = timeView();
    list().focus();
    list().scrollTop = 52;
    store.ingestNetwork([net("new1", 100, "/n/1")]);
    expect(list().scrollTop).toBe(52 + rowH);
    expect(document.activeElement).toBe(list());
  });

  test("leaves new requests stacking on top while viewing the top (scroll 0) — that is the live position", () => {
    layout();
    const { store, list } = timeView();
    store.ingestNetwork([net("new1", 100, "/n/1")]);
    expect(list().scrollTop).toBe(0);
  });

  test("at the top with the selected row scrolled out of view, the rows in view hold still", () => {
    layout();
    const { store, list, root } = timeView();
    click($(root, '.ml-traffic-row[data-key="0"]'));
    list().scrollTop = 0;
    const at = () => $(root, '.ml-traffic-row[data-key="10"]').getBoundingClientRect().top;
    const before = at();
    store.ingestNetwork([net("new1", 100, "/n/1")]);
    expect(at()).toBe(before);
  });

  test("'Show newest' scrolls to the top, where the newest is", () => {
    layout();
    const { store, list, root } = timeView();
    click($(root, '.ml-traffic-row[data-key="5"]'));
    store.ingestNetwork([net("new1", 100, "/n/1")]);
    expect(list().scrollTop).toBeGreaterThan(0);
    click($(root, '[data-newer] [data-action="show-newest"]'));
    expect(list().scrollTop).toBe(0);
    expect($(root, '.ml-traffic-row[data-key="new1"]').getAttribute("aria-selected")).toBe("true");
  });

  test("holds a visible selected row's screen position even at the top, with the list flowing", () => {
    layout();
    const { store, list, root } = timeView();
    click($(root, '.ml-traffic-row[data-key="9"]'));
    const at = () => $(root, '.ml-traffic-row[data-key="9"]').getBoundingClientRect().top;
    const before = at();
    store.ingestNetwork([net("new1", 100, "/n/1")]);
    expect(list().scrollTop).toBe(rowH);
    expect(at()).toBe(before);
  });
});

describe("the list follows the filters strictly, and the detail reports a hidden selected request (U5)", () => {
  const key = (el: Element, k: string) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  };
  const listbox = (root: ParentNode) => $(root, '[role="listbox"]');
  const note = (root: ParentNode) => root.querySelector(".ml-traffic-detail [data-hidden-note]");
  const keys = (root: ParentNode) =>
    [...root.querySelectorAll(".ml-traffic-row")].map((e) => e.getAttribute("data-key"));
  /** Time order (newest on top): 5(200) 4(404) 3(200) 2(404) 1(200). Selecting 3 and showing only 4xx hides 3. */
  const timeHidden = () => {
    const m = mount();
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork(
      [1, 2, 3, 4, 5].map((i) => ({
        ...net(`${i}`, i, `/p/${i}`),
        statusCode: i % 2 === 0 ? 404 : 200,
      })),
    );
    click($(m.root, '.ml-traffic-row[data-key="3"]'));
    click($(m.root, '[data-chip="4xx"]'));
    return m;
  };

  test("time view: a selected request that fails the status chip is not in the list, and the open detail says so in one line and offers [Clear filters]", () => {
    const { root } = timeHidden();
    expect(keys(root)).toEqual(["4", "2"]);
    expect(root.querySelector('[role="option"][aria-selected="true"]')).toBeNull();
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("3");
    expect(note(root)!.textContent).toContain("지금 필터에 맞지 않아 목록에서 숨겨졌습니다");
    expect(note(root)!.querySelector('[data-action="clear-filters"]')!.textContent).toBe("필터 지우기");
  });

  test("[Clear filters] looks like a button, not text (V2)", () => {
    const { root } = timeHidden();
    const button = note(root)!.querySelector('[data-action="clear-filters"]')!;
    expect(button.classList.contains("necto-button")).toBe(true);
    expect(button.classList.contains("necto-button-quiet")).toBe(false);
  });

  test("[Clear filters] brings back every row, shows the selected row selected again and removes the notice", () => {
    const { root, prefs } = timeHidden();
    click($(root, '[data-action="clear-filters"]'));
    expect(keys(root)).toEqual(["5", "4", "3", "2", "1"]);
    expect($(root, '.ml-traffic-row[data-key="3"]').getAttribute("aria-selected")).toBe("true");
    expect($(root, '[data-chip="4xx"]').getAttribute("aria-pressed")).toBe("false");
    expect(note(root)).toBeNull();
    expect(document.activeElement).toBe(listbox(root));
    expect(JSON.parse(prefs.get("traffic.filters")!).statuses).toEqual([]);
  });

  test("the notice also disappears when turning a chip off makes the row visible again", () => {
    const { root } = timeHidden();
    click($(root, '[data-chip="4xx"]'));
    expect(note(root)).toBeNull();
    expect($(root, '.ml-traffic-row[data-key="3"]').getAttribute("aria-selected")).toBe("true");
  });

  test("[Clear filters] also turns off 'Allowed hosts only' when that hid the request", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1, "/a", "api.invalid"), net("2", 2, "/b", "other.invalid")]);
    click($(root, '[data-field="other-hosts"]'));
    click($(root, '.ml-traffic-row[data-key="2"]'));
    click($(root, '[data-field="allowed-only"]'));
    expect(keys(root)).toEqual(["1"]);
    expect(note(root)).not.toBeNull();
    click($(root, '[data-action="clear-filters"]'));
    expect(keys(root)).toEqual(["2", "1"]);
    expect(note(root)).toBeNull();
  });

  test("from a hidden selected request, ↓ goes to the next visible row below in list order, and ↑ to the next visible row above", () => {
    const down = timeHidden();
    listbox(down.root).focus();
    expect(key(listbox(down.root), "ArrowDown").defaultPrevented).toBe(true);
    expect($(down.root, ".ml-traffic-detail").getAttribute("data-key")).toBe("2");
    const up = timeHidden();
    listbox(up.root).focus();
    key(listbox(up.root), "ArrowUp");
    expect($(up.root, ".ml-traffic-detail").getAttribute("data-key")).toBe("4");
    expect(note(up.root)).toBeNull();
  });

  test("goes to the nearest row on the other side when no visible row is below (above)", () => {
    const m = mount();
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork([{ ...net("1", 1, "/p/1"), statusCode: 404 }, net("2", 2, "/p/2")]);
    click($(m.root, '.ml-traffic-row[data-key="1"]'));
    click($(m.root, '[data-chip="2xx"]'));
    listbox(m.root).focus();
    key(listbox(m.root), "ArrowDown");
    expect($(m.root, ".ml-traffic-detail").getAttribute("data-key")).toBe("2");
  });

  test("endpoint view: a group that fails the filter has no row, and ↓ and ↑ go to the nearest group in first-seen order", () => {
    const setup = () => {
      const m = mount();
      m.store.ingestNetwork([
        { ...net("1", 1, "/a"), statusCode: 404 },
        net("2", 2, "/b"),
        { ...net("3", 3, "/c"), statusCode: 404 },
      ]);
      click($(m.root, '.ml-traffic-group[data-group="GET api.invalid /b"]'));
      click($(m.root, '[data-chip="4xx"]'));
      return m;
    };
    const m = setup();
    expect(
      [...m.root.querySelectorAll(".ml-traffic-group")].map((e) => e.getAttribute("data-group")),
    ).toEqual(["GET api.invalid /a", "GET api.invalid /c"]);
    expect(note(m.root)).not.toBeNull();
    listbox(m.root).focus();
    key(listbox(m.root), "ArrowDown");
    expect($(m.root, ".ml-traffic-detail").getAttribute("data-key")).toBe("3");
    const n = setup();
    listbox(n.root).focus();
    key(listbox(n.root), "ArrowUp");
    expect($(n.root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
  });

  test("↓ changes nothing when no row is visible", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-chip="5xx"]'));
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    expect($(root, ".ml-traffic-detail").getAttribute("data-key")).toBe("1");
  });

  test("a selected request that passes the filter has no notice", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([{ ...net("1", 1, "/a/1"), statusCode: 404 }]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-chip="4xx"]'));
    expect(note(root)).toBeNull();
  });
});

describe("U5: when the selected row is filtered out, the nearest visible row holds the position", () => {
  const rowH = 26;
  let restore: () => void = () => undefined;
  afterEach(() => restore());
  const layout = () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const rect = (top: number, height: number) =>
        ({
          x: 0,
          y: top,
          left: 0,
          top,
          right: 600,
          bottom: top + height,
          width: 600,
          height,
          toJSON: () => ({}),
        }) as DOMRect;
      if (this.classList.contains("ml-traffic-list")) return rect(100, 260);
      const list = this.closest(".ml-traffic-list") as HTMLElement | null;
      if (this.matches("tbody > tr") && list)
        return rect(
          100 + rowH + [...this.parentElement!.children].indexOf(this) * rowH - list.scrollTop,
          rowH,
        );
      return original.call(this);
    };
    restore = () => { HTMLElement.prototype.getBoundingClientRect = original; };
  };

  test("when a chip hides the selected row (9), the visible row just below it (8) stays at the same screen position", () => {
    layout();
    const m = mount();
    click($(m.root, '[data-mode="time"]'));
    m.store.ingestNetwork(
      Array.from({ length: 12 }, (_, i) => ({
        ...net(`${i}`, i + 1, `/p/${i}`),
        statusCode: i === 9 ? 200 : 404,
      })),
    );
    click($(m.root, '.ml-traffic-row[data-key="9"]'));
    const list = $(m.root, ".ml-traffic-list");
    list.scrollTop = 52;
    const before = $(m.root, '.ml-traffic-row[data-key="8"]').getBoundingClientRect().top;
    click($(m.root, '[data-chip="4xx"]'));
    expect(m.root.querySelector('.ml-traffic-row[data-key="9"]')).toBeNull();
    expect($(m.root, '.ml-traffic-row[data-key="8"]').getBoundingClientRect().top).toBe(before);
  });
});

describe("redrawing the detail does not lose focus (S1, K1, principle 2)", () => {
  const key = (el: Element | Document, k: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };
  const listbox = (root: ParentNode) => $(root, '[role="listbox"]');
  const inDetail = (root: ParentNode) => !!root.querySelector(".ml-traffic-detail")?.contains(document.activeElement);

  test("Return while the detail loads does not go to ×, and focus goes to the primary action once loaded", async () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/b")]);
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    key(listbox(root), "Enter");
    expect(document.activeElement).not.toBe($(root, '[data-action="deselect"]'));
    expect(inDetail(root)).toBe(true);
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe($(root, '[data-action="capture"]'));
    key(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(listbox(root));
  });

  test("in the endpoint view, focus on the primary action survives the detail following a new call in the same group", async () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1")]);
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    await vi.runAllTimersAsync();
    key(listbox(root), "Enter");
    expect(document.activeElement).toBe($(root, '[data-action="capture"]'));
    store.ingestNetwork([net("2", 2, "/a/2")]);
    expect($(root, ".ml-traffic-detail").dataset.key).toBe("2");
    expect(inDetail(root)).toBe(true);
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe($(root, '[data-action="capture"]'));
  });

  test("in the time view, after selecting a pending request and pressing Return, focus stays in the detail and moves to the primary action when the request finishes", async () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([{ ...net("1", 1), state: "pending", statusCode: undefined, durationMilliseconds: undefined }]);
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    key(listbox(root), "Enter");
    expect(document.activeElement).not.toBe($(root, '[data-action="deselect"]'));
    expect(inDetail(root)).toBe(true);
    store.ingestNetwork([net("1", 1)]);
    expect(inDetail(root)).toBe(true);
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe($(root, '[data-action="capture"]'));
  });

  test("focus on the 'Rule path' picker survives the detail arriving", async () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([net("1", 1, "/a/1")]);
    listbox(root).focus();
    key(listbox(root), "ArrowDown");
    $(root, '[data-field="capture-path"]').focus();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe($(root, '[data-field="capture-path"]'));
  });

  test("the 'Rule path' menu left open keeps its node, and so its choice, when a new request arrives", async () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, ".ml-traffic-group"));
    await vi.runAllTimersAsync();
    const menu = $(root, '[data-field="capture-path"]');
    menu.focus();
    store.ingestNetwork([net("2", 2, "/b/2")]);
    await vi.runAllTimersAsync();
    expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(2);
    expect($(root, '[data-field="capture-path"]')).toBe(menu);
    expect(document.activeElement).toBe(menu);
  });

  test("paging with ‹› keeps focus on the button, and moves it to the primary action when the button is disabled at the end", async () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1"), net("2", 2, "/a/2"), net("3", 3, "/a/3")]);
    click($(root, ".ml-traffic-group"));
    await vi.runAllTimersAsync();
    $(root, '[data-action="older"]').focus();
    click($(root, '[data-action="older"]'));
    expect(document.activeElement).toBe($(root, '[data-action="older"]'));
    click($(root, '[data-action="older"]'));
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe($(root, '[data-action="capture"]'));
  });

  test("clearing the selection with × moves focus to the list", async () => {
    const { root, store } = mount();
    store.ingestNetwork([net("1", 1, "/a/1")]);
    click($(root, ".ml-traffic-group"));
    await vi.runAllTimersAsync();
    $(root, '[data-action="deselect"]').focus();
    click($(root, '[data-action="deselect"]'));
    expect(document.activeElement).toBe(listbox(root));
  });
});

describe("our record stays the same request when it pairs with a Necto record and its key changes (S2, S3, S4)", () => {
  const ours = (seq: number, at: number, path: string): RequestEvent =>
    ({ seq, date: at + 1, method: "GET", host: "api.invalid", path, query: {}, outcome: { passthrough: {} } });

  test("does not count an already seen request as new when it pairs after the Necto subscription reattaches during a pause", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([ours(1, 1000, "/p1"), ours(2, 2000, "/p2"), ours(3, 3000, "/p3")]);
    click($(root, '.ml-traffic-row[data-key="ours:3"]'));
    click($(root, '[data-action="pause"]'));
    expect($(root, "[data-pause-strip]").textContent).toContain("새 요청 없음");
    store.ingestNetwork([net("n1", 1000, "/p1"), net("n2", 2000, "/p2"), net("n3", 3000, "/p3")]);
    expect($(root, "[data-pause-strip]").textContent).toContain("새 요청 없음");
    store.ingestNetwork([net("n4", 4000, "/p4")]);
    expect($(root, "[data-pause-strip]").textContent).toContain("새 요청 1개");
  });

  test("does not count a request seen at selection as newer when it pairs, with the list flowing", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([ours(1, 1000, "/p1"), ours(2, 2000, "/p2"), ours(3, 3000, "/p3")]);
    click($(root, '.ml-traffic-row[data-key="ours:1"]'));
    store.ingestNetwork([net("n1", 1000, "/p1"), net("n2", 2000, "/p2"), net("n3", 3000, "/p3")]);
    expect(root.querySelector("[data-newer]")).toBeNull();
    store.ingestNetwork([net("n4", 4000, "/p4")]);
    expect($(root, "[data-newer]").textContent).toContain("고른 뒤 새 요청 1개");
  });

  test("endpoint view: when the selected request pairs, its row stays selected and the detail shows that request (the Necto record)", () => {
    const { root, store } = mount();
    store.ingestOurs([ours(1, 1000, "/a/1")]);
    click($(root, ".ml-traffic-group"));
    expect($(root, ".ml-traffic-detail").dataset.key).toBe("ours:1");
    store.ingestNetwork([net("n1", 1000, "/a/1")]);
    expect(root.querySelector('[role="option"][aria-selected="true"]')).not.toBeNull();
    expect($(root, ".ml-traffic-detail").dataset.key).toBe("n1");
    expect(root.querySelector("[data-hidden-note]")).toBeNull();
  });

  test("time view (paused): when the selected request pairs, its row in the paused list stays selected and the detail follows", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([ours(1, 1000, "/a/1"), ours(2, 2000, "/b")]);
    click($(root, '.ml-traffic-row[data-key="ours:1"]'));
    click($(root, '[data-action="pause"]'));
    store.ingestNetwork([net("n1", 1000, "/a/1")]);
    const selected = root.querySelectorAll('[role="option"][aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect((selected[0] as HTMLElement).dataset.target).toBe("n1");
    expect($(root, ".ml-traffic-detail").dataset.key).toBe("n1");
  });

  test("the detail says the request is hidden while it is absent from the paused list, even when the hidden selected request finishes and now passes the filter", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([
      net("0", 0),
      { ...net("1", 1), state: "pending", statusCode: undefined, durationMilliseconds: undefined },
    ]);
    click($(root, '.ml-traffic-row[data-key="1"]'));
    click($(root, '[data-action="pause"]'));
    click($(root, '[data-chip="2xx"]'));
    expect(root.querySelector("[data-hidden-note]")).not.toBeNull();
    store.ingestNetwork([net("1", 1)]);
    expect([...root.querySelectorAll<HTMLElement>(".ml-traffic-row")].map((r) => r.dataset.key)).toEqual(["0"]);
    expect(root.querySelector("[data-hidden-note]")).not.toBeNull();
  });
});

describe("a mocking rule shows by a name people know, not its internal id (Q3)", () => {
  const ours = (seq: number, path: string, outcome: object) =>
    ({
      seq,
      date: seq,
      method: "GET",
      host: "api.invalid",
      path,
      query: {},
      outcome,
    }) as RequestEvent;
  const sites: Rule = {
    id: "new-rule",
    enabled: true,
    tags: [],
    match: { method: "GET", path: "/api/sites", query: { page: "1" } },
    active: "ok",
    responses: { ok: { status: 200 } },
  };

  test("the result cell, the title and the detail summary name the rule's method, path and query conditions", () => {
    const { root, store } = mount(["api.invalid"], { networkAvailable: () => false, rules: () => [sites] });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([ours(1, "/api/sites", { mocked: { rule: "new-rule", response: "ok" } })]);
    const result = $(root, '.ml-traffic-row[data-key="ours:1"] [data-cell="result"]');
    expect(result.querySelector(".ml-result-rule")!.textContent).toBe("GET /api/sites ?page=1");
    expect((result.querySelector(".ml-result") as HTMLElement).title).toBe("목업 · 규칙 GET /api/sites ?page=1 · 응답 ok");
    click($(root, '.ml-traffic-row[data-key="ours:1"]'));
    const facts = $(root, ".ml-detail-facts").textContent!;
    expect(facts).toContain("GET /api/sites ?page=1");
    expect(facts).not.toContain("new-rule");
  });

  test("editing a rule's path updates the name in rows already drawn", () => {
    let rules = [sites];
    const { root, store, view } = mount(["api.invalid"], { networkAvailable: () => false, rules: () => rules });
    click($(root, '[data-mode="time"]'));
    store.ingestOurs([ours(1, "/api/sites", { mocked: { rule: "new-rule", response: "ok" } })]);
    rules = [{ ...sites, match: { method: "GET", path: "/api/v2/sites" } }];
    view.update();
    expect($(root, '.ml-traffic-row[data-key="ours:1"] .ml-result-rule').textContent).toBe("GET /api/v2/sites");
  });
});

describe("rows show the query — so the reason a query search matched is visible (Q1)", () => {
  const at = (id: string, t: number, query: string, path = "/api/sites") => ({
    ...net(id, t, path),
    url: `https://api.invalid${path}${query}`,
  });
  const pathCell = (root: HTMLElement, sel: string) => $(root, `${sel} [data-cell="path"]`);

  test("time view: a dimmed query after the path, shown in full in the title when truncated", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([at("1", 1, "?page=1&size=20"), at("2", 2, "")]);
    const q = pathCell(root, '.ml-traffic-row[data-key="1"]').querySelector("[data-query]") as HTMLElement;
    expect(q.textContent).toBe("?page=1&size=20");
    expect(q.title).toBe("?page=1&size=20");
    expect(q.classList.contains("ml-req-query")).toBe(true);
    expect(q.previousElementSibling?.classList.contains("ml-tail")).toBe(true);
    expect(pathCell(root, '.ml-traffic-row[data-key="2"]').querySelector("[data-query]")).toBeNull();
  });

  test("a percent-encoded query shows as readable text (so a match on the decoded text shows in the row)", () => {
    const { root, store } = mount();
    click($(root, '[data-mode="time"]'));
    store.ingestNetwork([at("1", 1, "?q=%ED%95%9C%EA%B8%80")]);
    expect($(root, '.ml-traffic-row[data-key="1"] [data-query]').textContent).toBe("?q=한글");
  });

  test("endpoint view: several queries show as 'N queries' with a few in the title instead of a list, and a single query shows as is", () => {
    const { root, store } = mount();
    store.ingestNetwork([at("1", 1, "?page=1"), at("2", 2, "?page=2"), at("3", 3, ""), at("4", 4, "?v=1", "/api/one")]);
    const sites = $(root, '.ml-traffic-group[data-group="GET api.invalid /api/sites"]');
    const hint = sites.querySelector("[data-query-kinds]") as HTMLElement;
    expect(hint.textContent).toBe("쿼리 3종");
    expect(hint.title).toContain("?page=1");
    expect(hint.title).toContain("?page=2");
    expect(hint.title).toContain("(쿼리 없음)");
    expect(sites.querySelector("[data-query]")).toBeNull();
    const one = $(root, '.ml-traffic-group[data-group="GET api.invalid /api/one"]');
    expect(one.querySelector("[data-query]")!.textContent).toBe("?v=1");
    expect(one.querySelector("[data-query-kinds]")).toBeNull();
  });

  test("endpoint view: the title of 'N queries' shows only a few and counts the rest", () => {
    const { root, store } = mount();
    store.ingestNetwork(Array.from({ length: 8 }, (_, i) => at(String(i + 1), i + 1, `?page=${i + 1}`)));
    const hint = $(root, ".ml-traffic-group [data-query-kinds]");
    expect(hint.textContent).toBe("쿼리 8종");
    expect(hint.title.split("\n")).toHaveLength(6);
    expect(hint.title).toContain("외 3종");
  });

  test("after a query search the remaining rows show that query (endpoint view)", () => {
    const { root, store } = mount();
    store.ingestNetwork([at("1", 1, "?page=1&size=20"), at("2", 2, "?page=2&size=20")]);
    const search = $(root, '[data-field="traffic-search"]') as HTMLInputElement;
    search.value = "page=1";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const rows = root.querySelectorAll(".ml-traffic-group");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector("[data-query]")!.textContent).toBe("?page=1&size=20");
  });

  test("a call with a new query turns the group row into 'N queries'", () => {
    const { root, store } = mount();
    store.ingestNetwork([at("1", 1, "?page=1")]);
    expect($(root, ".ml-traffic-group [data-query]").textContent).toBe("?page=1");
    store.ingestNetwork([at("2", 2, "?page=2")]);
    expect($(root, ".ml-traffic-group [data-query-kinds]").textContent).toBe("쿼리 2종");
  });

  test("CSS contract: the query is dimmed, truncated at the end (not at the start like the path) and shrinks before the path", () => {
    const body = (sel: string) =>
      css.match(new RegExp(`${sel.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    const q = body(".ml-req-query");
    expect(q).toMatch(/color:\s*var\(--necto-text-(secondary|tertiary)\)/);
    expect(q).toMatch(/text-overflow:\s*ellipsis/);
    expect(q).not.toMatch(/direction:\s*rtl/);
    expect(q).toMatch(/flex:\s*0 10 auto/);
  });
});

// MARK: Empty states (design.md: says what is missing and what to do next)

const empty = (root: ParentNode) => root.querySelector<HTMLElement>('[data-empty="traffic"]');

test("with no requests yet, the list shows Necto's empty state saying so, and it goes when the first request arrives", () => {
  const { root, store } = mount();
  expect(empty(root)?.classList.contains("necto-empty")).toBe(true);
  expect(empty(root)?.hidden).toBe(false);
  expect($(root, '[data-empty="traffic"] .necto-empty-title').textContent).toBe("아직 요청이 없습니다");
  expect(empty(root)?.textContent).toContain("앱에서 요청을 보내면 여기에 표시됩니다");
  store.ingestNetwork([net("1", 1, "/a/1")]);
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(1);
  expect(empty(root)?.hidden).toBe(true);
});

test("when filters hide every request, the empty state says so instead of 'no requests yet' and clears them", () => {
  const { root, store } = mount();
  store.ingestNetwork([net("1", 1, "/a/1")]);
  const search = $(root, '[data-field="traffic-search"]') as HTMLInputElement;
  search.value = "zzz";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(empty(root)?.hidden).toBe(false);
  expect($(root, '[data-empty="traffic"] .necto-empty-title').textContent).toBe("필터에 맞는 요청이 없습니다");
  expect(empty(root)?.textContent).not.toContain("아직 요청이 없습니다");
  click($(root, '[data-empty="traffic"] [data-action="clear-filters"]'));
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(1);
  expect(empty(root)?.hidden).toBe(true);
});

test("the empty state sits outside the listbox, so the list holds only options", () => {
  const { root } = mount();
  expect(root.querySelector('.ml-traffic-list [data-empty="traffic"]')).toBeNull();
});

test("when only the allowed-hosts filter hides every request, the empty state's button clears that too", () => {
  const { root, store } = mount(["api.invalid"]);
  store.ingestNetwork([net("1", 1, "/a/1", "other.invalid")]);
  expect($(root, '[data-empty="traffic"] .necto-empty-title').textContent).toBe("필터에 맞는 요청이 없습니다");
  click($(root, '[data-empty="traffic"] [data-action="clear-filters"]'));
  expect(root.querySelectorAll(".ml-traffic-group")).toHaveLength(1);
});

test("a hidden empty state takes no room: necto-empty's display:flex would otherwise beat the hidden attribute", () => {
  expect(css).toMatch(/\.ml-traffic-empty\[hidden\]\s*\{[^}]*display:\s*none/);
});

test("the capture area names the rule's path and the headers it doesn't copy in plain words", async () => {
  const { root, store, deps } = mount(["api.invalid"]);
  deps.detail = vi.fn(async (id: string): Promise<NetworkDetail> => ({
    ...net(id, 0),
    requestHeaders: {},
    responseHeaders: { "Content-Length": "2", "Content-Type": "application/json" },
    responseBody: { byteCount: 2, isTruncated: false, text: "{}" },
  }));
  click($(root, '[data-mode="time"]'));
  store.ingestNetwork([net("1", 1)]);
  click($(root, '.ml-traffic-row[data-key="1"]'));
  await vi.runAllTimersAsync();
  const area = $(root, ".ml-capture").textContent!;
  expect(area).toContain("규칙 경로");
  expect(area).toContain("복사하지 않는 서버 헤더 1개");
});
