//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "../localization";
import { captureFocus, h, isTextEntry, restoreFocus, type Attrs, type Focus } from "../dom";
import type { Configuration, NetworkDetail, ResultKind, Rule, TrafficEntry } from "../types";
import { captureArea } from "./capture-area";
import { formatClock, formatDuration } from "./format";
import { fullURL, groupKey, sentQuery } from "./keys";
import { emptyFilters, groups, statusClass, visible, type Filters, type Group, type StatusChip } from "./listing";
import type { QueryMiss } from "./match";
import { orderWarningText, type OrderDetector } from "./order";
import { navigate, optionId, revealSelected, syncActive } from "../listbox";
import { applySplit, readSplit, splitHandle } from "../split";
import { isRule, ruleLabel } from "../rules";
import type { TrafficStore } from "./store";

export interface TrafficDeps {
  store: TrafficStore;
  order: OrderDetector;
  allowedHosts(): string[];
  /// Whether the app's code blocked this host (`blockedHosts`). Rules for it never mock.
  isBlockedHost(host: string): boolean;
  addAllowedHost(host: string): void;
  detail(id: string): Promise<NetworkDetail>;
  networkAvailable(): boolean;
  /// Necto's reason the network plugin is unavailable, to show as-is.
  networkUnavailableReason?(): string | undefined;
  rules(): Configuration["rules"];
  /// With `into`, adds to that disabled rule, and with `turnOn` also makes the response the
  /// active one and turns the rule on. `query` becomes a new rule's conditions and is passed
  /// only when the user limits the rule to this query.
  capture(
    entry: TrafficEntry,
    detail: NetworkDetail,
    path: string,
    into: string | undefined,
    query?: Record<string, string>,
    turnOn?: boolean,
  ): void;
  /// A rule with an empty 200, for when there is no real response to carry over (no network
  /// plugin, blocked, no Necto record, or the record expired).
  emptyRule(entry: TrafficEntry, path: string, query?: Record<string, string>): void;
  /// A rule for this request's query alone, beside the rule `from` that answered it for every
  /// query: the same match with the query as conditions, starting from that rule's active
  /// response. Having more conditions, it answers this query from the next request.
  ruleForQuery(entry: TrafficEntry, from: string): void;
  /// A rule made from traffic with query conditions that has not answered a request since,
  /// and the conditions it failed on for this later request it fits otherwise.
  unkept(entry: TrafficEntry): Unkept | undefined;
  /// Removes one query condition from a rule.
  removeCondition(rule: string, key: string): void;
  /// Opens the rule on the rules tab, showing `response` when given.
  openRule(id: string, response?: string): void;
  /// The mock made from this request, while the rule still has that response; deleting it
  /// allows capturing again.
  captured(key: string): CaptureDone | undefined;
  /// Makes the response the rule's active one, so the app receives it.
  activate(rule: string, response: string): void;
  /// Map Local's master switch, and turning it on.
  mapLocalEnabled(): boolean;
  enableMapLocal(): void;
  /// Turns a rule on.
  enableRule(id: string): void;
  prefs: { get(k: string): string | undefined; set(k: string, v: string): void };
}

export interface Unkept {
  rule: Rule;
  misses: QueryMiss[];
  /// The one condition whose removal makes the rule answer this request, when there is one.
  remove?: string;
}

export interface CaptureDone {
  rule: string;
  response: string;
  /// Whether the app receives this response from its next request: the rule is on, the
  /// response is active, and the host is not blocked.
  applies: boolean;
  /// The request's host is blocked by the app's code, so no rule mocks it.
  blockedHost?: boolean;
}

type Mode = "endpoint" | "time";
interface Row { id: string; sig: string; build(): HTMLElement }

/// The key to incremental updates: a row id, and a signature that changes whenever what the
/// row shows changes.
const row = (id: string, sig: string, make: () => HTMLElement): Row => ({ id, sig, build: () => {
  const el = make();
  el.id = optionId("ml-t", id);
  el.setAttribute("role", "option");
  el.dataset.row = id;
  el.dataset.sig = sig;
  return el;
} });

const statusChips = (): Array<[StatusChip, string]> => [
  ["2xx", "2xx"],
  ["3xx", "3xx"],
  ["4xx", "4xx"],
  ["5xx", "5xx"],
  ["failed", t("Connection failed")],
];
const resultChips = (): Array<[ResultKind, string]> => [
  ["mocked", t("Mocked")],
  ["passthrough", t("Real server")],
  ["blocked", t("Blocked")],
  ["unknown", t("Unknown")],
];
function resultTitle(kind: ResultKind): string {
  switch (kind) {
    case "mocked": return t("Mocked");
    case "passthrough": return t("Went to the real server without a rule");
    case "blocked": return t("Blocked by Map Local: requests without a rule don't reach the network");
    case "unknown": return t("Couldn't match this with Map Local's records, so the result is unknown");
  }
}
const statusTone = { "2xx": "ok", "3xx": "info", "4xx": "warning", "5xx": "danger", failed: "danger" } as const;
const offHostTitle = () => t("Not an allowed host, so mocking and blocking don't apply");
const slowMs = 1000;
const detailCacheSize = 20;
const pluginMissing = () => t("Register URLSessionNetworkPlugin after Map Local to see responses");
const recordGone = () => t("The app has dropped this record (app relaunch or storage limit)");
const notInNecto = () => t("This request isn't in Necto's records, so its response can't be shown");
/// The order warning needs evidence to settle for a second, so check again after the last
/// update.
const warningRecheckMs = 1100;

interface HeldFocus { focus: Focus | undefined; inDetail: boolean }

/// The hour is wrapped on its own so the CSS can drop it in a narrow list.
const clock = (ms: number) => {
  const text = formatClock(ms);
  return h(
    "span",
    { class: "ml-clock", title: text },
    h("span", { class: "ml-clock-hour" }, text.slice(0, 3)),
    text.slice(3),
  );
};

function ago(ms: number, now: number) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  return seconds < 60
    ? t("{n}s ago", { n: seconds })
    : seconds < 3600
      ? t("{n}m ago", { n: Math.floor(seconds / 60) })
      : t("{n}h ago", { n: Math.floor(seconds / 3600) });
}

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes}B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)}KB`
      : `${(bytes / 1024 / 1024).toFixed(1)}MB`;

const resultLabel = (r: ResultKind) => resultChips().find(([k]) => k === r)![1];

/// A rule id to the name people know it by (method, path, query conditions), or the id once
/// the rule is gone.
type RuleName = (id: string) => string;

/// The result text for the detail summary and row signatures. A mock names its rule and
/// response.
function resultText(e: TrafficEntry, name: RuleName) {
  return e.result === "mocked" && e.mockedBy
    ? t("Mocked ({rule} · {response})", { rule: name(e.mockedBy.rule), response: e.mockedBy.response })
    : resultLabel(e.result);
}

function statusText(e: TrafficEntry) {
  if (e.state === "pending") return "…";
  if (e.state === "failed") return t("Connection failed");
  return e.status === undefined ? "" : String(e.status);
}

/// The same status dot as Necto's Network panel. A finished request with no status gets
/// nothing rather than a bare dot.
function statusMark(e: TrafficEntry) {
  if (e.state === "pending") return h("span", { class: "necto-status necto-status-idle", title: t("Waiting for the response") }, "…");
  const kind = statusClass(e);
  if (!kind) return "";
  return h("span", { class: `necto-status necto-status-${statusTone[kind]}`, title: statusText(e) }, statusText(e));
}

/// The result pill. The default, passthrough, stays quiet; only mocked and blocked stand out
/// in colour.
function resultPill(e: TrafficEntry, name: RuleName) {
  const by = e.result === "mocked" ? e.mockedBy : undefined;
  const rule = by && name(by.rule);
  const title = by
    ? t("Mocked · rule {rule} · response {response}", { rule: rule!, response: by.response })
    : resultTitle(e.result);
  return h(
    "span",
    { class: "ml-result-cell" },
    h(
      "span",
      { class: `necto-badge ml-result ml-result-${e.result}`, "data-result": e.result, title },
      resultLabel(e.result),
    ),
    by && h("span", { class: "ml-result-rule", title }, rule),
  );
}

/// The query shown in a row, decoded from what the app sent so it reads well and a search on
/// the decoded text visibly matches. Left as sent when it does not decode.
function shownQuery(e: TrafficEntry): string {
  const sent = sentQuery(e);
  try { return decodeURIComponent(sent); } catch { return sent; }
}

/// The dimmed query after the path. A long one is cut at the end and shown whole in the
/// title.
const queryMark = (text: string) =>
  text ? h("span", { class: "ml-req-query", "data-query": true, title: text }, text) : undefined;

const queryKindsShown = 5;

/// An endpoint group gathers different queries without listing them: the query when they
/// all agree, otherwise a count with a few of them in the title. `kinds` comes from the
/// visible, filtered samples, so a search by query leaves only the queries it found.
function queryKinds(kinds: string[]) {
  if (kinds.length <= 1) return queryMark(kinds[0] ?? "");
  const names = kinds.map((k) => k || t("(no query)"));
  const rest = names.length - queryKindsShown;
  const title = [...names.slice(0, queryKindsShown), ...(rest > 0 ? [t("+{count} more", { count: rest })] : [])].join("\n");
  return h("span", { class: "ml-req-query", "data-query-kinds": true, title }, t("Queries: {count}", { count: kinds.length }));
}

/// The row's host, dimmed with a reason when it is not allowed, and omitted when not needed.
function hostMark(host: string, allowed: boolean, show: boolean) {
  if (!show) return undefined;
  return allowed
    ? h("span", { class: "ml-req-host" }, host)
    : h("span", { class: "ml-req-host ml-req-host-off", title: offHostTitle() }, host);
}

const td = (name: string, attrs: Attrs, ...children: Array<Node | string | false | undefined>) =>
  h("td", { "data-cell": name, ...attrs }, ...children);

const table = (view: Mode, cols: Array<[string, string, string?]>, body: HTMLElement[]) =>
  // The table lends only its look. The container and rows carry the list semantics
  // (listbox and option), and the header row is for the eye only.
  h(
    "table",
    { class: "necto-table ml-traffic-table", "data-view": view, role: "presentation" },
    h("colgroup", {}, ...cols.map(([c]) => h("col", { class: `ml-col-${c}` }))),
    h(
      "thead",
      { "aria-hidden": "true" },
      h(
        "tr",
        {},
        ...cols.map(([c, label, cls]) =>
          h("th", { class: [`ml-th-${c}`, cls].filter(Boolean).join(" ") }, label),
        ),
      ),
    ),
    h("tbody", {}, ...body),
  );

function pretty(text: string) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}


export class TrafficView {
  private current: Mode;
  private filters: Filters = emptyFilters();
  /// Whether the user has set the allowed-hosts-only filter themselves. If not, the first
  /// allowed host appearing does not switch the filter on.
  private hostFilterChosen = false;
  /// The request in the detail pane; in the endpoint view, the group's sample on display.
  private selected?: string;
  /// In the endpoint view, the group's newest sample when the samples were last looked at.
  /// A different newest sample means there is a new call.
  private seenNewest?: string;
  /// True while viewing the newest call, so a new call in the same group moves the detail
  /// to it. Stepping back to an older call clears it.
  private following = false;
  private groupOrder: string[] = [];
  /// The start of the newest request when a selection began, moved up only by selecting a
  /// newer request. Requests that started later sit above the selection, which stays in
  /// place, so the time view's strip counts them.
  private selectedAt?: number;
  private detailCache = new Map<string, NetworkDetail>();
  /// Details that failed to load. The failure may be transient, so nothing is cached and
  /// selecting again fetches again.
  private failed = new Set<string>();
  private inflight = new Set<string>();
  private openHeaders = new Set<string>();
  private renderedState?: string;
  /// Whether the detail pane drew the hidden-by-filter note. When a filter change flips it,
  /// the detail is redrawn.
  private renderedHidden = false;
  private chosenPath?: { key: string; path: string };
  /// The request whose capture is limited to its query. Selecting another request resets it.
  private queryOnly?: string;
  private warningTimer?: ReturnType<typeof setTimeout>;
  /// Bumped on every new launch, so details still loading from the previous launch are
  /// dropped.
  private epoch = 0;
  /// The list width as a fraction of the split, or the default when unset.
  private listRatio?: number;

  private readonly ruleName: RuleName = (id) => {
    const rule = this.deps.rules().find((r) => isRule(r) && r.id === id);
    return isRule(rule) ? ruleLabel(rule) : id;
  };

  constructor(private readonly root: HTMLElement, private readonly deps: TrafficDeps) {
    this.current = deps.prefs.get("traffic.mode") === "time" ? "time" : "endpoint";
    this.restoreFilters();
    this.listRatio = readSplit(deps.prefs, "split.traffic");
    document.addEventListener("keydown", (e) => this.globalKey(e));
    deps.store.onReset(() => this.forgetLaunch());
  }

  /// Opens with the remembered filters, dropping anything corrupt or unknown. The
  /// allowed-hosts-only filter is remembered only once the user has chosen it.
  private restoreFilters() {
    let saved: { search?: unknown; statuses?: unknown; results?: unknown; allowedOnly?: unknown };
    try { saved = JSON.parse(this.deps.prefs.get("traffic.filters") ?? "{}") ?? {}; } catch { return; }
    const pick = <K extends string>(value: unknown, known: K[]) =>
      new Set(Array.isArray(value) ? known.filter((k) => value.includes(k)) : []);
    if (typeof saved.search === "string") this.filters.search = saved.search;
    this.filters.statuses = pick(saved.statuses, statusChips().map(([k]) => k));
    this.filters.results = pick(saved.results, resultChips().map(([k]) => k));
    if (typeof saved.allowedOnly === "boolean") {
      this.filters.allowedOnly = saved.allowedOnly;
      this.hostFilterChosen = true;
    }
  }

  /// Remembers the filters per viewer on every change (principle 7).
  private saveFilters() {
    const filters = this.filters;
    this.deps.prefs.set(
      "traffic.filters",
      JSON.stringify({
        search: filters.search,
        statuses: [...filters.statuses],
        results: [...filters.results],
        ...(this.hostFilterChosen ? { allowedOnly: filters.allowedOnly } : {}),
      }),
    );
  }

  /// Called when the store is cleared for a new launch, before the store's onChange redraws.
  private forgetLaunch() {
    this.epoch += 1;
    this.selected = undefined;
    this.chosenPath = undefined;
    this.seenNewest = undefined;
    this.following = false;
    this.selectedAt = undefined;
    this.groupOrder = [];
    this.detailCache.clear(); this.failed.clear(); this.inflight.clear();
  }

  /// Anywhere in the view: ⌘↩ runs the primary action, / goes to the search field (from a
  /// select too, but not from a text field), and Escape steps back once: clear the search,
  /// then clear the selection and return to the list. Other combinations such as ⌘F belong
  /// to the host, and keys inside a dialog belong to the dialog.
  private globalKey(e: KeyboardEvent) {
    if (!this.shown() || e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target : null;
    if (document.querySelector('[role="dialog"]')) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === "Enter" && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (this.selected === undefined) return;
      // With focus on that button, Return would press it a second time; prevent the default
      // so it is pressed once.
      e.preventDefault();
      const action = this.primary();
      if (action && !action.disabled) action.click();
      return;
    }
    if (e.key === "/" && plain && !isTextEntry(target)) {
      const search = this.search();
      if (!search) return;
      e.preventDefault();
      search.focus();
      return;
    }
    if (e.key !== "Escape") return;
    const search = this.search();
    if (search && target === search) {
      e.preventDefault();
      if (search.value) {
        search.value = "";
        this.filters.search = "";
        this.saveFilters();
        this.refreshList();
      } else this.listbox()?.focus();
      return;
    }
    if (this.selected === undefined) return;
    const back =
      target !== null &&
      (target === this.listbox() ||
        !!this.root.querySelector(".ml-traffic-detail")?.contains(target));
    e.preventDefault();
    this.deselect();
    if (back) this.listbox()?.focus();
  }

  private search(): HTMLInputElement | null {
    return this.root.querySelector('[data-field="traffic-search"]');
  }

  private primary(): HTMLButtonElement | null {
    return this.root.querySelector(".ml-traffic-detail [data-primary]");
  }

  /// Return moves focus to the detail pane's primary action, or the capture area's first
  /// button when that cannot be pressed, or the pane itself while loading. Never to ×, so a
  /// second Return does not clear the selection. Once the detail arrives, `regainFocus`
  /// moves on to the primary action.
  private focusDetail() {
    const detail = this.root.querySelector<HTMLElement>(".ml-traffic-detail[data-key]");
    if (!detail) return;
    const action = this.primary();
    const to = (action && !action.disabled ? action : null)
      ?? detail.querySelector<HTMLElement>(".ml-capture button:not(:disabled)")
      ?? detail;
    to.focus();
  }

  /// Focus before a redraw: what to find again by `data-field`, and whether it was inside the
  /// detail pane, the pane itself included.
  private holdFocus(): HeldFocus {
    const detail = this.root.querySelector(".ml-traffic-detail");
    return { focus: captureFocus(this.root), inDetail: !!detail && detail.contains(document.activeElement) };
  }

  /// Returns focus to the same control; to the detail's primary action if that control is
  /// gone or disabled; to the list if the detail closed.
  private regainFocus(held: HeldFocus) {
    if (restoreFocus(this.root, held.focus)) {
      // Focus on the pane itself means Return was pressed while loading. Move on to the
      // primary action now that there is one.
      if (document.activeElement?.matches(".ml-traffic-detail")) this.focusDetail();
      return;
    }
    if (!held.inDetail) return;
    const active = document.activeElement;
    if (active && active !== document.body && this.root.querySelector(".ml-traffic-detail")?.contains(active)) return;
    if (this.root.querySelector(".ml-traffic-detail[data-key]")) this.focusDetail(); else this.listbox()?.focus();
  }

  /// A hidden tab takes the root out of the document, and a hidden view ignores keys.
  private shown() {
    return this.root.isConnected && !this.root.closest("[hidden]");
  }

  get mode(): Mode { return this.current; }

  render() {
    this.holdHostFilter();
    this.followRekey();
    this.followNewest();
    const held = this.holdFocus();
    const main = h(
      "div",
      { class: "ml-split ml-traffic-main" },
      h(
        "div",
        { class: "ml-traffic-listcol" },
        this.pauseStrip(),
        this.list(),
        h("div", { class: "necto-empty ml-traffic-empty", "data-empty": "traffic", hidden: true }),
      ),
      splitHandle({
        prefs: this.deps.prefs,
        key: "split.traffic",
        container: () => this.root.querySelector(".ml-traffic-main"),
        value: () => this.listRatio,
        width: (ratio) => {
          this.listRatio = ratio;
        },
      }),
      this.detailPane(),
    );
    applySplit(main, this.listRatio);
    this.root.replaceChildren(h("div", { class: "ml-traffic" }, this.warning(), this.toolbar(), main));
    this.syncEmpty();
    this.syncOpen();
    this.regainFocus(held);
    this.armWarningRecheck();
  }

  private listbox(): HTMLElement | null {
    return this.root.querySelector(".ml-traffic-list");
  }

  /// After rules or allowed hosts change: keeps the list's nodes and scroll, and redraws the
  /// toolbar, warning and detail from current values.
  update() {
    const list = this.listBody();
    const bar = this.root.querySelector(".ml-traffic-toolbar");
    if (!list || !bar) { this.render(); return; }
    this.holdHostFilter();
    this.followRekey();
    this.followNewest();
    const held = this.holdFocus();
    this.redrawWarning();
    const anchor = this.anchor();
    this.patchList(list);
    syncActive(this.listbox());
    bar.replaceWith(this.toolbar());
    this.redrawPauseStrip();
    this.swapDetail();
    this.regainFocus(held);
    this.keep(anchor); // after regaining focus, which resets the list's scrollTop
    this.armWarningRecheck();
  }

  /// Redraws the list. The detail is redrawn only when the selected request, its state or
  /// its hidden-by-filter status changes, keeping expanded headers and scroll otherwise.
  refreshList() {
    const list = this.listBody();
    const bar = this.root.querySelector(".ml-traffic-toolbar");
    if (!list || !bar) { this.render(); return; }
    this.holdHostFilter();
    this.followRekey();
    this.followNewest();
    const held = this.holdFocus();
    this.redrawWarning();
    const anchor = this.anchor();
    this.patchList(list);
    syncActive(this.listbox());
    bar.replaceWith(this.toolbar());
    this.redrawPauseStrip();
    // Swap the detail before regaining focus; swapping after would lose focus inside it.
    const entry = this.entry();
    const shown = (this.root.querySelector(".ml-traffic-detail") as HTMLElement | null)?.dataset.key;
    if (
      shown !== this.selected ||
      (entry && entry.state !== this.renderedState) ||
      this.hiddenByFilters() !== this.renderedHidden
    )
      this.swapDetail();
    else this.root.querySelector(".ml-sample-nav")?.replaceWith(this.sampleNav());
    this.regainFocus(held);
    this.keep(anchor); // after regaining focus, which resets the list's scrollTop
    this.armWarningRecheck();
  }

  private setMode(mode: Mode) {
    this.current = mode;
    this.deps.prefs.set("traffic.mode", mode);
    // The newest seen stays the one at selection, so a call that came while the time view
    // was showing counts as new in the endpoint view instead of moving the detail.
    this.following = this.selected !== undefined && this.selected === this.samples()[0]?.key;
    this.render();
  }

  /// Clicking a row selects it, and clicking the selected row again clears the selection.
  private select(key: string) {
    if (this.selected === key) { this.deselect(); return; }
    this.choose(key);
  }

  /// Selects a request from outside the list, such as the rule editor's latest request.
  reveal(key: string) {
    // A request that came while the list was paused is not in it; show the list as it is now.
    const store = this.deps.store;
    if (!store.entries().some((e) => e.key === key)) store.resume();
    this.choose(key);
  }

  /// Selects only; moving by keyboard onto the selected row does not clear it.
  private choose(key: string) {
    this.show(key);
    this.seenNewest = this.samples()[0]?.key;
    this.following = key === this.seenNewest;
    this.markSelected();
    this.render();
  }

  /// Changes the sample on display within the group, pinning it so the store's capacity
  /// limit cannot evict it.
  private show(key: string) {
    this.selected = key;
    this.failed.clear();
    this.deps.store.pin(key);
  }

  private deselect() {
    this.selected = undefined;
    this.following = false;
    this.deps.store.pin(undefined);
    this.selectedAt = undefined;
    this.render();
  }

  /// Follows the selected request to its new key once it pairs with a Necto record, so the
  /// row stays selected and the detail keeps showing it.
  private followRekey() {
    const store = this.deps.store;
    if (this.selected !== undefined) this.selected = store.resolve(this.selected);
    if (this.seenNewest !== undefined) this.seenNewest = store.resolve(this.seenNewest);
    if (this.chosenPath) this.chosenPath = { ...this.chosenPath, key: store.resolve(this.chosenPath.key) };
  }

  /// In the endpoint view, while the newest call is on display, a new call in the same group
  /// moves the detail to it. The time view keeps showing the selected request; the strip
  /// counts what came after it.
  private followNewest() {
    if (this.current !== "endpoint" || !this.following || this.selected === undefined) return;
    const newest = this.samples()[0];
    if (!newest || newest.key === this.selected) return;
    this.show(newest.key);
    this.seenNewest = newest.key;
  }

  /// With no allowed hosts the host filter has no effect and shows as off. If a capture then
  /// adds the first host, the filter would turn itself on and rows for other hosts would
  /// vanish, shaking the list. Unless the user chose it, the filter stays off as shown.
  private holdHostFilter() {
    if (!this.hostFilterChosen && this.deps.allowedHosts().length === 0) this.filters.allowedOnly = false;
  }

  /// Requests that came during a pause count as seen once something is selected, since the
  /// list shows them on resume.
  private markSelected() {
    if (this.selected === undefined) { this.selectedAt = undefined; return; }
    const at = this.selectedAt ?? Math.max(-Infinity, ...this.deps.store.allEntries().map((e) => e.startedAt));
    this.selectedAt = Math.max(at, this.entry()?.startedAt ?? -Infinity);
  }

  /// Requests the current filters show that started after the selection was made, above it.
  private newerThanSelection(): TrafficEntry[] {
    const since = this.selectedAt;
    if (this.current !== "time" || since === undefined || this.selected === undefined) return [];
    return visible(this.deps.store.entries(), this.filters, this.deps.allowedHosts()).shown.filter((e) => e.startedAt > since);
  }

  private resume() {
    this.deps.store.resume();
  }

  /// Requests that arrived while paused and would show under the current filters on resume.
  /// The selected request is already in the detail and is not counted.
  private newWhilePaused() {
    const { shown } = visible(this.deps.store.arrivedSincePause(), this.filters, this.deps.allowedHosts());
    return shown.filter((e) => e.key !== this.selected).length;
  }

  /// The strip keeps the same place and height at all times. Appearing on pause would push
  /// the list and move the row under the pointer, so while live it quietly says so.
  private pauseStrip() {
    const newer = this.deps.store.paused ? [] : this.newerThanSelection();
    if (newer.length > 0)
      return h("div", { class: "ml-pause-strip", "data-newer": true, role: "status" },
        h("span", {}, t("New since you selected: {count}", { count: newer.length })),
        h("button", { class: "necto-button", "data-action": "show-newest", "data-field": "show-newest", onclick: () => this.showNewest() }, t("Show newest")));
    if (!this.deps.store.paused)
      return h(
        "div",
        { class: "ml-pause-strip", "data-live": true },
        h("span", { class: "necto-caption" }, t("Live · new requests show up at once")),
      );
    const count = this.newWhilePaused();
    return h("div", { class: "ml-pause-strip", "data-pause-strip": true, role: "status" },
      h("span", {}, count === 0 ? t("Paused · no new requests") : t("Paused · new requests: {count}", { count })),
      h("button", { class: "necto-button", "data-action": "resume", "data-field": "strip-resume", onclick: () => { this.resume(); this.listbox()?.focus(); } }, t("Resume")));
  }

  /// The newest when clicked, which may have come after the strip was drawn.
  private showNewest() {
    const newest = this.newerThanSelection()[0];
    if (!newest) return;
    this.choose(newest.key);
    const list = this.listbox();
    if (!list) return;
    list.scrollTop = 0;
    list.focus();
  }

  private redrawPauseStrip() {
    this.root.querySelector(".ml-pause-strip")?.replaceWith(this.pauseStrip());
  }

  /// The detail reads current values, not the paused snapshot, so a selected pending
  /// request updates in place when it finishes.
  private entry(): TrafficEntry | undefined {
    if (this.selected === undefined) return undefined;
    return this.deps.store.liveEntry(this.selected) ?? this.deps.store.entries().find((e) => e.key === this.selected);
  }

  /// Every sample in the selected request's group, unfiltered, newest first.
  private samples(): TrafficEntry[] {
    const entry = this.entry();
    if (!entry) return [];
    const key = groupKey(entry);
    return this.deps.store.entries().filter((sample) => groupKey(sample) === key);
  }

  private warning() {
    return h(
      "div",
      { class: "ml-order-warning" },
      this.deps.order.warning() &&
        h(
          "div",
          { class: "necto-notice necto-notice-danger", "data-warning": "order" },
          orderWarningText(),
        ),
    );
  }

  private redrawWarning() {
    this.root.querySelector(".ml-order-warning")?.replaceWith(this.warning());
  }

  /// Evidence may not have settled when drawing, including any gathered while the tab was
  /// hidden, so check again even if no new request arrives.
  private armWarningRecheck() {
    clearTimeout(this.warningTimer);
    this.warningTimer = setTimeout(() => {
      this.warningTimer = undefined;
      if (this.shown()) this.redrawWarning();
    }, warningRecheckMs);
  }

  // -- toolbar ----------------------------------------------------------------

  /// Rebuilt on every update, with a `data-field` on each control to get focus back. Pause and
  /// resume share one slot.
  private toolbar() {
    const store = this.deps.store;
    const hosts = this.deps.allowedHosts();
    const { hiddenByHost } = visible(store.entries(), this.filters, hosts);
    const byHost = this.filters.allowedOnly && hosts.length > 0;
    const segment = (mode: Mode, label: string) =>
      h(
        "button",
        {
          type: "button",
          "data-mode": mode,
          "data-field": `mode-${mode}`,
          "aria-pressed": String(this.current === mode),
          onclick: () => this.setMode(mode),
        },
        label,
      );
    const chip = <K>(set: Set<K>, key: K, attr: string, label: string) =>
      h(
        "button",
        {
          class: "necto-button-quiet ml-chip",
          "data-chip": attr,
          "data-field": `chip-${attr}`,
          "aria-pressed": String(set.has(key)),
          onclick: () => {
            if (set.has(key)) set.delete(key);
            else set.add(key);
            this.saveFilters();
            this.refreshList();
          },
        },
        label,
      );
    return h(
      "div",
      { class: "ml-traffic-toolbar" },
      h(
        "div",
        { class: "necto-segmented", role: "group", "aria-label": t("View") },
        segment("endpoint", t("Endpoints")),
        segment("time", t("By time")),
      ),
      h("input", {
        class: "necto-field",
        type: "search",
        "data-field": "traffic-search",
        placeholder: t("Find by path or query"),
        value: this.filters.search,
        oninput: (e) => {
          this.filters.search = (e.target as HTMLInputElement).value;
          this.saveFilters();
          this.refreshList();
        },
      }),
      h(
        "label",
        {},
        h("input", {
          type: "checkbox",
          "data-field": "allowed-only",
          checked: byHost,
          disabled: hosts.length === 0,
          onchange: (e) => {
            this.filters.allowedOnly = (e.target as HTMLInputElement).checked;
            this.hostFilterChosen = true;
            this.saveFilters();
            this.refreshList();
          },
        }),
        " ",
        t("Allowed hosts only"),
      ),
      hosts.length === 0 &&
        h("span", { class: "necto-caption" }, t("No allowed hosts, so showing everything")),
      byHost &&
        h(
          "button",
          {
            class: "necto-button-quiet",
            "data-hidden-count": hiddenByHost,
            "data-field": "other-hosts",
            title: t("Click to show every host"),
            onclick: () => {
              this.filters.allowedOnly = false;
              this.hostFilterChosen = true;
              this.saveFilters();
              this.refreshList();
            },
          },
          t("Other hosts: {count}", { count: hiddenByHost }),
        ),
      // Wrap by group, so a single chip never drops to the next line alone. Pause rides with
      // the result chips so it is never left on a line by itself.
      h(
        "div",
        { class: "ml-toolbar-group", "data-group": "status", role: "group", "aria-label": t("Status") },
        ...statusChips().map(([k, label]) => chip(this.filters.statuses, k, k, label)),
      ),
      h(
        "div",
        { class: "ml-toolbar-group", "data-group": "result-pause" },
        h(
          "div",
          {
            class: "ml-toolbar-group",
            "data-group": "result",
            role: "group",
            "aria-label": t("Result"),
          },
          ...resultChips().map(([k, label]) => chip(this.filters.results, k, k, label)),
        ),
        store.paused
          ? h(
              "button",
              {
                class: "necto-button",
                "data-action": "resume",
                "data-field": "pause-toggle",
                title: t("Resume"),
                "aria-label": t("Resume"),
                onclick: () => this.resume(),
              },
              "▶",
            )
          : h(
              "button",
              {
                class: "necto-button",
                "data-action": "pause",
                "data-field": "pause-toggle",
                title: t("Pause"),
                "aria-label": t("Pause"),
                onclick: () => store.pause(),
              },
              "⏸",
            ),
      ),
    );
  }

  // -- list -------------------------------------------------------------------

  private list() {
    const rows = this.rows().map((r) => r.build());
    const list = h(
      "div",
      {
        class: "ml-traffic-list",
        role: "listbox",
        tabindex: 0,
        "data-field": "traffic-list",
        "aria-label": t("Request list"),
        onkeydown: (e) => this.listKey(e as KeyboardEvent),
      },
      this.current === "endpoint"
        ? table(
            "endpoint",
            [
              ["method", t("Method")],
              ["path", t("Path")],
              ["count", t("Count"), "necto-numeric"],
              ["status", t("Status")],
              ["result", t("Result")],
              ["ago", t("Latest")],
            ],
            rows,
          )
        : table(
            "time",
            [
              ["time", t("Started")],
              ["method", t("Method")],
              ["path", t("Path")],
              ["status", t("Status")],
              ["result", t("Result")],
              ["duration", t("Duration"), "necto-numeric"],
            ],
            rows,
          ),
    );
    syncActive(list);
    return list;
  }

  /// ↑↓, ⇞⇟, Home and End move the selection with focus and update the detail, as in Necto's
  /// Network panel.
  private listKey(e: KeyboardEvent) {
    if (document.querySelector('[role="dialog"]')) return; // the list behind an open dialog takes no keys
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); this.focusDetail(); return; }
    if (
      (e.key === "ArrowDown" || e.key === "ArrowUp") &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      this.hiddenByFilters()
    ) {
      e.preventDefault();
      const to = this.nearestShown(e.key === "ArrowDown" ? 1 : -1);
      if (to !== undefined) {
        this.choose(to);
        revealSelected(this.listbox());
      }
      return;
    }
    const to = navigate(e.currentTarget as HTMLElement, e);
    if (!to) return;
    if (to.getAttribute("aria-selected") !== "true") this.choose(to.dataset.target!);
    revealSelected(this.listbox());
  }

  /// Whether the current filters keep the selected request out of the list. Judged by what
  /// the list draws, the snapshot when paused: the detail reads current values, but a request
  /// that finished while paused and now passes the filters is still absent from the list. In
  /// the endpoint view the row is there if any call in its group passes.
  private hiddenByFilters(): boolean {
    const entry = this.entry();
    if (!entry) return false;
    const hosts = this.deps.allowedHosts();
    if (this.current === "time") {
      const drawn = this.deps.store.entries().find((shown) => shown.key === entry.key) ?? entry;
      return visible([drawn], this.filters, hosts).shown.length === 0;
    }
    const group = groupKey(entry);
    return !visible(this.deps.store.entries(), this.filters, hosts).shown.some((shown) => groupKey(shown) === group);
  }

  /// ↓ (dir 1) or ↑ (-1) from a hidden selected request: the closest visible row in that
  /// direction from where it would sit in the list, or else the closest in the other
  /// direction. Returns that row's request key.
  private nearestShown(dir: 1 | -1): string | undefined {
    const entry = this.entry();
    if (!entry) return undefined;
    const all = this.deps.store.entries();
    const { shown } = visible(all, this.filters, this.deps.allowedHosts());
    // Position in list order: store order in the time view, first-seen group order in the
    // endpoint view.
    const index = new Map(all.map((x, i) => [x.key, i]));
    const targets: Array<{ at: number; key: string }> =
      this.current === "time"
        ? shown.map((x) => ({ at: index.get(x.key)!, key: x.key }))
        : groups(shown, this.groupOrder).groups.map((g) => ({
            at: this.groupOrder.indexOf(g.key),
            key: g.samples[0].key,
          }));
    const here = this.current === "time" ? index.get(entry.key) ?? -1 : this.groupOrder.indexOf(groupKey(entry));
    if (here < 0 || targets.length === 0) return undefined;
    const after = targets.filter((t) => t.at > here);
    const before = targets.filter((t) => t.at < here);
    const pick = dir > 0 ? after[0] ?? before.at(-1) : before.at(-1) ?? after[0];
    return pick?.key;
  }

  /// Clears the search and chips, and the allowed-hosts-only filter too if the request is
  /// still hidden by its host (or, with `hosts`, if every request still is). Then reveals
  /// the selected row and focuses the list.
  private clearFilters(hosts = false) {
    this.filters.search = "";
    this.filters.statuses.clear();
    this.filters.results.clear();
    const allHidden = () =>
      visible(this.deps.store.entries(), this.filters, this.deps.allowedHosts()).shown.length === 0;
    if (this.hiddenByFilters() || (hosts && allHidden())) {
      this.filters.allowedOnly = false;
      this.hostFilterChosen = true;
    }
    this.saveFilters();
    this.refreshList();
    this.listbox()?.focus();
    revealSelected(this.listbox());
  }

  /// The tbody patched by incremental updates. Switching views rebuilds the whole table.
  private listBody() {
    return this.root.querySelector(".ml-traffic-list tbody");
  }

  /// The rows to hold in place across a redraw, with their screen positions. WKWebView has no
  /// scroll anchoring (overflow-anchor), so it is done by hand (principle 5). The selected
  /// row if visible, otherwise the top visible row while scrolled or while something is
  /// selected. At the top with nothing selected the list is being watched live, so nothing is
  /// held and new requests stack up in view.
  private anchor(): Array<{ id: string; top: number }> | undefined {
    const list = this.listbox();
    if (!list) return undefined;
    const box = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll<HTMLElement>("tbody > tr")];
    const shown = (r: HTMLElement) => {
      const t = r.getBoundingClientRect();
      return t.bottom > box.top && t.top < box.bottom;
    };
    const selected = rows.find((r) => r.getAttribute("aria-selected") === "true");
    let at: number;
    if (selected && shown(selected)) at = rows.indexOf(selected);
    else if (list.scrollTop <= 0 && this.selected === undefined) return undefined;
    else at = rows.findIndex(shown);
    if (at < 0) return undefined;
    // The held row can vanish when the selected request is filtered out, so the nearest
    // visible rows stand in, below first. Visible rows are contiguous, so stop at the first
    // off-screen row each way and measure only what is visible however long the list.
    const pick = (i: number) => {
      const r = rows[i];
      return r && shown(r) ? { id: r.dataset.row!, top: r.getBoundingClientRect().top } : undefined;
    };
    const order = [pick(at)!];
    let below = at + 1, above = at - 1, more = true;
    while (more) {
      more = false;
      const b = below < rows.length ? pick(below) : undefined;
      if (b) { order.push(b); below += 1; more = true; } else below = rows.length;
      const a = above >= 0 ? pick(above) : undefined;
      if (a) { order.push(a); above -= 1; more = true; } else above = -1;
    }
    return order;
  }

  /// Scrolls so the held row, or the nearest stand-in, returns to its screen position.
  private keep(anchor: Array<{ id: string; top: number }> | undefined) {
    const list = this.listbox();
    if (!anchor || !list) return;
    const rows = new Map([...list.querySelectorAll<HTMLElement>("tbody > tr")].map((r) => [r.dataset.row!, r]));
    const hit = anchor.find((a) => rows.has(a.id));
    if (!hit) return;
    const delta = rows.get(hit.id)!.getBoundingClientRect().top - hit.top;
    if (delta !== 0) list.scrollTop += delta;
  }

  /// Keeps the nodes of rows with an unchanged signature or holding focus, and builds,
  /// inserts or moves only the rest.
  private patchList(list: Element) {
    const old = new Map<string, HTMLElement>();
    for (const el of [...list.children] as HTMLElement[]) old.set(el.dataset.row!, el);
    const active = document.activeElement;
    let cursor: ChildNode | null = list.firstChild;
    for (const r of this.rows()) {
      const prev = old.get(r.id);
      old.delete(r.id);
      const keep = prev !== undefined && (prev.dataset.sig === r.sig || (active !== null && prev.contains(active)));
      if (prev && !keep) { if (cursor === prev) cursor = prev.nextSibling; prev.remove(); }
      const node = keep ? prev : r.build();
      if (node === cursor) cursor = cursor.nextSibling; else list.insertBefore(node, cursor);
    }
    for (const el of old.values()) el.remove();
    this.syncEmpty();
  }

  /// With no rows, Necto's empty state below the header: "no requests yet", or, when the
  /// filters hide them all, that and a way to clear them. Not a stale "no requests yet"
  /// over requests the filters hide. Redrawn only when what it says changes, so a focused
  /// button inside it stays.
  private syncEmpty() {
    const node = this.root.querySelector<HTMLElement>('[data-empty="traffic"]');
    if (!node) return;
    const rows = this.listBody()?.children.length ?? 0;
    const kind = rows > 0 ? "none" : this.deps.store.entries().length > 0 ? "filtered" : "fresh";
    if (node.dataset.kind === kind) return;
    node.dataset.kind = kind;
    node.hidden = kind === "none";
    if (kind === "none") node.replaceChildren();
    else if (kind === "fresh")
      node.replaceChildren(
        h("div", { class: "necto-empty-title" }, t("No requests yet")),
        h("div", { class: "necto-caption" }, t("Requests the app sends appear here")),
      );
    else
      node.replaceChildren(
        h("div", { class: "necto-empty-title" }, t("No requests match the filters")),
        h(
          "button",
          {
            class: "necto-button",
            "data-action": "clear-filters",
            "data-field": "empty-clear-filters",
            onclick: () => this.clearFilters(true),
          },
          t("Clear filters"),
        ),
      );
  }

  private rows(): Row[] {
    const hosts = this.deps.allowedHosts();
    const all = this.deps.store.entries();
    const { shown } = visible(all, this.filters, hosts);
    const current = this.entry();
    // The list follows the filters strictly. A selected request that fails them has no
    // row, and the detail says so.
    // With one host on screen the host says nothing; the path gets the width.
    const oneHost = new Set(shown.map((e) => e.host)).size <= 1;
    return this.current === "endpoint"
      ? this.endpointGroups(shown).map((g) => this.groupRow(g, hosts, current, oneHost))
      : shown.map((e) => this.timeRow(e, hosts, oneHost));
  }

  /// Fixed in first-seen order. A new call changes its row's count and age without moving it.
  private endpointGroups(shown: TrafficEntry[]): Group[] {
    const { groups: gs, order } = groups(shown, this.groupOrder);
    this.groupOrder = order;
    return gs;
  }

  /// `selected` is the selected request, as in the detail, looked up once per list rather
  /// than once per group.
  private groupRow(g: Group, hosts: string[], selected: TrafficEntry | undefined, oneHost: boolean): Row {
    const last = g.samples[0];
    const isSelected = selected !== undefined && groupKey(selected) === g.key;
    const allowed = hosts.includes(g.host);
    const showHost = !allowed || (hosts.length !== 1 && !oneHost);
    const kinds = [...new Set(g.samples.map(shownQuery))];
    const sig = [
      isSelected,
      showHost,
      allowed,
      g.samples.length,
      last.key,
      last.state,
      statusText(last),
      resultText(last, this.ruleName),
      ago(last.startedAt, Date.now()),
      ...kinds,
    ].join("\u0001");
    return row(`g:${g.key}`, sig, () =>
      h(
        "tr",
        {
          class: "ml-traffic-group",
          "data-group": g.key,
          "data-target": last.key,
          "aria-selected": String(isSelected),
          onclick: () => (isSelected ? this.deselect() : this.select(last.key)),
        },
        td("method", {}, g.method),
        td(
          "path",
          { title: `${g.host}${g.template}` },
          h(
            "div",
            { class: "ml-where" },
            hostMark(g.host, allowed, showHost),
            h("span", { class: "ml-path" }, g.template),
            queryKinds(kinds),
          ),
        ),
        td("count", { class: "necto-numeric" }, `×${g.samples.length}`),
        td("status", {}, statusMark(last)),
        td("result", {}, resultPill(last, this.ruleName)),
        td("ago", { class: "necto-caption" }, ago(last.startedAt, Date.now())),
      ),
    );
  }

  private timeRow(e: TrafficEntry, hosts: string[], oneHost: boolean): Row {
    const isSelected = e.key === this.selected;
    const allowed = hosts.includes(e.host);
    const showHost = !allowed || (hosts.length !== 1 && !oneHost);
    const slow = e.durationMs !== undefined && e.durationMs >= slowMs;
    const sig = [
      isSelected,
      allowed,
      showHost,
      e.host,
      e.path,
      e.state,
      statusText(e),
      resultText(e, this.ruleName),
      e.durationMs,
      fullURL(e),
    ].join("\u0001");
    return row(`k:${e.key}`, sig, () =>
      h(
        "tr",
        {
          class: "ml-traffic-row",
          "data-key": e.key,
          "data-target": e.key,
          "aria-selected": String(isSelected),
          onclick: () => this.select(e.key),
        },
        td("time", {}, clock(e.startedAt)),
        td("method", {}, e.method),
        td(
          "path",
          {},
          h(
            "div",
            { class: "ml-where" },
            hostMark(e.host, allowed, showHost),
            h("span", { class: "ml-tail", title: fullURL(e) }, `\u200e${e.path}\u200e`),
            queryMark(shownQuery(e)),
          ),
        ),
        td("status", {}, statusMark(e)),
        td("result", {}, resultPill(e, this.ruleName)),
        td(
          "duration",
          {
            class: slow ? "necto-numeric ml-slow" : "necto-numeric",
            title: e.durationMs === undefined ? "" : `${e.durationMs}ms`,
          },
          e.durationMs === undefined ? "" : formatDuration(e.durationMs),
        ),
      ),
    );
  }

  // -- detail -----------------------------------------------------------------

  /// Redraws only the detail, returning focus inside it to the same control or else the
  /// primary action.
  private renderDetail() {
    const held = this.holdFocus();
    this.swapDetail();
    this.regainFocus(held);
  }

  /// The caller restores focus (`holdFocus`, `regainFocus`).
  private swapDetail() {
    const pane = this.root.querySelector(".ml-traffic-detail");
    if (!pane) { this.render(); return; }
    const next = this.detailPane();
    pane.replaceWith(next);
    next.scrollTop = pane.scrollTop;
    this.syncOpen();
  }

  /// As in Necto's Network panel: with nothing selected the detail and handle hide and the
  /// list takes the full width; a selection opens the detail with its ×. Open is read from
  /// what the detail drew, so paths that redraw only the list (a new request, an app
  /// relaunch) keep up.
  private syncOpen() {
    const main = this.root.querySelector<HTMLElement>(".ml-traffic-main");
    if (!main) return;
    const open = !!main.querySelector(".ml-traffic-detail[data-key]");
    main.dataset.detail = open ? "open" : "closed";
    const handle = main.querySelector<HTMLElement>(":scope > .ml-split-handle");
    if (handle) handle.hidden = !open;
  }

  /// 1 is the newest. ‹ goes newer and › older, with words beside them to say which.
  private sampleNav() {
    if (this.current !== "endpoint") return h("span", { class: "ml-sample-nav", hidden: true });
    const samples = this.samples();
    const i = samples.findIndex((e) => e.key === this.selected);
    const go = (to: number) => {
      this.show(samples[to].key);
      this.following = to === 0;
      if (to === 0) this.seenNewest = samples[0].key;
      this.renderDetail();
      const list = this.listBody();
      if (list) this.patchList(list);
      syncActive(this.listbox());
    };
    const newer = samples[0] !== undefined && samples[0].key !== this.seenNewest && samples[0].key !== this.selected;
    return h(
      "span",
      { class: "ml-sample-nav" },
      h("span", {}, t("Newest")),
      " ",
      h(
        "button",
        {
          class: "necto-button-quiet",
          "data-action": "newer",
          "data-field": "detail-newer",
          title: t("Newer call"),
          "aria-label": t("Newer call"),
          disabled: i <= 0,
          onclick: () => go(i - 1),
        },
        "‹",
      ),
      ` ${i + 1}/${samples.length} `,
      h(
        "button",
        {
          class: "necto-button-quiet",
          "data-action": "older",
          "data-field": "detail-older",
          title: t("Older call"),
          "aria-label": t("Older call"),
          disabled: i >= samples.length - 1,
          onclick: () => go(i + 1),
        },
        "›",
      ),
      " ",
      h("span", {}, t("Older")),
      newer &&
        h(
          "span",
          { "data-new-sample": true },
          " · ",
          t("New call available"),
          " ",
          h(
            "button",
            {
              class: "necto-button-quiet",
              "data-action": "latest",
              "data-field": "detail-latest",
              onclick: () => go(0),
            },
            t("Show newest"),
          ),
        ),
    );
  }

  private detailPane() {
    const entry = this.entry();
    this.renderedState = entry?.state;
    this.renderedHidden = this.hiddenByFilters();
    if (!entry) return h("div", { class: "ml-traffic-detail", hidden: true });
    const detail = this.loadDetail(entry);
    // Status as a coloured dot, like the title of Necto's detail; the rest as text.
    const facts = [
      entry.durationMs !== undefined && formatDuration(entry.durationMs),
      entry.bytes !== undefined && size(entry.bytes),
      resultText(entry, this.ruleName),
    ]
      .filter(Boolean)
      .join(" · ");
    // The pane itself takes focus (-1), as the place Return lands while loading
    // (`focusDetail`).
    return h(
      "div",
      {
        class: "ml-traffic-detail",
        "data-key": entry.key,
        "data-field": "traffic-detail",
        tabindex: -1,
      },
      h(
        "div",
        { class: "necto-toolbar" },
        h("span", { class: "ml-path", title: fullURL(entry) }, `${entry.method} ${fullURL(entry)}`),
        h(
          "button",
          {
            class: "necto-button-quiet",
            "data-action": "deselect",
            "data-field": "detail-deselect",
            title: t("Clear selection"),
            "aria-label": t("Clear selection"),
            onclick: () => this.deselect(),
          },
          "×",
        ),
      ),
      // Keep what is being read: the detail stays open, with one line on why the row is
      // missing and how to bring it back.
      this.renderedHidden &&
        h(
          "div",
          { class: "necto-caption ml-hidden-note", "data-hidden-note": true },
          t("Hidden from the list because it doesn't match the current filters"),
          " ",
          h(
            "button",
            {
              class: "necto-button",
              "data-action": "clear-filters",
              "data-field": "detail-clear-filters",
              onclick: () => this.clearFilters(),
            },
            t("Clear filters"),
          ),
        ),
      h(
        "div",
        { class: "necto-caption ml-detail-facts" },
        statusMark(entry),
        " ",
        facts,
        " ",
        this.sampleNav(),
      ),
      // The primary action sits right below the summary, visible without scrolling past a
      // long body.
      this.captureArea(entry, detail),
      this.detailBody(entry, detail),
    );
  }

  private captureArea(entry: TrafficEntry, detail: NetworkDetail | "error" | undefined) {
    const path = this.chosenPath?.key === entry.key ? this.chosenPath.path : entry.path;
    const redraw = () => {
      const held = this.holdFocus();
      this.root.querySelector(".ml-capture")?.replaceWith(this.captureArea(entry, detail));
      this.regainFocus(held);
    };
    return captureArea({ entry: entry, detail: detail, deps: this.deps, path, choosePath: (next) => {
      this.chosenPath = { key: entry.key, path: next };
      redraw();
    }, queryOnly: this.queryOnly === entry.key, chooseQueryOnly: (on) => {
      this.queryOnly = on ? entry.key : undefined;
      redraw();
    } });
  }

  private detailBody(e: TrafficEntry, d: NetworkDetail | "error" | undefined) {
    if (!this.deps.networkAvailable()) {
      const reason = this.deps.networkUnavailableReason?.();
      return h("div", { class: "necto-notice" }, pluginMissing(), reason && h("div", { class: "necto-caption" }, reason));
    }
    if (!e.networkID) return h("div", { class: "necto-caption" }, notInNecto());
    if (d === "error") return h("div", { class: "necto-notice" }, recordGone());
    if (!d) return h("div", { class: "necto-caption" }, e.state === "pending" ? t("Waiting for the response…") : t("Loading…"));
    const headers = (name: string, label: string, map: Record<string, string>) =>
      h("details", { open: this.openHeaders.has(name), ontoggle: (ev) => {
        if ((ev.target as HTMLDetailsElement).open) this.openHeaders.add(name); else this.openHeaders.delete(name);
      } },
        h("summary", { "data-field": `detail-headers-${name}` }, label),
        h("pre", { class: "ml-headers" }, Object.entries(map).map(([k, v]) => `${k}: ${v}`).join("\n")));
    const body = d.responseBody;
    return h(
      "div",
      {},
      headers("request", t("Request headers"), d.requestHeaders),
      headers("response", t("Response headers"), d.responseHeaders),
      body?.isTruncated && h("div", { class: "necto-caption" }, t("Truncated")),
      body?.text !== undefined
        ? h("pre", { class: "ml-body" }, pretty(body.text))
        : h("div", { class: "necto-caption" }, t("No response body.")),
    );
  }

  /// Fetched only on selection. An unfinished request is not fetched; `refreshList` redraws
  /// when it finishes.
  private loadDetail(e: TrafficEntry): NetworkDetail | "error" | undefined {
    const id = e.networkID;
    if (!id || !this.deps.networkAvailable()) return undefined;
    const hit = this.detailCache.get(id);
    if (hit) { this.detailCache.delete(id); this.detailCache.set(id, hit); return hit; }
    if (this.failed.has(id)) return "error";
    if (e.state === "pending" || this.inflight.has(id)) return undefined;
    this.inflight.add(id);
    const epoch = this.epoch;
    this.deps.detail(id).then(
      (d) => { if (epoch === this.epoch) { this.remember(id, d); this.deps.store.applyDetail(d); } },
      () => { if (epoch === this.epoch) this.failed.add(id); },
    ).finally(() => {
      if (epoch !== this.epoch) return;
      this.inflight.delete(id);
      if (this.entry()?.networkID === id) this.renderDetail();
    });
    return undefined;
  }

  private remember(id: string, d: NetworkDetail) {
    this.detailCache.set(id, d);
    while (this.detailCache.size > detailCacheSize) this.detailCache.delete(this.detailCache.keys().next().value!);
  }
}
