//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "./localization";
import { translate } from "./messages";
import type { MapLocalAPI } from "./api";
import { captureFocus, fill, fixInvertedTaps, h, isTextEntry, keepFocusedSelect, PressHold, restoreFocus } from "./dom";
import type { Draft, DraftStore } from "./drafts";
import type { PanelModel } from "./model";
import { navigate, nextTab, optionId, revealSelected, selectedOption, syncActive } from "./listbox";
import {
  emptyJSONResponse,
  isRule,
  newRule,
  queryLabel,
  queryValueHint,
  readQuery,
  ruleFromRequest,
  ruleLabel,
  type QueryRow,
} from "./rules";
import { applySplit, readSplit, splitHandle } from "./split";
import { isJSONDocument, readJSON } from "./json";
import { normalizeHost, readHostInput } from "./hosts";
import { Lifetime } from "./lifetime";
import { addCapturedResponse, captureResponse, newRuleFromCapture, planCapture, requestURL } from "./traffic/capture";
import { OrderDetector } from "./traffic/order";
import { TrafficStore } from "./traffic/store";
import { TrafficView, type CaptureDone, type Unkept } from "./traffic/view";
import { formatClock, formatDuration } from "./traffic/format";
import { overlaps, pickRule, queryMisses, type QueryMiss } from "./traffic/match";
import { blockedHostNote } from "./traffic/capture-area";
import { exportText, parseImport, secretWarning } from "./transfer";
import type {
  Configuration,
  JSONValue,
  MockError,
  NetworkDetail,
  RequestEvent,
  ResponseSpec,
  Rule,
  TrafficEntry,
  Unmatched,
  WriteResult,
} from "./types";
import { debounce } from "./writer";

/// What turning on the auth rule checkbox does.
const authHint = () =>
  t(
    "When on, the app shows a mocked session (🔑) while this rule responds, and you are reminded to log out in the app before you turn the rule off or delete it",
  );

export interface Prefs {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface ViewDeps {
  api: MapLocalAPI;
  drafts: DraftStore;
  /// Copies to the clipboard. False when blocked, and the text is then shown in a box.
  copy(text: string): Promise<boolean>;
  /// Selects the box's text and copies it. The WebView allows this only during the button
  /// press itself. False when blocked.
  copyField(field: HTMLTextAreaElement): boolean;
  /// Per-viewer view choices, such as the tab and the list mode.
  prefs: Prefs;
  /// When absent the view makes its own store, for tests that render without connecting.
  traffic?: { store: TrafficStore; order: OrderDetector };
}

type Tab = "rules" | "traffic";
type PendingWrite = { rule: Rule; launch: string; revision?: number };

/// The outcome of a capture from traffic. The tab does not switch, so captures can follow
/// one another; the notice offers the way onward instead.
interface CaptureNotice {
  text: string;
  id: string;
  /// The response the capture added, which opening the rule shows.
  response?: string;
  /// The response name added to an existing rule, for the action that makes it active.
  name?: string;
  /// Opening the rule before its echo arrives still finds something to edit.
  seed?: Rule;
}

/// How long a capture notice stays. Hovering or focusing it holds it, as with any notice.
const captureMs = 6_000;

/// The last deletion and how to bring it back. There is one slot: a new deletion makes the
/// previous one final.
interface Undo { text: string; restore(): void }

/// macOS turns " into “ ” while typing, which breaks JSON. Turn off what can be turned off;
/// whatever slips through is straightened on save (json.ts).
const PLAIN_TEXT = { spellcheck: "false", autocorrect: "off", autocapitalize: "off" } as const;
/// Suggested in the Status field, with their standard reason phrases.
const statusCodes: Array<[number, string]> = [
  [200, "OK"], [201, "Created"], [204, "No Content"], [301, "Moved Permanently"], [304, "Not Modified"],
  [400, "Bad Request"], [401, "Unauthorized"], [403, "Forbidden"], [404, "Not Found"], [409, "Conflict"],
  [422, "Unprocessable Content"], [429, "Too Many Requests"], [500, "Internal Server Error"],
  [502, "Bad Gateway"], [503, "Service Unavailable"], [504, "Gateway Timeout"],
];

const PANES = ["ml-rules", "ml-editor", "ml-traffic-list", "ml-traffic-detail"];
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const byName = new Intl.Collator(undefined, { numeric: true });
const ruleName = ruleLabel;
/// The whole rule on hover: method, host, path and query conditions.
const ruleTitle = (rule: Rule) =>
  `${rule.match.method} ${rule.match.host ?? ""}${rule.match.path}${queryLabel(rule.match.query)}`;
/// The engine does not keep the order of object keys (Swift dictionaries): query conditions,
/// responses, headers and a `json` body come back in any order. Keys are sorted at every level
/// before comparing, so an echo differing only in order is the same rule and the edit stays.
const canonical = (rule: Rule) => JSON.stringify(sortedKeys(rule));
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]),
  );
}
/// The response to show: `wanted` while the rule still has it, else the active one.
const shown = (rule: Rule, wanted?: string) =>
  wanted !== undefined && Object.hasOwn(rule.responses, wanted) ? wanted : rule.active;
/// Condition rows keep the order already on screen, with new keys appended.
function queryRows(query: Record<string, string> | undefined, previous: QueryRow[] = []): QueryRow[] {
  const conditions = query ?? {};
  const known = previous
    .map((row) => row.key)
    .filter((key, index, all) => Object.hasOwn(conditions, key) && all.indexOf(key) === index);
  return [...known, ...Object.keys(conditions).filter((key) => !known.includes(key))].map(
    (key) => ({ key, value: conditions[key] }),
  );
}
const errors = (): Array<[MockError | "", string]> => [
  ["", t("None")],
  ["notConnectedToInternet", t("No internet connection (-1009)")],
  ["connectionLost", t("Connection lost (-1005)")],
  ["timedOut", t("Timed out (-1001)")],
];

/// "Requests without a rule" offers the real server, blocking, and the response errors, so
/// every request to the allowed hosts can fail as if the server were out of reach.
const unmatchedChoices = (blockStatus: number): Array<[string, string]> => [
  ["passthrough", t("Send to the real server")],
  ["block", t("Block ({status})", { status: blockStatus })],
  ...errors().flatMap(([error, label]): Array<[string, string]> => (error ? [[`fail:${error}`, label]] : [])),
];

function unmatchedChoice(unmatched: Unmatched): string {
  if (unmatched.mode === "fail") return `fail:${unmatched.error ?? "notConnectedToInternet"}`;
  return unmatched.mode;
}

/// The response being edited. For the selected rule this is the source of truth, and
/// actions taken from the list are applied here too.
interface Working {
  rule: Rule;
  response: string;
  headersText: string;
  bodyKind: "json" | "text";
  bodyText: string;
  /// Whether saving in JSON mode adds `Content-Type: application/json`: for a legacy `json`
  /// body, which the engine served with it, a response without a body, and one switched to
  /// JSON here. A text body that merely parses as JSON was served without one, and keeps
  /// it that way.
  addsJSONType: boolean;
  /// Query condition rows, empty and invalid ones included. A save happens only when
  /// `readQuery` accepts them.
  queryRows: QueryRow[];
  queryProblems?: Array<string | undefined>;
  /// Text typed in the name and status fields that isn't applied yet, kept across renders.
  nameText?: string;
  nameProblem?: string;
  statusText?: string;
  error?: string;
  /// Rejected, failed to send, or restored from a draft. Remote state does not overwrite it
  /// until the user fixes or discards it.
  held: boolean;
  fromDraft: boolean;
}

/// A copy of `rule` without the query condition `key`.
function withoutCondition(rule: Rule, key: string): Rule {
  const query = Object.fromEntries(Object.entries(rule.match.query ?? {}).filter(([k]) => k !== key));
  return { ...structuredClone(rule), match: { ...rule.match, query } };
}

const widenAuthText = (rule: Rule, key: string) =>
  t(
    "The rule {rule} is an auth rule. Without the {key} condition it answers more login or token requests with a mocked token, and if that token reaches the real server, a 401 can force a logout.",
    { rule: ruleName(rule), key },
  );

/// What a response gives the app, for its tab: the status or the error, and a delay.
function responseSummary(spec: ResponseSpec): string {
  const what = spec.error ? errorNames()[spec.error] : String(spec.status ?? 200);
  return spec.delayMs ? `${what} · ${formatDuration(spec.delayMs)}` : what;
}

const errorNames = (): Record<MockError, string> => ({
  notConnectedToInternet: t("No internet connection"),
  connectionLost: t("Connection lost"),
  timedOut: t("Timed out"),
});

const turnOnAuthText = (rule: Rule) =>
  t(
    "The rule {rule} is an auth rule. Once it is on, the app's next login gets a mocked token, and if that token reaches the real server, a 401 can force a logout.",
    { rule: ruleName(rule) },
  );

/// What was rendered: the markup plus each field's value, which is a property and so
/// missing from innerHTML.
function shape(el: Element): string {
  const values = ([...el.querySelectorAll("[data-field]")] as HTMLInputElement[])
    .map((x) => `${x.getAttribute("data-field")}=${x.type === "checkbox" ? x.checked : x.value}`);
  return [el.innerHTML, ...values].join("\u0001");
}

export class View {
  connection: "waiting" | "connected" = "waiting";
  /// Whether Necto's network plugin is present. Settled while connecting (connect.ts).
  networkAvailable = false;
  /// Necto's `unavailableReason` for the network plugin, shown to the user as-is.
  networkUnavailableReason?: string;
  private tab: Tab;
  /// Built once, so the traffic view keeps its selection, scroll and expansion across
  /// renders.
  private readonly trafficHost = h("div", { class: "ml-traffic-host" });
  private readonly trafficView: TrafficView;
  private readonly trafficStore: TrafficStore;
  private captureNotice?: CaptureNotice;
  private selected?: string;
  private working?: Working;
  private dialog?: HTMLElement;
  private notice?: string;
  private success?: string;
  private successKind = "success";
  private successTimer?: ReturnType<typeof setTimeout>;
  private undo?: Undo;
  /// Built once with only its contents replaced, so a render does not lose the fact that
  /// the pointer is over it.
  private readonly toastLayer: HTMLElement;
  private readonly captureLife = new Lifetime(
    captureMs,
    () => {
      this.captureNotice = undefined;
      this.render();
    },
    () => this.toastHeld(),
  );
  /// The saved indicator beside the editor's title. In the floating layer it would cover
  /// the bottom right of the editor's body.
  private saved = false;
  /// Turned on from the off notice: the notice stays, saying so, until the pointer leaves
  /// the panel, because removing it would move the rule list under the pointer.
  private confirmOn = false;
  private confirmSince = 0;
  /// Old response names to new, per rule, so a tab or button drawn before a rename (its
  /// click can land before the redraw) acts on the renamed response.
  private renames = new Map<string, string>();
  private savedTimer?: ReturnType<typeof setTimeout>;
  /// The edit is kept while the editor's write is in flight, or until the state catches up
  /// with the revision it produced.
  private writing = 0;
  private awaitRevision = 0;
  /// Repeated new rules before their echo still get distinct ids.
  private readonly createdIds = new Set<string>();
  /// Rules made with "+ Rule" whose path has not changed yet. They start off, so a half-made
  /// `GET /` never answers requests to `/`, and turn on with the first path edit, unless the
  /// switch was set by hand first.
  private readonly awaitingPath = new Set<string>();
  /// Rules made from traffic with query conditions, by the time of the request they were
  /// made from. The panel said they answer from the next request; until one has, a later
  /// request it fits but for its query says which condition failed (`unkeptFor`).
  private readonly followed = new Map<string, number>();
  /// When the editor last sent each rule, so the latest-request line can say a request came
  /// before that change.
  private readonly changedAt = new Map<string, number>();
  private latestKey?: string;
  private trafficVersion = 0;
  private latestMemo?: { key: string; entry: TrafficEntry | undefined };
  /// Rules written from traffic, kept until a state at or past their revision arrives, so
  /// a second capture before the echo builds on the first.
  private readonly pendingWrites = new Map<string, PendingWrite>();
  /// Mocks made or extended from a traffic request, by request key, so the detail pane's
  /// primary action reflects them. Keyed per launch, because keys repeat across launches.
  private readonly capturedFrom = new Map<
    string,
    { rule: string; response: string; launch: string; host: string }
  >();
  /// Response tab order per rule. The engine does not keep response order (a Swift
  /// dictionary), so the first order seen is remembered and new responses go last.
  private readonly responseOrders = new Map<string, string[]>();
  private seenLaunch?: string;
  private seenRevision = 0;
  private readonly save = debounce(() => this.commit(), 400);
  /// The rules list width as a fraction of the split, or the default when unset. Held here
  /// because every render builds a new split.
  private rulesRatio?: number;
  /// Scrolls a rule selected by key into view at the end of the next render, after the
  /// render has restored the scroll position.
  private revealRule = false;
  /// The `working` the on-screen editor was built from. While it is unchanged, the field
  /// being typed in can keep its node.
  private editorWorking?: Working;
  /// The header's add-host field, held here so a render keeps its text and its hint.
  private hostDraft = "";
  private hostHint?: string;
  /// Renders that arrive mid-press wait for release, so the first click is not lost.
  private readonly press = new PressHold();
  private readonly redraw = () => this.render();
  private readonly redrawTraffic = () => this.refreshTraffic();

  constructor(
    private readonly root: HTMLElement,
    private readonly model: PanelModel,
    private readonly deps: ViewDeps,
  ) {
    this.tab = deps.prefs.get("panel.tab") === "traffic" ? "traffic" : "rules";
    this.rulesRatio = readSplit(deps.prefs, "split.rules");
    const traffic = deps.traffic ?? {
      store: new TrafficStore(() => this.refreshTraffic()),
      order: new OrderDetector(),
    };
    this.trafficStore = traffic.store;
    this.trafficView = new TrafficView(this.trafficHost, {
      ...traffic,
      prefs: deps.prefs,
      allowedHosts: () => this.model.state?.configuration.allowedHosts ?? [],
      isBlockedHost: (host) => this.isBlockedHost(host),
      addAllowedHost: (host) => this.allowHost(host),
      detail: (id) => deps.api.networkDetail(id),
      networkAvailable: () => this.networkAvailable,
      networkUnavailableReason: () => this.networkUnavailableReason,
      rules: () => this.effectiveRules(),
      capture: (entry, detail, path, into, query, turnOn) =>
        this.captureInto(entry, detail, path, into, query, turnOn),
      emptyRule: (entry, path, query) => this.emptyRuleFrom(entry, path, query),
      ruleForQuery: (entry, from) => this.ruleForQueryFrom(entry, from),
      unkept: (entry) => this.unkeptFor(entry),
      removeCondition: (id, key) => this.removeConditionFrom(id, key),
      openRule: (id, response) => this.openRule(id, undefined, response),
      captured: (key) => this.capturedDone(key),
      activate: (id, response) => this.switchActive(id, response),
      mapLocalEnabled: () => this.model.state?.configuration.enabled ?? true,
      enableMapLocal: () => {
        this.endUndo();
        void this.model.setEnabled(true);
      },
      enableRule: (id) => this.enableFromTraffic(id),
    });
    fixInvertedTaps(document);
    root.addEventListener("mouseleave", () => {
      if (!this.confirmOn) return;
      this.confirmOn = false;
      this.render();
    });
    document.addEventListener("keydown", () => {
      if (!this.confirmOn) return;
      this.confirmOn = false;
      this.render();
    });
    document.addEventListener("keydown", (e) => this.rulesEscape(e));
    document.addEventListener("keydown", (e) => this.undoKey(e));
    this.toastLayer = h("div", {
      class: "ml-toasts",
      role: "status",
      onmouseleave: () => this.releaseToasts(),
      // activeElement shows focus leaving the notice only after the event.
      onfocusout: () => {
        setTimeout(() => this.releaseToasts(), 0);
      },
    });
  }

  /// Held is read from the live :hover. A flag would stay set when the hovered notice
  /// disappears, because WebKit sends no mouseout then.
  private toastHeld(): boolean {
    return this.toastLayer.matches(":hover") || this.toastLayer.contains(document.activeElement);
  }

  /// Restarts a held notice's timer once the hold ends. Also called on every render,
  /// because a focused button that disappears may never send focusout.
  private releaseToasts() {
    this.captureLife.release();
  }

  /// Escape on the rules tab clears the selection, flushing the autosave first, and returns
  /// focus from the editor or list to the list. It never clears an editor field, because the
  /// empty value would be saved. With a dialog open, Escape belongs to the dialog.
  private rulesEscape(e: KeyboardEvent) {
    if (
      e.key !== "Escape" ||
      e.defaultPrevented ||
      this.tab !== "rules" ||
      this.dialog ||
      !this.root.isConnected
    )
      return;
    if (this.selected === undefined || !this.model.state || this.connection !== "connected") return;
    const target = e.target instanceof Element ? e.target : null;
    const list = this.root.querySelector(".ml-rule-list");
    const back =
      target !== null &&
      (target === list || !!this.root.querySelector(".ml-editor")?.contains(target));
    e.preventDefault();
    this.closeEditor(back);
  }

  /// ⌘Z undoes the last deletion. Necto's Edit menu takes ⌘Z before it reaches the panel,
  /// so this is a bonus for other hosts and is not advertised. In a text field ⌘Z is the
  /// field's own undo, and with nothing to undo or no notice on screen (waiting for the
  /// app) the key is left alone. There is no ⌘⇧Z. The physical Z key counts too, so a
  /// Korean input source still works.
  private undoKey(e: KeyboardEvent) {
    if (
      e.defaultPrevented ||
      !this.undo ||
      this.dialog ||
      !this.root.isConnected ||
      this.connection !== "connected"
    )
      return;
    if (!e.metaKey || e.shiftKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() !== "z" && e.code !== "KeyZ") return;
    if (isTextEntry(e.target instanceof Element ? e.target : null)) return;
    e.preventDefault();
    this.runUndo();
  }

  /// Closing the editor (Escape or ×) clears the selection, giving the list the full width
  /// again. The autosave is flushed first.
  private closeEditor(focusList: boolean) {
    this.save.flush();
    this.selected = undefined;
    this.working = undefined;
    this.render();
    if (focusList) (this.root.querySelector(".ml-rule-list") as HTMLElement | null)?.focus();
  }

  render() {
    if (this.press.defer(this.redraw)) return;
    this.press.done(this.redraw);
    const focus = captureFocus(this.root);
    const typing = this.typingField();
    const typingFor = this.working;
    const scrolls = PANES.map(
      (name) =>
        [
          name,
          (this.root.querySelector(`.${name}`) as HTMLElement | null)?.scrollTop ?? 0,
        ] as const,
    );
    const state = this.model.state;
    if (this.connection === "waiting" || !state) {
      this.root.replaceChildren(
        h(
          "div",
          { class: "necto-empty" },
          h("div", { class: "necto-empty-title" }, t("Waiting for the app to connect…")),
          h(
            "div",
            { class: "necto-caption" },
            t("Run an app that registers Map Local, and select it in Necto"),
          ),
        ),
      );
      return;
    }
    this.syncWorking();
    const top = h("div", {}, this.header(), this.tabs(), this.notices());
    keepFocusedSelect(this.root.querySelector(":scope > .ml-root")?.firstElementChild, top);
    const main = this.tab === "rules" ? this.rulesMain() : this.trafficHost;
    const layers = this.dialog ? [h("div", { class: "ml-dialog-layer" }, this.dialog)] : [];
    if (!(typing && this.working === typingFor && this.keepEditor(top, main, layers))) {
      this.root.replaceChildren(
        h("div", { class: "ml-root" }, top, main),
        this.toasts(),
        ...layers,
      );
    }
    if (this.tab === "traffic") this.trafficView.update();
    for (const [name, top] of scrolls) {
      const el = this.root.querySelector(`.${name}`) as HTMLElement | null;
      if (el && top) el.scrollTop = top;
    }
    restoreFocus(this.root, focus);
    this.releaseToasts();
    if (this.revealRule && this.tab === "rules") {
      this.revealRule = false;
      revealSelected(this.root.querySelector(".ml-rule-list"));
    }
  }

  /// The editor field being typed in, but only if the editor was built from the current
  /// `working`. A focused menu counts too: its native menu may be open, and a replaced
  /// select drops the choice made in it.
  private typingField(): Element | undefined {
    const el = document.activeElement;
    const entry = isTextEntry(el) || el instanceof HTMLSelectElement;
    if (!this.working || this.editorWorking !== this.working || !entry) return undefined;
    return this.root.querySelector(".ml-editor")?.contains(el) ? el! : undefined;
  }

  /// A render while typing (a save result, the saved indicator, new state) keeps the editor
  /// group holding the field, and its ancestors, when that group is unchanged, and replaces
  /// everything else. The field must never leave the document, or it loses its undo
  /// history and caret. When the group did change (straightened quotes, an error line),
  /// this returns false and everything is redrawn.
  private keepEditor(top: HTMLElement, main: HTMLElement, layers: HTMLElement[]): boolean {
    const oldRoot = this.root.querySelector(":scope > .ml-root");
    const oldMain = oldRoot?.querySelector(":scope > .ml-main");
    const oldEditor = oldMain?.querySelector(":scope > .ml-editor");
    const newEditor = main.querySelector(":scope > .ml-editor");
    if (!oldRoot || !oldMain || !oldEditor || !newEditor) return false;
    const olds = [...oldEditor.children];
    const news = [...newEditor.children];
    const at = olds.findIndex((child) => child.contains(document.activeElement));
    if (olds.length !== news.length || at < 0 || shape(olds[at]) !== shape(news[at])) return false;
    olds.forEach((child, i) => {
      if (i !== at) child.replaceWith(news[i]);
    });
    oldRoot.firstElementChild?.replaceWith(top);
    for (const child of [...oldMain.children]) if (child !== oldEditor) child.remove();
    oldMain.prepend(...[...main.children].filter((child) => child !== newEditor));
    for (const name of ["data-detail", "style"]) {
      const value = main.getAttribute(name);
      if (value === null) oldMain.removeAttribute(name);
      else oldMain.setAttribute(name, value);
    }
    for (const child of [...this.root.children]) if (child !== oldRoot) child.remove();
    this.root.append(this.toasts(), ...layers);
    return true;
  }

  /// Rules list, handle, editor. Widths follow the same `.ml-split` as the traffic tab
  /// (principle 6). With no rule selected the list takes the full width.
  private rulesMain(): HTMLElement {
    const open = this.working !== undefined;
    const handle = splitHandle({
      prefs: this.deps.prefs,
      key: "split.rules",
      container: () => this.root.querySelector(".ml-main"),
      value: () => this.rulesRatio,
      width: (ratio) => {
        this.rulesRatio = ratio;
      },
    });
    handle.hidden = !open;
    const main = h(
      "div",
      { class: "ml-split ml-main", "data-detail": open ? "open" : "closed" },
      this.rulesPane(),
      handle,
      this.editorPane(),
    );
    applySplit(main, this.rulesRatio);
    return main;
  }

  /// Called when the traffic store changes. A hidden tab is drawn when it is shown again.
  refreshTraffic() {
    this.trafficVersion += 1;
    this.noteAnswered();
    if (this.press.defer(this.redrawTraffic)) return;
    if (this.tab === "rules") this.paintLatest();
    this.press.done(this.redrawTraffic);
    if (this.tab === "traffic" && this.trafficHost.isConnected) this.trafficView.refreshList();
  }

  // -- header -----------------------------------------------------------------

  private header(): HTMLElement {
    const state = this.model.state!;
    const configuration = state.configuration;
    const blockStatus =
      configuration.unmatched.mode === "block" ? (configuration.unmatched.status ?? 421) : 421;
    const hosts = configuration.allowedHosts.map((host) =>
      h(
        "span",
        { class: "ml-chip" },
        host,
        h(
          "button",
          {
            class: "necto-button-quiet",
            title: t("Remove from allowed hosts"),
            "aria-label": t("Remove {host} from allowed hosts", { host }),
            "data-field": `remove-host-${host}`,
            onclick: () =>
              this.askFirst(
                this.sessionAtRisk(host),
                t(
                  "Log out in the app before you remove this allowed host ({host}). If a mocked token reaches the real server, a 401 can force a logout.",
                  { host },
                ),
                t("Remove"),
                () => {
                  this.endUndo();
                  void this.model.setAllowedHosts(configuration.allowedHosts.filter((x) => x !== host));
                },
              ),
          },
          "×",
        ),
      ),
    );
    const candidates = state.observedHosts
      .filter(
        (host) => !configuration.allowedHosts.includes(host) && !state.blockedHosts.includes(host),
      )
      .map((host) =>
        h(
          "button",
          {
            class: "necto-button-quiet",
            "data-add-host": host,
            onclick: () => {
              this.endUndo();
              void this.model.setAllowedHosts([...configuration.allowedHosts, host]);
            },
          },
          `+ ${host}`,
        ),
      );
    // Blocked hosts get a group and a label of their own, so they can't be read as allowed.
    const blocked =
      state.blockedHosts.length > 0 &&
      h(
        "span",
        { class: "ml-host-group", "data-group": "blocked-hosts" },
        h("span", { class: "necto-caption" }, t("Blocked in app code:")),
        ...state.blockedHosts.map((host) =>
          h(
            "span",
            { class: "ml-chip ml-chip-blocked", title: t("Blocked by app code (can't be changed in the panel)") },
            `🚫 ${host}`,
          ),
        ),
      );
    // What is in effect now leads on the left; sharing the configuration, used now and then,
    // sits quietly at the far right.
    return h(
      "div",
      { class: "ml-head" },
      h(
        "div",
        { class: "necto-toolbar-group ml-head-state" },
        h("button", {
          type: "button",
          class: "necto-switch",
          role: "switch",
          "aria-checked": String(configuration.enabled),
          "aria-label": t("Turn on Map Local"),
          "data-field": "map-local-enabled",
          onclick: () => {
            const on = !configuration.enabled;
            if (!on) this.confirmOn = false;
            this.askFirst(
              !on && this.sessionAtRisk(),
              t("Log out in the app before you turn off Map Local. If a mocked token reaches the real server, a 401 can force a logout."),
              t("Turn off"),
              () => {
                this.endUndo();
                void this.model.setEnabled(on);
              },
            );
          },
        }),
        h("span", { class: "ml-head-switch-label" }, configuration.enabled ? t("Map Local on") : t("Map Local off")),
        h(
          "span",
          { class: "ml-host-group", "data-group": "allowed-hosts" },
          h("span", { class: "necto-caption", title: t("Only requests to these hosts can be mocked or blocked. The rest always go to the real server") }, t("Allowed hosts")),
          ...hosts,
          this.hostInput(),
          ...candidates,
          configuration.allowedHosts.length === 0 &&
            h(
              "span",
              { class: "necto-caption ml-host-hint", title: t("Type a host, or pick one in the Traffic tab") },
              t("Type a host, or pick one in the Traffic tab"),
            ),
        ),
        blocked,
      ),
      // A second row of its own, so the header keeps its height as hosts and hints come
      // and go, and nothing below moves.
      h(
        "div",
        { class: "ml-head-settings" },
        h(
          "label",
          {},
          t("Requests without a rule"),
          " ",
          h(
            "select",
            {
              "data-field": "unmatched",
              onchange: (e) => {
                this.endUndo();
                const value = (e.target as HTMLSelectElement).value;
                void this.model.setUnmatched(
                  value === "block"
                    ? { mode: "block", status: blockStatus }
                    : value.startsWith("fail:")
                      ? { mode: "fail", error: value.slice("fail:".length) as MockError }
                      : { mode: "passthrough" },
                );
              },
            },
            ...unmatchedChoices(blockStatus).map(([value, label]) =>
              h("option", { value, selected: value === unmatchedChoice(configuration.unmatched) }, label),
            ),
          ),
        ),
        h(
          "div",
          { class: "necto-toolbar-group ml-head-share" },
          h(
            "button",
            {
              class: "necto-button-quiet",
              "data-action": "import",
              onclick: () => this.openImport(),
            },
            t("Paste configuration"),
          ),
          h(
            "button",
            {
              class: "necto-button-quiet",
              "data-action": "export",
              onclick: () => void this.export(),
            },
            t("Copy configuration"),
          ),
        ),
      ),
    );
  }

  /// Adds an allowed host by typing. A pasted URL is reduced to its host by the engine's
  /// rule. After adding, the field is cleared and keeps focus for the next one.
  private hostInput(): HTMLElement {
    const input = h("input", {
      class: "necto-field",
      "data-field": "add-host",
      placeholder: "api.example.com",
      "aria-label": t("Add an allowed host"),
      "aria-invalid": this.hostHint ? "true" : undefined,
      "aria-describedby": this.hostHint ? "ml-add-host-hint" : undefined,
      ...PLAIN_TEXT,
      value: this.hostDraft,
      oninput: (e) => {
        this.hostDraft = (e.target as HTMLInputElement).value;
        if (this.hostHint === undefined) return;
        this.hostHint = undefined;
        this.render();
      },
      onkeydown: (e) => {
        const key = e as KeyboardEvent;
        // Modified Returns such as ⌘↩ are the panel's primary action; stopping them here
        // would break it.
        if (key.key !== "Enter" || key.isComposing || key.metaKey || key.ctrlKey || key.altKey)
          return;
        key.preventDefault();
        this.addTypedHost((e.target as HTMLInputElement).value);
      },
    });
    return h(
      "label",
      { class: "ml-add-host" },
      h("span", { class: "necto-caption" }, t("+ Host")),
      input,
      this.hostHint !== undefined &&
        h(
          "span",
          {
            class: "necto-caption ml-add-host-hint",
            id: "ml-add-host-hint",
            "data-hint": "add-host",
            role: "status",
          },
          this.hostHint,
        ),
    );
  }

  private addTypedHost(raw: string) {
    const state = this.model.state;
    this.hostDraft = raw;
    if (!state || raw.trim() === "") return;
    const read = readHostInput(raw);
    if ("problem" in read) this.hostHint = read.problem;
    else if (state.configuration.allowedHosts.includes(read.host))
      this.hostHint = t("{host} is already allowed", { host: read.host });
    else if (state.blockedHosts.some((x) => (normalizeHost(x) ?? x) === read.host))
      this.hostHint = t("{host} is blocked by app code and can't be allowed", { host: read.host });
    else {
      this.hostDraft = "";
      this.hostHint = undefined;
      this.endUndo(false);
      void this.model.setAllowedHosts([...state.configuration.allowedHosts, read.host]);
    }
    this.render();
  }

  private tabs(): HTMLElement {
    const tab = (id: Tab, label: string) =>
      h(
        "button",
        {
          class: "necto-tab",
          role: "tab",
          "data-tab": id,
          "data-field": `tab-${id}`,
          "aria-selected": String(this.tab === id),
          tabindex: this.tab === id ? 0 : -1,
          onclick: () => this.setTab(id),
        },
        label,
      );
    // Switching between two tabs is cheap, so ←/→ also selects (automatic activation).
    return h(
      "div",
      {
        class: "necto-tabs ml-tabs",
        role: "tablist",
        "aria-label": t("Panel"),
        onkeydown: (e) => {
          const to = nextTab(e as KeyboardEvent)?.dataset.tab as Tab | undefined;
          if (!to) return;
          this.setTab(to);
          this.root.querySelector<HTMLElement>(`[data-tab="${to}"]`)?.focus();
        },
      },
      tab("rules", t("Rules")),
      tab("traffic", t("Traffic")),
    );
  }

  private setTab(tab: Tab) {
    this.tab = tab;
    this.deps.prefs.set("panel.tab", tab);
    this.render();
  }

  private notices(): HTMLElement {
    const state = this.model.state!;
    // Turned off since, from anywhere: the confirmation no longer holds.
    if (this.confirmOn && !state.configuration.enabled && state.revision > this.confirmSince) this.confirmOn = false;
    const failure = this.model.lastFailure;
    const issues = (state.issueDetails ?? state.issues.map((message) => ({ message }))).map(translate).join(" · ");
    return h(
      "div",
      {},
      // The switch in the header says Off, but the rules below still read as on; say what
      // that means where the rules are.
      !state.configuration.enabled &&
        h(
          "div",
          { class: "necto-notice", "data-notice": "map-local-off" },
          t("Map Local is off, so no rule applies"),
          " ",
          h(
            "button",
            {
              class: "necto-button",
              onclick: () => {
                this.endUndo();
                this.confirmOn = true;
                this.confirmSince = state.revision;
                // The button goes once it is on, so the switch that now says so takes focus.
                this.root.querySelector<HTMLElement>('[data-field="map-local-enabled"]')?.focus();
                void this.model.setEnabled(true).then((result) => {
                  if (result.ok) return;
                  this.confirmOn = false;
                  this.render();
                });
              },
            },
            t("Turn on"),
          ),
        ),
      state.configuration.enabled &&
        this.confirmOn &&
        h(
          "div",
          { class: "necto-notice", "data-notice": "map-local-off" },
          t("Map Local is on, so rules apply"),
          " ",
          // An unseen stand-in for the button keeps the notice as tall as it was.
          h("button", { class: "necto-button", style: "visibility: hidden", tabindex: -1, "aria-hidden": "true", disabled: true }, t("Turn on")),
        ),
      state.readOnly &&
        h(
          "div",
          { class: "necto-notice necto-notice-danger" },
          t("The configuration is read-only."),
          " ",
          issues,
        ),
      !state.readOnly && issues !== "" && h("div", { class: "necto-notice" }, issues),
      state.authMocked &&
        h(
          "div",
          { class: "necto-notice necto-notice-danger" },
          t("A mocked login session may remain in the app. Log out in the app before you turn off or delete an auth rule."),
          " ",
          h(
            "button",
            { class: "necto-button", onclick: () => void this.model.acknowledgeSession() },
            t("I've logged out"),
          ),
        ),
      failure &&
        !failure.ok &&
        h(
          "div",
          { class: "necto-notice necto-notice-danger" },
          t("Couldn't save ({reason}): {message}", { reason: failure.reason, message: translate(failure) }),
        ),
      this.model.conflict &&
        h(
          "div",
          { class: "necto-notice" },
          t("It keeps changing elsewhere. Check what just arrived"),
        ),
      this.notice && h("div", { class: "necto-notice necto-notice-danger" }, this.notice),
    );
  }

  /// Transient notices (undo, capture results) live in a floating layer, so appearing and
  /// disappearing never pushes the list or the editor. Each button has a `data-field` to
  /// keep focus across renders, and a notice does not expire while it holds focus.
  private toasts(): HTMLElement {
    const captured = this.liveCapture();
    const children = [
      this.success &&
        h("div", { class: "necto-notice", "data-notice": this.successKind }, this.success),
      this.undo &&
        h(
          "div",
          { class: "necto-notice", "data-notice": "undo" },
          this.undo.text,
          " ",
          h(
            "button",
            {
              class: "necto-button",
              "data-action": "undo",
              "data-field": "toast-undo",
              onclick: () => this.runUndo(),
            },
            t("Undo"),
          ),
          h(
            "button",
            {
              class: "necto-button-quiet",
              "data-action": "close-undo",
              "data-field": "toast-undo-close",
              title: t("Close"),
              "aria-label": t("Close notice"),
              onclick: () => {
                this.endUndo();
                this.currentList()?.focus();
              },
            },
            "×",
          ),
        ),
      captured &&
        h(
          "div",
          { class: "necto-notice", "data-notice": "capture" },
          captured.text,
          " ",
          captured.name &&
            h(
              "button",
              {
                class: "necto-button",
                "data-action": "activate-captured",
                "data-field": "toast-activate",
                onclick: () => {
                  this.switchActive(captured.id, captured.name!);
                  captured.name = undefined;
                  this.render();
                },
              },
              t("Send this response to the app"),
            ),
          h(
            "button",
            {
              class: "necto-button",
              "data-action": "open-captured",
              "data-field": "toast-open",
              onclick: () => this.openRule(captured.id, captured.seed, captured.response),
            },
            t("Open rule"),
          ),
          h(
            "button",
            {
              class: "necto-button-quiet",
              "data-field": "toast-close",
              title: t("Close"),
              "aria-label": t("Close notice"),
              onclick: () => this.dropCapture(),
            },
            "×",
          ),
        ),
    ].filter((c): c is HTMLElement => !!c);
    this.toastLayer.replaceChildren(...children);
    return this.toastLayer;
  }

  /// The capture notice shows only while its rule and response still exist, so it never
  /// offers to open a deleted rule.
  private liveCapture(): CaptureNotice | undefined {
    const notice = this.captureNotice;
    if (!notice) return undefined;
    const rule =
      this.working?.rule.id === notice.id
        ? this.working.rule
        : this.effectiveRules()
            .filter(isRule)
            .find((r) => r.id === notice.id);
    if (!rule) {
      this.dropCapture(false);
      return undefined;
    }
    if (notice.name !== undefined && !Object.hasOwn(rule.responses, notice.name)) notice.name = undefined;
    return notice;
  }

  private showCapture(notice: CaptureNotice) {
    this.captureNotice = notice;
    this.captureLife.start();
  }

  private dropCapture(redraw = true) {
    this.captureNotice = undefined;
    this.captureLife.stop();
    if (redraw) this.render();
  }

  // -- rules list -------------------------------------------------------------

  private knownIds(): string[] {
    return [
      ...this.model.state!.configuration.rules.filter(isRule).map((r) => r.id),
      ...this.createdIds,
    ];
  }

  /// Includes rules whose echo has not arrived yet, from traffic or a new rule. Otherwise a
  /// rule just created and opened would be selected with no row to show it.
  private listedRules(): Configuration["rules"] {
    const rules = this.effectiveRules();
    const working = this.working;
    if (
      working &&
      this.createdIds.has(working.rule.id) &&
      !rules.some((r) => isRule(r) && r.id === working.rule.id)
    )
      return [...rules, working.rule];
    return rules;
  }

  private rulesPane(): HTMLElement {
    const rules = this.listedRules();
    const rows = rules.map((entry) => {
      if (!isRule(entry)) {
        return h(
          "div",
          {
            class: "ml-rule ml-chip-blocked",
            role: "option",
            "aria-disabled": "true",
            "aria-selected": "false",
          },
          "",
          h(
            "span",
            { class: "ml-path" },
            t("Unsupported rule {id}", {
              id: typeof entry === "object" && entry !== null && typeof entry.id === "string" ? entry.id : "",
            }),
          ),
          "",
        );
      }
      const rule = this.working?.rule.id === entry.id ? this.working.rule : entry;
      // The checkbox is not a Tab stop, since the list is one; from the keyboard, Space
      // toggles the selected rule.
      return h(
        "div",
        {
          class: "ml-rule",
          role: "option",
          id: optionId("ml-r", rule.id),
          "data-rule": rule.id,
          "data-enabled": String(rule.enabled !== false),
          "aria-selected": String(this.selected === rule.id),
        },
        h("input", {
          type: "checkbox",
          tabindex: -1,
          "aria-label": t("Turn on rule"),
          title: t("Turn the rule on or off"),
          checked: rule.enabled !== false,
          onclick: (e) => {
            e.preventDefault();
            this.toggleRule(rule.id);
            this.render();
          },
        }),
        h(
          "span",
          { class: "ml-path", title: ruleTitle(rule), onclick: () => this.select(rule.id) },
          `${rule.tags?.includes("auth") ? "🔑 " : ""}${rule.match.method} ${rule.match.path}`,
          // Tells apart rules that split one path by query. No conditions means any query.
          queryLabel(rule.match.query) && " ",
          queryLabel(rule.match.query) &&
            h("span", { class: "ml-query" }, queryLabel(rule.match.query)),
          // Tells apart rules that split one path by host. No host means every allowed host.
          rule.match.host !== undefined && h("span", { class: "ml-host" }, rule.match.host),
        ),
      );
    });
    const list = h(
      "div",
      {
        class: this.model.state?.configuration.enabled === false ? "ml-rule-list ml-rules-off" : "ml-rule-list",
        role: "listbox",
        tabindex: 0,
        "data-field": "rules-list",
        "aria-label": t("Rule list"),
        onkeydown: (e) => this.rulesKey(e as KeyboardEvent),
      },
      ...rows,
    );
    syncActive(list);
    // The new rule button sits above the list. At the bottom, the undo notice in the lower
    // right would cover it at narrow widths.
    return h(
      "div",
      { class: "ml-rules" },
      h(
        "div",
        { class: "necto-toolbar" },
        h(
          "button",
          { class: "necto-button", "data-action": "new-rule", onclick: () => this.addRule() },
          t("+ Rule"),
        ),
      ),
      list,
      rules.length === 0 &&
        h(
          "div",
          { class: "necto-empty ml-rules-empty", "data-empty": "rules" },
          // One paragraph: necto-empty is a column and would stack the text and button.
          h(
            "p",
            { class: "necto-empty-title" },
            ...fill(
              t("No rules yet — pick a request in the {traffic} and press [Mock with this response], or make one with [+ Rule]"),
              {
                traffic: h(
                  "button",
                  {
                    class: "necto-button-quiet",
                    "data-action": "go-traffic",
                    onclick: () => this.setTab("traffic"),
                  },
                  t("Traffic tab"),
                ),
              },
            ),
          ),
        ),
    );
  }

  /// ↑↓, ⇞⇟, Home and End select, with the editor following; Space toggles the selected
  /// rule.
  private rulesKey(e: KeyboardEvent) {
    if (this.dialog) return; // the list behind an open dialog takes no keys
    const list = e.currentTarget as HTMLElement;
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      // To the path field, not the method select: typing into a closed select changes the
      // method silently through typeahead.
      this.root.querySelector<HTMLElement>('.ml-editor [data-field="path"]')?.focus();
      return;
    }
    if (e.key === " ") {
      const id = selectedOption(list)?.dataset.rule;
      if (id) {
        e.preventDefault();
        this.toggleRule(id);
        this.render();
      }
      return;
    }
    const to = navigate(list, e);
    if (!to) return;
    if (to.getAttribute("aria-selected") === "true") {
      revealSelected(list);
      return;
    }
    this.revealRule = true;
    this.select(to.dataset.rule!);
  }

  private addRule() {
    const rule = { ...newRule(this.knownIds()), enabled: false };
    this.createdIds.add(rule.id);
    this.awaitingPath.add(rule.id);
    this.endUndo();
    void this.model.upsertRule(rule);
    this.revealRule = true;
    this.select(rule.id, rule);
  }

  /// For the selected rule the edit is the truth, since its echo may not have arrived.
  private latestRule(id: string): Rule | undefined {
    if (this.working?.rule.id === id) return structuredClone(this.working.rule);
    return this.model.state!.configuration.rules.filter(isRule).find((r) => r.id === id);
  }

  private toggleRule(id: string) {
    this.awaitingPath.delete(id);
    this.save.flush();
    const current = this.latestRule(id);
    if (current) this.setRuleEnabled(id, current.enabled === false);
  }

  /// Turning an auth rule off asks first; turning any rule on never does.
  private setRuleEnabled(id: string, on: boolean) {
    this.save.flush();
    const current = this.latestRule(id);
    if (!current || (current.enabled !== false) === on) return;
    const turnOff = !on;
    const apply = () => {
      this.endUndo();
      const next = { ...this.latestRule(id)!, enabled: on };
      const write = this.model.upsertRule(next);
      // The open editor keeps the new state until the echo, so its switch and the list
      // checkbox agree in between.
      if (this.working?.rule.id === id) {
        this.working.rule.enabled = next.enabled;
        this.track(write, { rule: id, quiet: true });
      }
    };
    this.askFirst(
      turnOff && this.guardsSession(current),
      t("Log out in the app before you turn off the auth rule. If a mocked token reaches the real server, a 401 can force a logout."),
      t("Turn off"),
      apply,
    );
  }

  /// Turning a rule on from traffic is one click away from a request, where the rule's auth
  /// tag is not in view; an auth rule turned on there would mock the app's next login, so it
  /// asks first. The rule list and editor show the tag, and turn rules on without asking.
  private enableFromTraffic(id: string) {
    const rule = this.latestRule(id);
    if (!rule) return;
    this.askFirst(this.isAuthRule(rule), turnOnAuthText(rule), t("Turn on"), () => this.setRuleEnabled(id, true));
  }

  /// Changes the active response. If the editor has the rule open its tab follows, because
  /// the selected tab is the active response.
  /// The response `name` names now: itself, or what it was renamed to, if the rule has it.
  private resolveResponse(id: string, name: string): string | undefined {
    const rule = this.working?.rule.id === id ? this.working.rule : this.latestRule(id);
    let current = name;
    for (let hops = 0; rule && !Object.hasOwn(rule.responses, current) && hops < 16; hops++) {
      const next = this.renames.get(`${id}\u0000${current}`);
      if (next === undefined) return undefined;
      current = next;
    }
    return rule && Object.hasOwn(rule.responses, current) ? current : undefined;
  }

  /// A working copy of `rule` showing `response`, carrying what is typed but not saved yet
  /// when it is the same response under the same or a new name.
  private carryWorking(from: Working, rule: Rule, response: string, sameResponse: boolean): Working {
    // The rows as typed, invalid ones included: they reach the rule only once they read.
    const next = { ...this.workingFor(rule, response), queryRows: from.queryRows, queryProblems: from.queryProblems };
    if (!sameResponse) return next;
    return {
      ...next,
      headersText: from.headersText,
      bodyText: from.bodyText,
      bodyKind: from.bodyKind,
      addsJSONType: from.addsJSONType,
      statusText: from.statusText,
      error: from.error,
      held: from.held,
    };
  }

  private switchActive(id: string, asked: string) {
    const response = this.resolveResponse(id, asked);
    if (response === undefined) return;
    this.save.flush();
    const working = this.working;
    if (working?.rule.id === id) {
      if (working.rule.active === response && working.response === response) return;
      working.rule.active = response;
      this.working = this.workingFor(working.rule, response);
    }
    this.track(this.model.setActive(id, response), { rule: id });
    this.render();
  }

  /// Both the saved and the edited tags count, so toggling the auth checkbox in the editor
  /// just before cannot slip past a question.
  private isAuthRule(rule: Rule) {
    const saved = this.model
      .state!.configuration.rules.filter(isRule)
      .find((r) => r.id === rule.id);
    const working = this.working?.rule.id === rule.id ? this.working.rule : undefined;
    return [rule, saved, working].some((r) => (r?.tags ?? []).includes("auth"));
  }

  /// Asks first when a mocked session may remain and the rule is an auth rule.
  private guardsSession(rule: Rule) {
    return this.model.state!.authMocked && this.isAuthRule(rule);
  }

  /// Whether a mocked session may remain and an auth rule that is on answers `host` (any
  /// allowed host when omitted), so that turning Map Local off or removing the host would
  /// send the app's mocked token to the real server.
  private sessionAtRisk(host?: string) {
    const state = this.model.state!;
    if (!state.authMocked) return false;
    const hosts = host === undefined ? state.configuration.allowedHosts : [host];
    return this.effectiveRules()
      .filter(isRule)
      .some((rule) => {
        if (rule.enabled === false || !this.isAuthRule(rule)) return false;
        const ruleHost = rule.match.host === undefined ? undefined : normalizeHost(rule.match.host);
        return ruleHost === undefined ? hosts.length > 0 : hosts.includes(ruleHost);
      });
  }

  /// The one exception to principle 4: an action that can send a mocked token to the real
  /// server asks first. Runs `action` at once when `ask` is false.
  private askFirst(ask: boolean, text: string, label: string, action: () => void) {
    if (ask) this.confirm(text, label, action);
    else action();
  }

  /// Shows the active response, or `response` when given, such as one just captured.
  private select(id: string, seed?: Rule, response?: string) {
    this.save.flush();
    clearTimeout(this.savedTimer);
    this.saved = false; // the saved indicator belongs to the previous rule
    this.selected = id;
    this.working = undefined;
    // Traffic writes still awaiting their echo count, so a response just captured is there.
    const rule = seed ?? this.effectiveRules().filter(isRule).find((r) => r.id === id);
    if (rule) this.working = this.workingFor(rule, shown(rule, response));
    this.render();
  }

  // -- editor -----------------------------------------------------------------

  private workingFor(rule: Rule, response: string, previousRows?: QueryRow[]): Working {
    const spec = rule.responses[response] ?? {};
    const draft = this.deps.drafts.get(`${rule.id}/${response}`);
    return {
      rule: structuredClone(rule),
      response,
      headersText: draft?.headersText ?? JSON.stringify(spec.headers ?? {}, null, 2),
      bodyKind: spec.body !== undefined && !isJSONDocument(spec.body) ? "text" : "json",
      addsJSONType: spec.body === undefined,
      bodyText:
        draft?.bodyText ??
        (spec.body !== undefined ? spec.body : JSON.stringify(spec.json ?? {}, null, 2)),
      queryRows: queryRows(rule.match.query, previousRows),
      held: draft !== undefined,
      fromDraft: draft !== undefined,
    };
  }

  /// Remote state replaces the edit only while editing is idle.
  private syncWorking() {
    const state = this.model.state!;
    if (this.seenLaunch !== state.launchID || state.revision < this.seenRevision)
      this.awaitRevision = 0;
    // Undo has no timeout, so it ends here when the app relaunches; it may even be a
    // different app, and a deletion must not be restored into it.
    if (this.seenLaunch !== undefined && this.seenLaunch !== state.launchID) this.undo = undefined;
    this.seenLaunch = state.launchID;
    this.seenRevision = state.revision;
    const rule = this.effectiveRules()
      .filter(isRule)
      .find((r) => r.id === this.selected);
    if (!rule) {
      // A new rule waiting for its echo.
      if (this.selected && this.createdIds.has(this.selected) && this.working) return;
      this.working = undefined;
      return;
    }
    this.createdIds.delete(rule.id);
    const working = this.working;
    if (
      working &&
      working.rule.id === rule.id &&
      (this.save.pending() ||
        this.writing > 0 ||
        working.held ||
        state.revision < this.awaitRevision)
    )
      return;
    if (!working || working.rule.id !== rule.id || canonical(working.rule) !== canonical(rule)) {
      const same = working?.rule.id === rule.id;
      // A response shown without being active (opened after a capture) stays shown; the
      // active one follows the echo.
      const viewing = same && working.response !== working.rule.active ? working.response : undefined;
      this.working = this.workingFor(rule, shown(rule, viewing), same ? working.queryRows : undefined);
    }
  }

  private editorPane(): HTMLElement {
    const working = this.working;
    this.editorWorking = working;
    if (!working) return h("div", { class: "ml-editor", hidden: true });
    const rule = working.rule;
    const spec = rule.responses[working.response] ?? (rule.responses[working.response] = {});
    const live = () => (rule.responses[working.response] ??= {});
    const edit = (mutate: () => void) => {
      mutate();
      working.held = false;
      working.fromDraft = false;
      this.save.call();
      // Only the tab's summary changes: a render would replace the field being typed in.
      const tab = [...this.root.querySelectorAll(".ml-editor [data-response]")].find(
        (el) => el.getAttribute("data-response") === working.response,
      );
      const spec = rule.responses[working.response];
      const meta = tab?.querySelector(".ml-tab-meta");
      if (meta && spec) meta.textContent = responseSummary(spec);
      this.paintPrecedence(working);
    };
    return h(
      "div",
      { class: "ml-editor" },
      h(
        "div",
        { class: "necto-toolbar ml-editor-head" },
        // The same on/off as the list checkbox, where the rule is being looked at.
        h("button", {
          type: "button",
          class: "necto-switch",
          role: "switch",
          "data-field": "rule-enabled",
          "aria-checked": String(rule.enabled !== false),
          "aria-label": t("Turn on rule"),
          // On or off, the rule does nothing while Map Local is off.
          "data-overridden": this.model.state?.configuration.enabled === false ? "" : undefined,
          title: this.model.state?.configuration.enabled === false ? t("Map Local is off, so this rule doesn't apply") : undefined,
          onclick: () => {
            this.toggleRule(rule.id);
            this.render();
          },
        }),
        h("span", { class: "ml-path", title: ruleTitle(rule) }, ruleName(rule)),
        // Always present with only its text changing, so it pushes nothing when it appears
        // and assistive technology reads the change.
        h(
          "span",
          { class: "necto-caption ml-saved", "data-notice": "saved", role: "status" },
          this.saved ? t("Saved") : "",
        ),
        // Delete sits at the top, not the bottom, where notices in the lower right would
        // cover it.
        h(
          "button",
          {
            class: "necto-button necto-button-danger",
            "data-action": "delete-rule",
            "data-field": "delete-rule",
            onclick: () => this.deleteRule(rule),
          },
          t("Delete rule"),
        ),
        h(
          "button",
          {
            class: "necto-button-quiet",
            "data-action": "close-editor",
            title: t("Close (Esc)"),
            "aria-label": t("Close editor"),
            onclick: () => this.closeEditor(true),
          },
          "×",
        ),
      ),
      h("div", { class: "necto-caption ml-latest", "data-latest": "" }, ...this.latestChildren(rule)),
      working.fromDraft &&
        h(
          "div",
          { class: "necto-notice" },
          t("Loaded an unsaved draft."),
          " ",
          h("button", { class: "necto-button", onclick: () => this.discardDraft() }, t("Discard")),
        ),
      h(
        "div",
        { class: "ml-grid" },
        t("Method"),
        h(
          "select",
          {
            "data-field": "method",
            onchange: (e) =>
              edit(() => {
                rule.match.method = (e.target as HTMLSelectElement).value;
              }),
          },
          ...methods.map((method) =>
            h("option", { value: method, selected: method === rule.match.method }, method),
          ),
        ),
        t("Host"),
        h("input", {
          class: "necto-field",
          "data-field": "host",
          placeholder: t("Empty means every allowed host"),
          value: rule.match.host ?? "",
          oninput: (e) =>
            edit(() => {
              const value = (e.target as HTMLInputElement).value.trim();
              if (value) rule.match.host = value;
              else delete rule.match.host;
            }),
        }),
        t("Path"),
        h("input", {
          class: "necto-field",
          "data-field": "path",
          placeholder: "/path/{param}",
          value: rule.match.path,
          oninput: (e) => {
            let turnedOn = false;
            edit(() => {
              rule.match.path = (e.target as HTMLInputElement).value;
              turnedOn = rule.enabled === false && this.awaitingPath.delete(rule.id);
              if (turnedOn) rule.enabled = true;
            });
            // The switch and the list show it at once, so a click on the switch that follows
            // isn't made against a stale "off".
            if (turnedOn) this.render();
          },
        }),
        h("span", { "data-caption": "query" }, t("Query conditions")),
        this.queryField(working, edit),
        t("Auth rule"),
        h(
          "label",
          { title: authHint() },
          h("input", {
            type: "checkbox",
            "data-field": "auth",
            checked: (rule.tags ?? []).includes("auth"),
            onchange: (e) =>
              edit(() => {
                const on = (e.target as HTMLInputElement).checked;
                rule.tags = on
                  ? [...new Set([...(rule.tags ?? []), "auth"])]
                  : (rule.tags ?? []).filter((tag) => tag !== "auth");
              }),
          }),
          " ",
          t("A response that hands out a login or token"),
        ),
      ),
      h(
        "div",
        { class: "ml-response-tabs" },
        h("span", { class: "necto-caption", "data-caption": "active-response" }, t("Response the app gets")),
        // Selecting a response tab changes what the app receives, a write to the engine.
        // So ←/→ only move focus and Return or Space selects (manual activation).
        h(
          "div",
          {
            class: "necto-tabs",
            role: "tablist",
            "aria-label": t("Response the app gets"),
            onkeydown: (e) => nextTab(e as KeyboardEvent)?.focus(),
          },
          ...this.orderedResponses(rule).map((name) =>
            h(
              "span",
              { class: "ml-tab-wrap", role: "presentation" },
              h(
              "button",
              {
                class: "necto-tab",
                role: "tab",
                "data-response": name,
                "data-field": `response-tab:${name}`,
                "aria-selected": String(name === working.response),
                // Marked apart from the selection: a response opened after a capture is
                // shown without being the one the app gets.
                "data-live": name === rule.active ? "" : undefined,
                "aria-current": name === rule.active ? "true" : undefined,
                title: name === rule.active ? t("The app gets this response") : undefined,
                tabindex: name === working.response ? 0 : -1,
                onclick: () => this.switchActive(rule.id, name),
                onkeydown: (e) => {
                  const key = (e as KeyboardEvent).key;
                  if ((key !== "Delete" && key !== "Backspace") || Object.keys(rule.responses).length < 2) return;
                  e.preventDefault();
                  this.removeResponse(name);
                },
              },
              name,
              h("span", { class: "ml-tab-meta" }, responseSummary(rule.responses[name] ?? {})),
              ),
              // Each tab deletes itself, so a response the app doesn't get goes without first
              // becoming the one it gets. Only the shown tab's is on the Tab path.
              Object.keys(rule.responses).length > 1 &&
                h(
                  "button",
                  {
                    class: "necto-button-quiet ml-tab-remove",
                    "data-action": "remove-response",
                    "data-remove": name,
                    tabindex: name === working.response ? 0 : -1,
                    "aria-label": t("Delete the response “{name}”", { name }),
                    title: t("Delete the response “{name}”", { name }),
                    onclick: () => this.removeResponse(name),
                  },
                  "×",
                ),
            ),
          ),
        ),
        h(
          "button",
          {
            class: "necto-button-quiet",
            "data-action": "add-response",
            onclick: () => this.addResponse(),
          },
          t("+ Response"),
        ),
      ),

      // The selected tab is normally the active response. One opened after a capture is
      // shown without becoming active, so say what the app gets instead.
      working.response !== rule.active &&
        h(
          "div",
          { class: "necto-caption", "data-caption": "not-active" },
          t("The app gets the response {active} now", { active: rule.active }),
          " ",
          h(
            "button",
            {
              class: "necto-button",
              "data-action": "activate-shown",
              onclick: () => this.switchActive(rule.id, working.response),
            },
            t("Send this response to the app"),
          ),
        ),
      h(
        "div",
        { class: "ml-grid ml-response-grid" },
        t("Name"),
        h(
          "div",
          { class: "ml-name-field" },
          h("input", {
            class: "necto-field",
            "data-field": "response-name",
            "aria-label": t("Response name"),
            ...PLAIN_TEXT,
            value: working.nameText ?? working.response,
            "aria-invalid": working.nameProblem ? "true" : undefined,
            oninput: (e) => {
              working.nameText = (e.target as HTMLInputElement).value;
            },
            // Renamed on Return or leaving the field: a key changed per keystroke would write
            // a new response each time.
            onchange: (e) => this.renameResponse((e.target as HTMLInputElement).value),
          }),
          working.nameProblem &&
            h("span", { class: "ml-query-problem", "data-name-problem": "", role: "alert" }, working.nameProblem),
        ),
        t("Status"),
        this.statusField(working, spec.status, () => live().error !== undefined, (status) =>
          edit(() => {
            const response = live();
            if (status === undefined) delete response.status;
            else response.status = status;
          }),
        ),
        t("Network error"),
        h(
          "select",
          {
            "data-field": "error",
            onchange: (e) =>
              edit(() => {
                const value = (e.target as HTMLSelectElement).value as MockError | "";
                const response = live();
                if (value) response.error = value;
                else delete response.error;
              }),
          },
          ...errors().map(([value, label]) =>
            h("option", { value, selected: (spec.error ?? "") === value }, label),
          ),
        ),
        t("Body"),
        h(
          "div",
          { class: "ml-body-field" },
          h(
            "select",
            {
              "data-field": "body-kind",
              onchange: (e) =>
                edit(() => {
                  working.bodyKind = (e.target as HTMLSelectElement).value as "json" | "text";
                  if (working.bodyKind === "json") working.addsJSONType = true;
                }),
            },
            h("option", { value: "json", selected: working.bodyKind === "json" }, "JSON"),
            h("option", { value: "text", selected: working.bodyKind === "text" }, t("Text")),
          ),
          h("textarea", {
            class: "necto-json-editor",
            "data-field": "body",
            ...PLAIN_TEXT,
            value: working.bodyText,
            oninput: (e) =>
              edit(() => {
                working.bodyText = (e.target as HTMLTextAreaElement).value;
              }),
          }),
        ),
        t("Delay (ms)"),
        h("input", {
          class: "necto-field",
          "data-field": "delay",
          type: "number",
          min: 0,
          max: 60000,
          value: spec.delayMs ?? 0,
          oninput: (e) =>
            edit(() => {
              const value = Number((e.target as HTMLInputElement).value);
              const response = live();
              if (value > 0) response.delayMs = value;
              else delete response.delayMs;
            }),
        }),
        t("Headers"),
        h("textarea", {
          class: "necto-json-editor",
          "data-field": "headers",
          ...PLAIN_TEXT,
          value: working.headersText,
          oninput: (e) =>
            edit(() => {
              working.headersText = (e.target as HTMLTextAreaElement).value;
            }),
        }),
      ),
      working.error && h("div", { class: "ml-error" }, working.error),
    );
  }

  /// Query conditions: key=value rows and a button to add one; no rows means any query. The
  /// engine matches only when every listed key is present with that value and ignores keys
  /// not listed. Return moves from a key to its value, from a value to the next row's key,
  /// and from the last value to a new row, unless that row is empty.
  private queryField(working: Working, edit: (mutate: () => void) => void): HTMLElement {
    const rows = working.queryRows;
    const focusField = (name: string) =>
      this.root.querySelector<HTMLElement>(`.ml-editor [data-field="${name}"]`)?.focus();
    const add = () => {
      rows.push({ key: "", value: "" });
      this.render();
      focusField(`query-key:${rows.length - 1}`);
    };
    const remove = (i: number) => {
      edit(() => {
        rows.splice(i, 1);
      });
      // Problems must move up with their rows, so read again now rather than let a problem
      // show beside the wrong row until the next save.
      if (working.queryProblems) {
        const read = readQuery(rows);
        working.queryProblems = read.ok ? undefined : read.problems;
      }
      this.render();
      if (rows.length === 0) focusField("add-query");
      else focusField(`query-key:${Math.min(i, rows.length - 1)}`);
    };
    const returnKey = (e: KeyboardEvent, next: () => void) => {
      if (e.key !== "Enter" || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
        return;
      e.preventDefault();
      next();
    };
    const removeLabel = (key: string) =>
      key ? t("Remove the {key} condition", { key }) : t("Remove the empty condition");
    return h(
      "div",
      { class: "ml-query-field" },
      ...rows.map((row, i) => {
        const problem = working.queryProblems?.[i];
        const hint = queryValueHint(row.value);
        const remover = h(
          "button",
          {
            class: "necto-button-quiet",
            "data-action": "remove-query",
            "aria-label": removeLabel(row.key),
            title: t("Remove condition"),
            onclick: () => remove(i),
          },
          "×",
        );
        return h(
          "div",
          { class: "ml-query-row", "data-query-row": i },
          h("input", {
            class: "necto-field",
            "data-field": `query-key:${i}`,
            "aria-label": t("Query key"),
            placeholder: t("Key"),
            ...PLAIN_TEXT,
            value: row.key,
            "aria-invalid": problem ? "true" : undefined,
            oninput: (e) =>
              edit(() => {
                row.key = (e.target as HTMLInputElement).value;
                remover.setAttribute("aria-label", removeLabel(row.key));
              }),
            onkeydown: (e) => returnKey(e as KeyboardEvent, () => focusField(`query-value:${i}`)),
          }),
          h("span", { class: "necto-caption", "aria-hidden": "true" }, "="),
          h("input", {
            class: "necto-field",
            "data-field": `query-value:${i}`,
            "aria-label": t("Query value"),
            placeholder: t("Value"),
            ...PLAIN_TEXT,
            value: row.value,
            oninput: (e) =>
              edit(() => {
                row.value = (e.target as HTMLInputElement).value;
              }),
            onkeydown: (e) =>
              returnKey(e as KeyboardEvent, () => {
                if (i < rows.length - 1) focusField(`query-key:${i + 1}`);
                else if (rows[i].key !== "" || rows[i].value !== "") add();
              }),
          }),
          remover,
          problem &&
            h(
              "span",
              { class: "ml-query-problem", "data-query-problem": i, role: "alert" },
              problem,
            ),
          !problem &&
            hint &&
            h("span", { class: "necto-caption ml-query-hint", "data-query-hint": i }, hint),
        );
      }),
      rows.length === 0 &&
        h("span", { class: "necto-caption", "data-query-empty": true }, t("Any query")),
      h(
        "button",
        {
          class: "necto-button-quiet",
          "data-action": "add-query",
          "data-field": "add-query",
          onclick: () => add(),
        },
        t("+ Condition"),
      ),
      h("div", { class: "necto-caption ml-precedence", "data-precedence": "" }, ...this.precedenceLines(working)),
    );
  }

  /// Which rule answers a request this rule shares with another, since nothing else says
  /// that more query conditions win. Rules this one gives way to come first. The conditions
  /// are read as typed, since they reach the rule only when it is saved.
  private precedenceLines(working: Working): HTMLElement[] {
    const read = readQuery(working.queryRows);
    const rule: Rule = read.ok ? { ...working.rule, match: { ...working.rule.match, query: read.query } } : working.rule;
    const found = overlaps(this.effectiveRules(), rule).sort((a, b) => Number(a.answers === "this") - Number(b.answers === "this"));
    const shown = 2;
    const lines = found.slice(0, shown).map(({ rule: other, answers, reason }) =>
      h(
        "div",
        { title: ruleTitle(other) },
        answers === "this"
          ? t("This rule answers the requests it shares with {rule}", { rule: ruleLabel(other) })
          : t("{rule} answers the requests it shares with this rule", { rule: ruleLabel(other) }),
        ". ",
        reason === "conditions" ? t("It has more query conditions") : t("It is higher in the list"),
      ),
    );
    if (found.length > shown) lines.push(h("div", {}, t("{count} more overlapping rules", { count: found.length - shown })));
    return lines;
  }

  private paintPrecedence(working: Working) {
    this.root.querySelector(".ml-editor [data-precedence]")?.replaceChildren(...this.precedenceLines(working));
  }

  /// Keeps the order first seen (natural name order) and appends later responses. The engine
  /// does not keep response order, so the order is remembered per viewer and tabs stay put
  /// across relaunches of the app. With nothing remembered, names are sorted.
  private orderedResponses(rule: Rule): string[] {
    const names = Object.keys(rule.responses);
    const key = `responses.${rule.id}`;
    const stored = this.responseOrders.get(rule.id) ?? this.storedOrder(key);
    const known = stored.filter((name) => Object.hasOwn(rule.responses, name));
    const order = [...known, ...names.filter((name) => !known.includes(name)).sort(byName.compare)];
    this.responseOrders.set(rule.id, order);
    if (JSON.stringify(order) !== JSON.stringify(stored))
      this.deps.prefs.set(key, JSON.stringify(order));
    return order;
  }

  private storedOrder(key: string): string[] {
    try {
      const value: unknown = JSON.parse(this.deps.prefs.get(key) ?? "[]");
      return Array.isArray(value)
        ? value.filter((name): name is string => typeof name === "string")
        : [];
    } catch {
      return [];
    }
  }

  private discardDraft() {
    const working = this.working!;
    this.deps.drafts.clear(`${working.rule.id}/${working.response}`);
    const rule =
      this.model.state!.configuration.rules.filter(isRule).find((r) => r.id === working.rule.id) ??
      working.rule;
    this.working = this.workingFor(rule, working.response);
    this.render();
  }

  /// A new response goes last and becomes active at once, in a single write.
  private addResponse() {
    this.save.flush();
    const working = this.working!;
    this.orderedResponses(working.rule);
    let n = 2;
    while (working.rule.responses[t("Response {n}", { n })]) n += 1;
    const name = t("Response {n}", { n });
    working.rule.responses[name] = emptyJSONResponse();
    working.rule.active = name;
    this.track(this.model.upsertRule(structuredClone(working.rule)), { rule: working.rule.id });
    this.working = this.workingFor(working.rule, name);
    this.render();
  }

  /// Deleting the active response activates the tab before it, or the next one when it was
  /// first. Deletes without asking and offers undo (principle 4).
  private removeResponse(asked: string) {
    this.save.flush();
    const working = this.working!;
    const id = working.rule.id;
    const name = this.resolveResponse(id, asked);
    if (name === undefined || Object.keys(working.rule.responses).length < 2) return;
    const shown = working.response;
    const order = this.orderedResponses(working.rule);
    const at = order.indexOf(name);
    const fallback = order[at - 1] ?? order[at + 1];
    const spec = structuredClone(working.rule.responses[name] ?? {});
    const wasActive = working.rule.active === name;
    const draft = this.deps.drafts.get(`${id}/${name}`);
    this.deps.drafts.clear(`${id}/${name}`);
    delete working.rule.responses[name];
    if (wasActive) working.rule.active = fallback;
    this.track(this.model.upsertRule(structuredClone(working.rule)), { quiet: true });
    const keepsShown = name !== shown;
    this.working = this.carryWorking(working, working.rule, keepsShown ? shown : working.rule.active, keepsShown);
    this.offerUndo(t("Deleted the response “{name}”", { name }), () =>
      this.restoreResponse(id, name, spec, wasActive, at, draft),
    );
    // The × or the tab that had focus is gone; the shown tab takes it.
    const tab = this.working.response;
    [...this.root.querySelectorAll<HTMLElement>(".ml-editor [data-response]")].find((el) => el.dataset.response === tab)?.focus();
  }

  /// A text field, since a number field's arrows step 200 to 199, with a menu of common codes
  /// beside it. WKWebView shows no datalist. A code still being typed (5 on the way to 503)
  /// is not saved; the hint on the same line says what fits instead.
  private statusField(
    working: Working,
    status: number | undefined,
    hasError: () => boolean,
    set: (status: number | undefined) => void,
  ): HTMLElement {
    const fitsHint = t("A code from 100 to 599");
    const hint = h("span", { class: "necto-caption", "data-status-hint": "" }, working.statusText !== undefined ? fitsHint : "");
    const input = h("input", {
      class: "necto-field",
      "data-field": "status",
      type: "text",
      inputmode: "numeric",
      ...PLAIN_TEXT,
      value: working.statusText ?? status ?? "",
      oninput: () => {
        const raw = (input as HTMLInputElement).value.trim();
        const code = Number(raw);
        // No status is fine only beside a network error: the engine needs one or the other.
        const fits = /^[1-5][0-9]{2}$/.test(raw) ? code >= 100 : raw === "" && hasError();
        working.statusText = fits ? undefined : (input as HTMLInputElement).value;
        hint.textContent = fits ? "" : fitsHint;
        if (fits) set(raw === "" ? undefined : code);
      },
    });
    const pick = h(
      "select",
      {
        "data-field": "status-pick",
        "aria-label": t("Common codes"),
        onchange: () => {
          const code = Number((pick as HTMLSelectElement).value);
          (pick as HTMLSelectElement).value = "";
          if (!code) return;
          (input as HTMLInputElement).value = String(code);
          working.statusText = undefined;
          hint.textContent = "";
          set(code);
        },
      },
      h("option", { value: "" }, t("Common codes")),
      ...statusCodes.map(([code, reason]) => h("option", { value: String(code) }, `${code} ${reason}`)),
    );
    return h("div", { class: "ml-status-field" }, input, pick, hint);
  }

  /// Renames the shown response, keeping its place among the tabs and whether the app gets
  /// it. An empty name or one in use is refused and kept as typed with the reason.
  private renameResponse(typed: string) {
    const name = typed.trim();
    const current = this.working;
    if (!current) return;
    if (name === current.response) {
      current.nameText = undefined;
      current.nameProblem = undefined;
      this.render();
      return;
    }
    const refuse = (problem: string) => {
      current.nameText = typed;
      current.nameProblem = problem;
      this.render();
    };
    if (!name) return refuse(t("Enter a name"));
    if (Object.hasOwn(current.rule.responses, name)) return refuse(t("A response with this name already exists"));
    this.save.flush();
    const working = this.working!;
    const rule = working.rule;
    const old = working.response;
    const order = this.orderedResponses(rule).map((n) => (n === old ? name : n));
    rule.responses = Object.fromEntries(
      Object.entries(rule.responses).map(([key, spec]) => [key === old ? name : key, spec]),
    );
    if (rule.active === old) rule.active = name;
    this.responseOrders.set(rule.id, order);
    this.orderedResponses(rule);
    const draft = this.deps.drafts.get(`${rule.id}/${old}`);
    if (draft) {
      this.deps.drafts.clear(`${rule.id}/${old}`);
      this.deps.drafts.set(`${rule.id}/${name}`, draft);
    }
    this.renames.set(`${rule.id}\u0000${old}`, name);
    this.track(this.model.upsertRule(structuredClone(rule)), { rule: rule.id });
    this.working = this.carryWorking(working, rule, name, true);
    this.render();
  }

  /// Puts a deleted response back onto the rule as it is now, including later changes.
  /// Nothing is overwritten if the rule is gone or the name has been reused.
  private restoreResponse(
    id: string,
    name: string,
    spec: ResponseSpec,
    wasActive: boolean,
    at: number,
    draft: Draft | undefined,
  ) {
    this.save.flush();
    const current = this.latestRule(id);
    if (!current) {
      this.flash(t("Couldn't undo: the rule was deleted"), 4000, "undo-failed");
      return;
    }
    if (Object.hasOwn(current.responses, name)) {
      this.flash(t("Couldn't undo: a response named “{name}” already exists", { name }), 4000, "undo-failed");
      return;
    }
    const rule = structuredClone(current);
    rule.responses[name] = spec;
    if (wasActive) rule.active = name;
    const order = [...(this.responseOrders.get(id) ?? this.storedOrder(`responses.${id}`))].filter(
      (n) => n !== name,
    );
    order.splice(Math.min(at, order.length), 0, name);
    this.responseOrders.set(id, order);
    this.orderedResponses(rule);
    if (draft) this.deps.drafts.set(`${id}/${name}`, draft);
    if (this.working?.rule.id === id)
      this.working = this.workingFor(rule, wasActive ? name : this.working.response);
    this.track(this.model.upsertRule(structuredClone(rule)), { quiet: true });
    this.render();
  }

  /// Deletes without asking and offers undo (principle 4), except for an auth rule while a
  /// mocked session may remain: the next request could carry the mocked token to the real
  /// server the moment the rule is gone, and undo cannot recall a request already sent. The
  /// same reason applies to turning an auth rule off.
  private deleteRule(rule: Rule) {
    this.askFirst(
      this.guardsSession(rule),
      t(
        "Log out in the app before you delete the auth rule “{rule}”. If a mocked token reaches the real server, a 401 can force a logout.",
        { rule: ruleName(rule) },
      ),
      t("Delete"),
      () => this.removeRule(rule),
    );
  }

  private removeRule(rule: Rule) {
    this.awaitingPath.delete(rule.id);
    const working = this.working?.rule.id === rule.id ? this.working : undefined;
    const snapshot = structuredClone(working ? working.rule : rule);
    const drafts = new Map<string, Draft>();
    for (const name of Object.keys(snapshot.responses)) {
      const draft = this.deps.drafts.get(`${rule.id}/${name}`);
      if (draft) drafts.set(name, draft);
    }
    // An unsent edit is not sent, since the rule is about to go; it is folded into what undo
    // restores, or kept as a draft when its JSON does not parse.
    if (working && this.save.pending()) {
      try {
        snapshot.responses[working.response] = this.composeSpec(working);
      } catch {
        drafts.set(working.response, {
          headersText: working.headersText,
          bodyText: working.bodyText,
        });
      }
    }
    this.save.cancel();
    const ids = this.ruleIds(this.effectiveRules());
    const before = ids.slice(0, ids.indexOf(rule.id));
    for (const name of Object.keys(snapshot.responses))
      this.deps.drafts.clear(`${rule.id}/${name}`);
    this.pendingWrites.delete(rule.id);
    this.createdIds.delete(rule.id);
    if (this.captureNotice?.id === rule.id) this.dropCapture(false);
    this.selected = undefined;
    this.working = undefined;
    // An undo before the delete's echo still finds the rule in the received state. Keep the
    // delete's revision so that is not mistaken for the rule coming back.
    const gone: { launch: string; revision?: number } = { launch: this.model.state!.launchID };
    void this.model.deleteRule(rule.id).then((result) => {
      if (result.ok) gone.revision = result.revision;
    });
    this.offerUndo(t("Deleted the rule {rule}", { rule: ruleName(snapshot) }), () =>
      this.restoreRule(snapshot, drafts, before, gone),
    );
    (this.root.querySelector(".ml-rule-list") as HTMLElement | null)?.focus();
  }

  /// Restores the rule with the same id, responses and enabled state, placed after the rule
  /// that preceded it. The position is computed from the list at write time, so the order
  /// sent still names every id once even if rules were added or reordered elsewhere in the
  /// meantime. A rule that has reappeared under the same id is not overwritten.
  private restoreRule(
    snapshot: Rule,
    drafts: Map<string, Draft>,
    before: string[],
    gone: { launch: string; revision?: number },
  ) {
    const state = this.model.state!;
    const echoed =
      state.launchID !== gone.launch ||
      (gone.revision !== undefined && state.revision >= gone.revision);
    if (echoed && this.ruleIds(this.effectiveRules()).includes(snapshot.id)) {
      this.flash(t("Couldn't undo: the rule {rule} is back", { rule: ruleName(snapshot) }), 4000, "undo-failed");
      return;
    }
    for (const [name, draft] of drafts) this.deps.drafts.set(`${snapshot.id}/${name}`, draft);
    this.createdIds.add(snapshot.id);
    const write = this.model.upsertRule(structuredClone(snapshot));
    this.track(write, {
      quiet: true,
      after: (result) => {
        if (!result.ok) return;
        const ids = this.ruleIds(this.effectiveRules()).filter((id) => id !== snapshot.id);
        const after = [...before].reverse().find((id) => ids.includes(id));
        const order = [...ids];
        order.splice(after === undefined ? 0 : order.indexOf(after) + 1, 0, snapshot.id);
        // The engine appends new rules, so there is nothing to send when last is right.
        if (order.at(-1) !== snapshot.id) void this.model.reorder(order);
      },
    });
    this.revealRule = true;
    this.select(snapshot.id, snapshot);
  }

  /// The engine's reorder write needs every entry with an id exactly once, unsupported rules
  /// included.
  private ruleIds(rules: Configuration["rules"]): string[] {
    return rules.map((r) => r.id).filter((id): id is string => typeof id === "string");
  }

  /// The undo notice has no timeout: Necto takes ⌘Z, so this button is the only way back.
  /// It ends on ×, on the next deletion, or when the user changes something else
  /// (`endUndo`).
  private offerUndo(text: string, restore: () => void) {
    this.undo = { text, restore };
    this.render();
  }

  private runUndo() {
    const undo = this.undo;
    this.undo = undefined;
    if (undo) undo.restore();
    else this.render();
  }

  /// Any other change ends undo, since undoing afterwards would tangle with that change.
  /// Called before every write the panel sends.
  private endUndo(redraw = true) {
    if (!this.undo) return;
    this.undo = undefined;
    if (redraw) this.render();
  }

  /// Reads the edited headers and body into a response, throwing when invalid. Straightened
  /// quotes are written back to the edit too.
  private composeSpec(working: Working): ResponseSpec {
    const spec: ResponseSpec = { ...(working.rule.responses[working.response] ?? {}) };
    const headers = this.readField(working.headersText || "{}", (text) => {
      if (working.headersText) working.headersText = text;
    });
    if (typeof headers !== "object" || headers === null || Array.isArray(headers))
      throw new Error(t('Headers must be an object like {"name": "value"}'));
    spec.headers = headers as Record<string, string>;
    if (Object.keys(spec.headers).length === 0) delete spec.headers;
    if (working.bodyKind === "json") {
      // Sent as the text typed, not as a parsed value: the engine and Necto carry JSON objects
      // in dictionaries, so a parsed value would come back with its keys in another order.
      delete spec.json;
      if (working.bodyText.trim()) {
        this.readField(working.bodyText, (text) => {
          working.bodyText = text;
        });
        spec.body = working.bodyText;
      } else {
        spec.body = "{}";
      }
      // The engine gives a text body no content type, so the JSON one it used to add is sent
      // in the headers. The headers box is left as typed, since rewriting it would redraw the
      // field being typed in; it shows the header the next time the rule opens.
      if (
        working.addsJSONType &&
        !Object.keys(spec.headers ?? {}).some((name) => name.toLowerCase() === "content-type")
      )
        spec.headers = { ...spec.headers, "Content-Type": "application/json" };
    } else {
      delete spec.json;
      spec.body = working.bodyText;
    }
    return spec;
  }

  /// Validates the headers and body as typed and sends the whole selected rule. When invalid
  /// or rejected, the input stays as it is and is kept as a draft.
  private commit() {
    const working = this.working;
    if (!working) return;
    const key = `${working.rule.id}/${working.response}`;
    const keep = () =>
      this.deps.drafts.set(key, { headersText: working.headersText, bodyText: working.bodyText });
    const query = readQuery(working.queryRows);
    if (!query.ok) {
      working.queryProblems = query.problems;
      working.held = true;
      this.render();
      return;
    }
    working.queryProblems = undefined;
    // Empty conditions are omitted, as the engine omits them on export
    // (`ConfigurationCodec.encodeRule`), so the echo matches.
    if (Object.keys(query.query).length > 0) working.rule.match.query = query.query;
    else delete working.rule.match.query;
    let spec: ResponseSpec;
    try {
      spec = this.composeSpec(working);
    } catch (error) {
      working.error = t("Couldn't read the JSON: {message}", { message: (error as Error).message });
      working.held = true;
      keep();
      this.render();
      return;
    }
    working.error = undefined;
    working.rule.responses[working.response] = spec;
    this.changedAt.set(working.rule.id, Date.now());
    this.track(this.model.upsertRule(structuredClone(working.rule)), {
      rule: working.rule.id,
      after: (result) => {
        if (result.ok) {
          this.deps.drafts.clear(key);
          this.paintLatest();
        } else {
          working.held = true;
          keep();
        }
      },
    });
  }

  /// A write from the editor. The edit is kept until the state reaches the resulting
  /// revision (`syncWorking`). The saved indicator shows once when a run of saves has
  /// finished, not on every keystroke.
  private track(
    write: Promise<WriteResult>,
    {
      rule,
      after,
      quiet = false,
    }: { rule?: string; after?: (result: WriteResult) => void; quiet?: boolean } = {},
  ) {
    // The caller renders after it finishes updating the edit; rendering here would draw a
    // half-updated editor.
    this.endUndo(false);
    this.writing += 1;
    void write.then((result) => {
      this.writing -= 1;
      if (result.ok) this.awaitRevision = Math.max(this.awaitRevision, result.revision);
      after?.(result);
      // A delete or undo reports through its undo notice; no saved indicator on top.
      if (result.ok && !quiet && this.writing === 0 && !this.save.pending()) this.showSaved(rule);
      this.render();
    });
  }

  /// When quotes were straightened to parse, the edit takes the straightened text. The length
  /// is unchanged, so the caret stays put.
  private readField(text: string, straighten: (text: string) => void): unknown {
    const read = readJSON(text);
    if (!read.ok) throw new Error(read.message);
    if (read.text !== text) straighten(read.text);
    return read.value;
  }

  // -- from traffic -----------------------------------------------------------

  /// Turns a real response into a rule. It is added to the rule the engine would pick (or the
  /// disabled rule named by `into`), or a new rule is made when there is none. If the editor
  /// holds that rule, the capture merges into the edit, so a held edit blocking remote
  /// updates cannot wipe it out. Turning an auth rule on asks first, as `enableFromTraffic`.
  captureInto(
    entry: TrafficEntry,
    detail: NetworkDetail,
    path: string,
    into?: string,
    query?: Record<string, string>,
    turnOn = false,
  ) {
    if (!this.model.state) return;
    const target = turnOn && into !== undefined ? this.latestRule(into) : undefined;
    this.askFirst(
      target !== undefined && target.enabled === false && this.isAuthRule(target),
      target ? turnOnAuthText(target) : "",
      t("Turn on"),
      () => this.addCapture(entry, detail, path, into, query, turnOn),
    );
  }

  private addCapture(
    entry: TrafficEntry,
    detail: NetworkDetail,
    path: string,
    into: string | undefined,
    query: Record<string, string> | undefined,
    turnOn: boolean,
  ) {
    if (!this.model.state) return;
    this.save.flush();
    const rules = this.effectiveRules();
    const captured = captureResponse(detail);
    const omitted = captured.omitted.length
      ? ` · ${t("Server headers not copied into the mock: {count}", { count: captured.omitted.length })}`
      : "";
    const target =
      into !== undefined
        ? rules.filter(isRule).find((r) => r.id === into)
        : planCapture(entry, detail, rules).target;
    if (target) {
      const base = this.working?.rule.id === target.id ? this.working.rule : target;
      const added = addCapturedResponse(base, captured);
      const { name } = added;
      const rule = turnOn ? { ...added.rule, active: name, enabled: true } : added.rule;
      if (this.working?.rule.id === rule.id) this.working.rule = rule;
      this.saveFromTraffic(
        rule,
        turnOn
          ? {
              text:
                t("Added a response to the rule {rule} and turned it on — {when}", {
                  rule: ruleName(rule),
                  when: this.whenApplied(entry.host),
                }) + omitted,
              id: rule.id,
              response: name,
            }
          : { text: t("Added a response to the rule {rule}", { rule: ruleName(rule) }) + omitted, id: rule.id, name, response: name },
        { key: entry.key, response: name, host: entry.host },
      );
    } else {
      const rule = newRuleFromCapture(this.knownIds(), entry, path, captured, query);
      this.createdIds.add(rule.id);
      this.follow(rule, entry);
      this.saveFromTraffic(
        rule,
        {
          text: t("Created a mock for {rule} — {when}", { rule: ruleName(rule), when: this.whenApplied(entry.host) }) + omitted,
          id: rule.id,
          seed: rule,
        },
        { key: entry.key, response: rule.active, host: entry.host },
      );
    }
    this.allowHost(entry.host);
  }

  /// With no real response to carry over (no network plugin, blocked, no Necto record, or
  /// the record expired), makes a rule with an empty 200 from the request's shape alone.
  emptyRuleFrom(entry: TrafficEntry, path: string, query?: Record<string, string>) {
    if (!this.model.state) return;
    const event: RequestEvent = {
      seq: 0,
      query: query ?? {},
      date: entry.startedAt,
      method: entry.method,
      host: entry.host,
      path,
      outcome: { passthrough: {} },
    };
    const rule = ruleFromRequest(event, this.knownIds(), query !== undefined);
    this.createdIds.add(rule.id);
    this.follow(rule, entry);
    this.saveFromTraffic(
      rule,
      {
        text: t("Created a mock for {rule} (empty 200 response) — {when}", {
          rule: ruleName(rule),
          when: this.whenApplied(entry.host),
        }),
        id: rule.id,
        seed: rule,
      },
      { key: entry.key, response: rule.active, host: entry.host },
    );
    this.allowHost(entry.host);
  }

  /// A rule for this request's query alone, made from the rule that answered it for every
  /// query. Its tags come along, so an auth rule's copy is still treated as one.
  ruleForQueryFrom(entry: TrafficEntry, from: string) {
    if (!this.model.state) return;
    this.save.flush();
    const source = this.effectiveRules().filter(isRule).find((r) => r.id === from);
    const response = source?.responses[source.active];
    if (!source || !response) return;
    const match = { ...source.match, query: { ...entry.query } };
    // Asked twice before the echo, the second would only make a copy the first always wins over.
    const same = (r: Rule) =>
      r.match.method === match.method &&
      r.match.host === match.host &&
      r.match.path === match.path &&
      JSON.stringify(Object.entries(r.match.query ?? {}).sort()) === JSON.stringify(Object.entries(match.query).sort());
    if (this.effectiveRules().filter(isRule).some(same)) return;
    const base = newRule(this.knownIds(), match);
    const rule: Rule = {
      ...base,
      tags: [...(source.tags ?? [])],
      active: source.active,
      responses: { [source.active]: structuredClone(response) },
    };
    this.createdIds.add(rule.id);
    this.follow(rule, entry);
    this.saveFromTraffic(
      rule,
      {
        text: t("Created a mock for {rule} — {when}", { rule: ruleName(rule), when: this.whenApplied(entry.host) }),
        id: rule.id,
        seed: rule,
      },
      { key: entry.key, response: rule.active, host: entry.host },
    );
  }

  /// Requests already listed when the rule was made are not counted, even ones newer than
  /// the request it was made from.
  /// The newest request the rule is meant for: one it fits, query conditions included, on
  /// an allowed host when the rule names none, as the engine applies it.
  private latestFor(rule: Rule): TrafficEntry | undefined {
    const allowed = this.model.state?.configuration.allowedHosts ?? [];
    const key = `${this.trafficVersion}|${JSON.stringify(rule.match)}|${allowed.join(",")}`;
    if (this.latestMemo?.key === key) return this.latestMemo.entry;
    const entry = this.trafficStore
      .allEntries()
      .find(
        (e) =>
          (rule.match.host !== undefined || allowed.includes(e.host)) &&
          queryMisses(rule, e.method, requestURL(e))?.length === 0,
      );
    this.latestMemo = { key, entry };
    return entry;
  }

  /// The editor's line about that request, so a change is confirmed where it was made
  /// instead of on the traffic tab.
  private latestText(rule: Rule, entry: TrafficEntry | undefined): string {
    if (!entry) return t("No request for this rule yet — make one in the app");
    const answeredBy = entry.mockedBy?.rule;
    const other = this.effectiveRules().filter(isRule).find((r) => r.id === answeredBy);
    const result =
      entry.result === "mocked"
        ? answeredBy === rule.id
          ? t("mocked by this rule ({response})", { response: entry.mockedBy!.response })
          : t("answered by the rule {rule}", { rule: other ? ruleLabel(other) : (answeredBy ?? "") })
        : entry.result === "passthrough"
          ? t("went to the real server")
          : entry.result === "blocked"
            ? t("blocked by Map Local")
            : t("result unknown");
    const changed = this.changedAt.get(rule.id);
    const stale = changed !== undefined && entry.startedAt < changed;
    // To the second: the line is one line, and a glance needs only that.
    return [t("Latest request {time}", { time: formatClock(entry.startedAt).slice(0, 8) }), result]
      .concat(stale ? [t("from before the last change")] : [])
      .join(" · ");
  }

  private latestChildren(rule: Rule): Array<Node | string> {
    const entry = this.latestFor(rule);
    this.latestKey = entry?.key;
    const words = this.latestText(rule, entry);
    const text = h("span", { class: "ml-latest-text", "data-latest-text": "", title: words }, words);
    if (!entry) return [text];
    return [
      text,
      " ",
      h(
        "button",
        {
          class: "necto-button-quiet",
          "data-action": "show-latest",
          "data-field": "show-latest",
          onclick: () => {
            const key = this.latestKey;
            if (key === undefined) return;
            this.setTab("traffic");
            this.trafficView.reveal(key);
          },
        },
        t("Show in Traffic"),
      ),
    ];
  }

  /// Only the text changes as requests arrive, so the button keeps its node and focus, and a
  /// render never replaces the field being typed in.
  private paintLatest() {
    const line = this.root.querySelector(".ml-editor [data-latest]");
    if (!line || !this.working) return;
    const entry = this.latestFor(this.working.rule);
    const text = line.querySelector("[data-latest-text]");
    const button = line.querySelector('[data-action="show-latest"]');
    if (text && (button !== null) === (entry !== undefined)) {
      this.latestKey = entry?.key;
      const words = this.latestText(this.working.rule, entry);
      text.textContent = words;
      (text as HTMLElement).title = words;
    } else {
      line.replaceChildren(...this.latestChildren(this.working.rule));
    }
  }

  private follow(rule: Rule, entry: TrafficEntry) {
    if (Object.keys(rule.match.query ?? {}).length === 0) return;
    const newest = this.trafficStore.allEntries()[0]?.startedAt ?? 0;
    this.followed.set(rule.id, Math.max(entry.startedAt, newest));
  }

  /// A followed rule stops being followed once it answers a request. Noted as records
  /// arrive, so a relaunch or the store trimming its history doesn't bring it back.
  private noteAnswered() {
    if (this.followed.size === 0) return;
    for (const e of this.trafficStore.allEntries()) {
      const id = e.mockedBy?.rule;
      const since = id === undefined ? undefined : this.followed.get(id);
      if (since !== undefined && e.startedAt > since) this.followed.delete(id!);
    }
  }

  /// A followed rule that fits this later request but for its query. Not while another
  /// reason comes first (Map Local off, the host not allowed or blocked, the rule off).
  /// Removing a condition is offered only when the rule would then answer this request.
  unkeptFor(entry: TrafficEntry): Unkept | undefined {
    const configuration = this.model.state?.configuration;
    if (!configuration?.enabled || !configuration.allowedHosts.includes(entry.host) || this.isBlockedHost(entry.host))
      return undefined;
    const url = requestURL(entry);
    const rules = this.effectiveRules();
    // Of several followed rules on this path, the one closest to the request.
    let closest: { rule: Rule; misses: QueryMiss[] } | undefined;
    for (const [id, since] of this.followed) {
      if (entry.startedAt <= since || entry.mockedBy?.rule === id) continue;
      const rule = rules.filter(isRule).find((r) => r.id === id);
      if (!rule || rule.enabled === false) continue;
      const misses = queryMisses(rule, entry.method, url);
      if (!misses || misses.length === 0) continue;
      if (!closest || misses.length < closest.misses.length) closest = { rule, misses };
    }
    if (!closest) return undefined;
    const { rule, misses } = closest;
    const only = misses.length === 1 ? misses[0].key : undefined;
    const widened = only === undefined ? undefined : withoutCondition(rule, only);
    const answers =
      widened !== undefined &&
      pickRule(rules.map((r) => (isRule(r) && r.id === rule.id ? widened : r)), entry.method, url)?.id === rule.id;
    return answers ? { rule, misses, remove: only } : { rule, misses };
  }

  removeConditionFrom(id: string, key: string) {
    this.save.flush();
    const current = this.latestRule(id);
    if (!current?.match.query || !(key in current.match.query)) return;
    const rule = withoutCondition(current, key);
    this.askFirst(this.isAuthRule(rule), widenAuthText(rule, key), t("Remove the {key} condition", { key }), () => {
      if (this.working?.rule.id === id) this.working = this.workingFor(rule, this.working.response, this.working.queryRows);
      this.endUndo();
      this.track(this.model.upsertRule(rule), { rule: id });
      this.render();
    });
  }

  /// The received rules with traffic writes still awaiting their echo laid over them.
  private effectiveRules(): Configuration["rules"] {
    const state = this.model.state;
    if (!state) return [];
    for (const [id, pending] of this.pendingWrites) {
      if (
        pending.launch !== state.launchID ||
        (pending.revision !== undefined && state.revision >= pending.revision)
      )
        this.pendingWrites.delete(id);
    }
    const rules = state.configuration.rules;
    if (this.pendingWrites.size === 0) return rules;
    const merged = rules.map((r) => (isRule(r) && this.pendingWrites.get(r.id)?.rule) || r);
    for (const [id, pending] of this.pendingWrites)
      if (!rules.some((r) => isRule(r) && r.id === id)) merged.push(pending.rule);
    return merged;
  }

  /// A rejected write does not claim to have saved; `lastFailure` reports it instead.
  private saveFromTraffic(
    rule: Rule,
    notice: CaptureNotice,
    from: { key: string; response: string; host: string },
  ) {
    this.endUndo();
    const launch = this.model.state!.launchID;
    const pending: PendingWrite = { rule, launch };
    this.pendingWrites.set(rule.id, pending);
    void this.model.upsertRule(structuredClone(rule)).then((result) => {
      if (this.pendingWrites.get(rule.id) === pending) {
        if (result.ok) pending.revision = result.revision;
        else this.pendingWrites.delete(rule.id);
      }
      if (!result.ok) return;
      this.capturedFrom.set(from.key, {
        rule: rule.id,
        response: from.response,
        launch,
        host: from.host,
      });
      this.showCapture(notice);
      // With nothing selected on the rules tab, select the rule just made or extended, so
      // opening the tab shows it. An existing selection is never taken away.
      if (this.selected === undefined) {
        this.selected = rule.id;
        const latest = this.latestRule(rule.id) ?? rule;
        this.working = this.workingFor(latest, shown(latest, from.response));
        this.revealRule = true;
      }
      this.render();
    });
  }

  /// Whether the app's code blocked the host. The engine ignores such a host even when it is
  /// allowed, and mocks nothing for it.
  private isBlockedHost(host: string): boolean {
    const target = normalizeHost(host) ?? host;
    return (this.model.state?.blockedHosts ?? []).some((x) => (normalizeHost(x) ?? x) === target);
  }

  /// When a new mock takes effect. A blocked host is never told it will.
  private whenApplied(host: string): string {
    return this.isBlockedHost(host) ? blockedHostNote() : t("Applies from the next request");
  }

  /// A rule for a host that is not allowed would never match, and picking the request is
  /// consent enough to allow it.
  private allowHost(host: string) {
    const state = this.model.state;
    if (!state || state.configuration.allowedHosts.includes(host) || this.isBlockedHost(host))
      return;
    this.endUndo();
    void this.model.setAllowedHosts([...state.configuration.allowedHosts, host]);
  }

  /// Counts as done only while the rule still has that response, so deleting either makes
  /// it possible to capture again.
  private capturedDone(key: string): CaptureDone | undefined {
    // A capture made from our own record (`ours:N`) changes key once that request is paired
    // with a Necto record, so look under the old key too.
    const done =
      this.capturedFrom.get(key) ??
      [...this.capturedFrom].find(([k]) => k !== key && this.trafficStore.resolve(k) === key)?.[1];
    if (!done || done.launch !== this.model.state?.launchID) return undefined;
    const rule =
      this.working?.rule.id === done.rule
        ? this.working.rule
        : this.effectiveRules()
            .filter(isRule)
            .find((r) => r.id === done.rule);
    if (!rule || !Object.hasOwn(rule.responses, done.response)) return undefined;
    // A rule made from a blocked host's request never answers it.
    const blockedHost = this.isBlockedHost(done.host);
    return {
      rule: done.rule,
      response: done.response,
      applies:
        !blockedHost &&
        this.model.state?.configuration.enabled !== false &&
        rule.enabled !== false &&
        rule.active === done.response,
      blockedHost,
    };
  }

  openRule(id: string, seed?: Rule, response?: string) {
    this.tab = "rules";
    this.deps.prefs.set("panel.tab", "rules");
    const known = this.model.state?.configuration.rules.filter(isRule).find((r) => r.id === id);
    this.revealRule = true;
    this.select(id, known ? undefined : seed, response);
  }

  // -- import, export and dialogs ---------------------------------------------

  /// Pasting is the main path, so what the text would change shows as soon as it reads:
  /// importing replaces the whole configuration. A mistake shows only on Import, so text
  /// being typed by hand doesn't flash errors, and goes once the text changes.
  private openImport() {
    const message = h("div", { class: "ml-error" });
    const preview = h("div", { class: "necto-caption", "data-preview": "" });
    const area = h("textarea", {
      class: "necto-json-editor",
      "data-field": "dialog-text",
      rows: 14,
      ...PLAIN_TEXT,
      placeholder: t('Configuration JSON or {"force": true, "configuration": …}'),
      oninput: () => {
        message.textContent = "";
        const parsed = area.value.trim() ? parseImport(area.value) : undefined;
        preview.textContent =
          parsed && "configuration" in parsed
            ? t("Rules: {count} · allowed hosts: {hosts} · replaces the current configuration", {
                count: parsed.configuration.rules.length,
                hosts: parsed.configuration.allowedHosts.join(", ") || "—",
              })
            : "";
        const confirm = this.dialog?.querySelector<HTMLButtonElement>('[data-dialog="confirm"]');
        if (confirm) confirm.disabled = !area.value.trim();
      },
    }) as HTMLTextAreaElement;
    this.showDialog(t("Paste configuration"), [area, preview, message], t("Import"), () => {
      if (!area.value.trim()) return false;
      const parsed = parseImport(area.value);
      if ("error" in parsed) {
        message.textContent = parsed.error;
        return false;
      }
      const count = parsed.configuration.rules.length;
      this.endUndo();
      this.awaitingPath.clear();
      void this.model.importConfiguration(parsed.configuration).then((result) => {
        if (result.ok) this.flash(t("Imported rules: {count}", { count }));
      });
      return true;
    });
    const confirm = this.dialog?.querySelector<HTMLButtonElement>('[data-dialog="confirm"]');
    if (confirm) confirm.disabled = true;
  }

  private async export() {
    let configuration: Configuration;
    try {
      configuration = await this.deps.api.exportConfiguration();
    } catch (error) {
      this.notice = t("Couldn't export: {message}", {
        message: error instanceof Error ? error.message : String(error),
      });
      this.render();
      return;
    }
    this.notice = undefined;
    const text = exportText(configuration);
    const warning = secretWarning(configuration);
    const copied = () =>
      warning
        ? this.flash(t("Copied the configuration — {warning}", { warning }), 8000, "warning")
        : this.flash(t("Copied the configuration"));
    if (await this.deps.copy(text)) {
      copied();
      return;
    }
    const area = h("textarea", {
      class: "necto-json-editor",
      "data-field": "dialog-text",
      rows: 14,
      readonly: true,
      value: text,
    }) as HTMLTextAreaElement;
    const message = h("div", { class: "ml-error" });
    const hint = h(
      "div",
      { class: "necto-caption" },
      t("The text is selected. You can also copy it with ⌘C"),
    );
    const caution = warning
      ? [
          h(
            "div",
            { class: "necto-caption ml-export-warning", "data-export-warning": true },
            warning,
          ),
        ]
      : [];
    this.showDialog(
      t("Export configuration"),
      [area, hint, ...caution, message],
      t("Copy"),
      () => {
        if (this.deps.copyField(area)) {
          copied();
          return true;
        }
        message.textContent = t("This window blocks the copy button. Keep the text selected and press ⌘C");
        area.select();
        return false;
      },
      t("Close"),
    );
    area.select();
  }

  /// A guarding confirmation, for turning off or deleting an auth rule. Cancel is the default
  /// button, so a single Return never does the risky thing (as the HIG advises).
  private confirm(text: string, action: string, onConfirm: () => void) {
    this.showDialog(
      t("Confirm"),
      [h("p", {}, text)],
      action,
      () => {
        onConfirm();
        return true;
      },
      t("Cancel"),
      true,
    );
  }

  /// Shows the saved indicator beside the editor's title when the editor is visible, and in
  /// the floating layer otherwise, as when the active response changes from traffic. The
  /// editor shows it only for the rule that was saved. Only the text is changed: a render
  /// would replace the field being typed in and lose its undo history and caret.
  private showSaved(rule: string | undefined) {
    if (this.tab !== "rules" || !this.working) {
      this.flash(t("Saved"), 2000);
      return;
    }
    if (rule !== undefined && this.working.rule.id !== rule) return;
    clearTimeout(this.savedTimer);
    this.saved = true;
    this.paintSaved();
    this.savedTimer = setTimeout(() => {
      this.saved = false;
      this.paintSaved();
    }, 2000);
  }

  private paintSaved() {
    const badge = this.root.querySelector(".ml-saved");
    if (badge) badge.textContent = this.saved ? t("Saved") : "";
  }

  /// A brief success notice, confirming actions with no other result to show, such as
  /// import and copy.
  private flash(text: string, ms = 4000, kind = "success") {
    clearTimeout(this.successTimer);
    this.success = text;
    this.successKind = kind;
    this.successTimer = setTimeout(() => {
      this.success = undefined;
      this.render();
    }, ms);
    this.render();
  }

  /// Usable from the keyboard alone. Opening focuses the text box if there is one, otherwise
  /// Cancel. Escape cancels, Return presses the default button (and is a newline inside a
  /// text box), and Tab cycles within the dialog. The default button is the confirm button,
  /// except in a guarding confirmation, where it is Cancel and confirming takes Tab and then
  /// Return or a click. The lists behind take no keys (`rulesKey`, `listKey`, `undoKey`).
  /// Closing returns focus where it was on opening, or to the list.
  private showDialog(
    title: string,
    body: HTMLElement[],
    action: string,
    onConfirm: () => boolean,
    cancel = t("Cancel"),
    guard = false,
  ) {
    const opener = captureFocus(this.root);
    const close = () => {
      this.dialog = undefined;
      this.render();
      if (!restoreFocus(this.root, opener)) this.currentList()?.focus();
    };
    const confirm = () => {
      if (onConfirm()) close();
    };
    const cancelButton = h(
      "button",
      {
        class: guard ? "necto-button necto-button-primary" : "necto-button",
        "data-dialog": "cancel",
        "data-field": "dialog-cancel",
        onclick: close,
      },
      cancel,
    );
    const confirmButton = h(
      "button",
      {
        class: guard ? "necto-button necto-button-danger" : "necto-button necto-button-primary",
        "data-dialog": "confirm",
        "data-field": "dialog-confirm",
        onclick: confirm,
      },
      action,
    );
    const box = h(
      "div",
      {
        class: "necto-dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": title,
        onkeydown: (e) => {
          const ev = e as KeyboardEvent;
          if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
          if (ev.key === "Escape") {
            ev.preventDefault();
            close();
            return;
          }
          if (ev.key === "Enter" && !ev.shiftKey && !(ev.target instanceof HTMLTextAreaElement)) {
            ev.preventDefault();
            if (!guard || ev.target === confirmButton) confirm();
            else close();
            return;
          }
          if (ev.key !== "Tab") return;
          ev.preventDefault();
          const items = (
            [...box.querySelectorAll("textarea, input, select, button")] as HTMLButtonElement[]
          ).filter((el) => !el.disabled);
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            ev.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length
          ]?.focus();
        },
      },
      h("div", { class: "necto-dialog-head" }, h("div", { class: "necto-dialog-title" }, title)),
      h("div", { class: "necto-dialog-body" }, ...body),
      h("div", { class: "necto-dialog-actions" }, cancelButton, confirmButton),
    );
    this.dialog = h("div", { class: "necto-dialog-scrim" }, box);
    this.render();
    (box.querySelector<HTMLElement>("textarea") ?? cancelButton).focus();
  }

  private currentList(): HTMLElement | null {
    return this.root.querySelector(this.tab === "rules" ? ".ml-rule-list" : ".ml-traffic-list");
  }
}
