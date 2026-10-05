//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "../localization";
import { h } from "../dom";
import { isRule, queryLabel, ruleLabel } from "../rules";
import type { NetworkDetail, Rule, TrafficEntry } from "../types";
import { blockReason, captureResponse, planCapture, requestURL } from "./capture";
import { endpointTemplate, groupKey } from "./keys";
import { pathMatches, pickRule } from "./match";
import type { CaptureDone, TrafficDeps, Unkept } from "./view";
import { whyNotMocked, type Why } from "./why";

const previewLimit = 5;

export const blockedHostNote = () => t("The app code blocks this host, so it isn't mocked");

/// Marks the detail pane's single primary action. ⌘↩ presses it and Return moves focus to it
/// (view.ts); the CSS appends the shortcut after the label.
const primary = { "data-primary": true, "data-shortcut": "⌘↩", "aria-keyshortcuts": "Meta+Enter" } as const;

export interface CaptureContext {
  entry: TrafficEntry;
  detail: NetworkDetail | "error" | undefined;
  deps: TrafficDeps;
  /// The path chosen for the new rule.
  path: string;
  choosePath(path: string): void;
  /// Whether the new rule takes this request's query as conditions.
  queryOnly: boolean;
  chooseQueryOnly(on: boolean): void;
}

/// The capture area below the detail. It captures the request and detail exactly as shown.
export function captureArea({
  entry,
  detail,
  deps,
  path,
  choosePath,
  queryOnly,
  chooseQueryOnly,
}: CaptureContext): HTMLElement {
  const loaded = detail === "error" ? undefined : detail;
  const plan = planCapture(entry, loaded, deps.rules());
  const blockedHost = deps.isBlockedHost(entry.host);
  // A response marked as ours is a mock even when the row could not tell.
  const seen = plan.blockedBy === "mocked" ? { ...entry, result: "mocked" as const } : entry;
  const done = deps.captured(entry.key);
  const found = whyNotMocked(seen, {
    rules: deps.rules(),
    enabled: deps.mapLocalEnabled(),
    allowedHosts: deps.allowedHosts(),
    isBlockedHost: (host) => deps.isBlockedHost(host),
  });
  // After a capture, the done line already says when the mock applies.
  const why = done && found?.kind === "nowApplies" ? undefined : found;
  // A blocked host cannot be allowed, since the engine ignores it. Say why instead of
  // offering a button that does nothing. The reason line says both when it is shown.
  // A blocked host cannot be allowed, since the engine ignores it; say so instead. A
  // reason line about the host carries its own words and fix.
  const hostReason = why?.kind === "blockedHost" || why?.kind === "hostNotAllowed";
  const allow =
    !hostReason && blockedHost && h("div", { class: "necto-caption", "data-host-blocked": true }, blockedHostNote());
  // Mocking allows the host too, so there is no separate step to take first: said right
  // under the mock buttons.
  const hostNote =
    !hostReason &&
    !blockedHost &&
    !deps.allowedHosts().includes(entry.host) &&
    h("div", { class: "necto-caption", "data-host-note": "" }, t("Mocking also adds {host} to the allowed hosts", { host: entry.host }));
  // Only a rule that is off matches and there is no response to carry over: capturing can
  // only make an empty rule beside it, which the engine would never pick once that rule is
  // on. The primary action fixes the next cause instead (the reason line's button), or
  // opens the rule when nothing in the panel can fix it.
  const loading = entry.networkID !== undefined && detail === undefined;
  const noResponse =
    !deps.networkAvailable() ||
    (plan.blockedBy !== undefined &&
      plan.blockedBy !== "mocked" &&
      plan.blockedBy !== "pending" &&
      !loading);
  const offOnly = !done && plan.disabledMatch !== undefined && noResponse ? plan.disabledMatch : undefined;
  const fixable = why !== undefined && why.kind !== "blockedHost" && why.kind !== "nowApplies" && why.kind !== "shadowed";
  // A rule made from traffic said it would answer from the next request and didn't. Said
  // beside the other actions, which stay: the request may be one the rule was never meant for.
  const unkept = why ? undefined : deps.unkept(entry);
  const reason = why ? whyLine(why, deps, offOnly !== undefined && fixable) : unkept && unkeptLine(unkept, deps);
  const area = (...children: Array<Node | false | undefined>) =>
    h("div", { class: "ml-capture" }, reason, ...children, allow);

  const openRule = (id: string, title: string, response?: string) =>
    h(
      "button",
      {
        class: "necto-button",
        "data-action": "open-rule",
        "data-field": "detail-open-rule",
        ...primary,
        title,
        onclick: () => (response === undefined ? deps.openRule(id) : deps.openRule(id, response)),
      },
      t("Open rule"),
    );
  const mockedRule = plan.blockedBy === "mocked" ? entry.mockedBy?.rule : undefined;
  if (mockedRule) {
    // Until the next request this one still shows the rule that answered it, so a rule
    // made for its query is announced here.
    if (done && done.rule !== mockedRule)
      return area(doneState(done, deps), openRule(done.rule, t("Edit the response in the rule"), done.response));
    // Only while that rule would still answer this request: one turned off or changed since
    // must not be copied back on, an auth rule least of all.
    const answering = pickRule(deps.rules(), entry.method, requestURL(entry));
    const checked = answering?.match.query ?? {};
    const forQuery =
      answering?.id === mockedRule &&
      Object.keys(entry.query).some((key) => !(key in checked)) &&
      h(
        "button",
        {
          class: "necto-button",
          "data-action": "rule-for-query",
          "data-field": "detail-rule-for-query",
          title: t("Makes a rule that answers only this query, starting with the response the app gets now"),
          onclick: () => deps.ruleForQuery(entry, mockedRule),
        },
        t("Rule for this query only ({query})", { query: queryLabel(entry.query).slice(1) }),
      );
    return area(openRule(mockedRule, blockReason("mocked"), entry.mockedBy?.response), forQuery);
  }
  // Once this request has been captured, the primary action opens the rule, so pressing ⌘↩
  // again cannot quietly add the same response twice.
  if (done?.blockedHost)
    return h(
      "div",
      { class: "ml-capture" },
      doneState(done, deps),
      openRule(done.rule, t("Edit the response in the rule"), done.response),
    );
  if (done) return area(doneState(done, deps), openRule(done.rule, t("Edit the response in the rule"), done.response));
  // Only offered for a new rule. A matching rule gets the response added, and has no place
  // for conditions.
  const hasQuery = Object.keys(entry.query).length > 0;
  const query = !plan.target && hasQuery && queryOnly ? { ...entry.query } : undefined;
  const picker = !plan.target && pathPicker(entry, deps, path, choosePath);
  const queryBox =
    !plan.target &&
    hasQuery &&
    h(
      "label",
      {
        class: "necto-caption ml-capture-query",
        title: t("Leave this off to answer every request on this path, whatever the query"),
      },
      h("input", {
        type: "checkbox",
        "data-field": "capture-query",
        checked: queryOnly,
        onchange: (e) => chooseQueryOnly((e.target as HTMLInputElement).checked),
      }),
      t("Only with this query ({query})", { query: queryLabel(entry.query).slice(1) }),
    );
  const emptyRule = (main: boolean) =>
    h(
      "button",
      {
        class: "necto-button",
        "data-action": "empty-rule",
        "data-field": "detail-empty-rule",
        ...(main ? primary : {}),
        title: t("Makes an empty 200 JSON without a response"),
        onclick: () => (query ? deps.emptyRule(entry, path, query) : deps.emptyRule(entry, path)),
      },
      t("Mock with an empty response"),
    );
  // With a matching rule but no response to carry over, open that rule rather than make
  // another empty one, which the engine would never pick over it.
  const fallback = () =>
    plan.target ? openRule(plan.target.id, plan.hint ?? "") : emptyRule(true);
  if (offOnly) return area(fixable ? undefined : openRule(offOnly.id, t("Open rule")));
  if (!deps.networkAvailable()) return area(picker || undefined, queryBox || undefined, fallback(), hostNote);
  // Even without a response to capture, the request's shape must still make a rule; with
  // unmatched requests blocked, that is the main path. Not for mocked or pending requests,
  // or while the detail is still loading.
  const blocked = plan.blockedBy !== undefined;
  const off = plan.disabledMatch;
  const title = plan.blockedBy
    ? blockReason(plan.blockedBy)
    : off
      ? t("Adds it to the rule {rule}, makes it the response the app gets, and turns the rule on", { rule: ruleLabel(off) })
      : plan.hint;
  // When only a rule that is off matches, adding to it and turning it on is the main path;
  // a new rule would only duplicate it.
  const take = (into: string | undefined, turnOn: boolean) => () => {
    if (!loaded || blocked) return;
    if (into !== undefined) deps.capture(entry, loaded, path, into, undefined, turnOn);
    else if (query) deps.capture(entry, loaded, path, undefined, query);
    else deps.capture(entry, loaded, path, undefined);
  };
  return area(
    picker || undefined,
    queryBox || undefined,
    // With no response to capture, the empty-response mock is the primary action.
    h(
      "button",
      {
        class: "necto-button necto-button-primary",
        "data-action": "capture",
        "data-field": "detail-capture",
        ...(noResponse ? {} : primary),
        disabled: blocked,
        title,
        onclick: off ? take(off.id, true) : take(undefined, false),
      },
      off ? t("Add to that rule and turn it on") : plan.label,
    ),
    off &&
      h(
        "button",
        {
          class: "necto-button",
          "data-action": "capture-new",
          "data-field": "detail-capture-new",
          disabled: blocked,
          title: plan.blockedBy ? blockReason(plan.blockedBy) : undefined,
          onclick: take(undefined, false),
        },
        t("Make a new rule"),
      ),
    noResponse && fallback(),
    hostNote,
    loaded && !blocked && omittedNote(captureResponse(loaded).omitted),
  );
}

/// How many of the server's headers a mock from this response leaves out, named on hover.
function omittedNote(omitted: string[]): HTMLElement | undefined {
  if (omitted.length === 0) return undefined;
  return h(
    "div",
    { class: "necto-caption", "data-omitted": omitted.length, title: omitted.join(", ") },
    t("Server headers not copied: {count}", { count: omitted.length }),
  );
}

/// One line on why a request a rule matches was not mocked, with the one action that fixes
/// it when the panel can. That action is the primary one when capturing has nothing to offer.
const shownValueLength = 32;
const shown = (value: string) => (value.length > shownValueLength ? value.slice(0, shownValueLength) + "…" : value);

function unkeptLine({ rule, misses, remove }: Unkept, deps: TrafficDeps): HTMLElement {
  const expected = misses.map((m) => `${m.key}=${shown(m.expected)}`).join(", ");
  const actual = misses
    .map((m) => (m.actual === undefined ? t("no {key}", { key: m.key }) : `${m.key}=${shown(m.actual)}`))
    .join(", ");
  const fix =
    remove !== undefined &&
    h(
      "button",
      {
        class: "necto-button",
        "data-action": "remove-condition",
        "data-field": "detail-remove-condition",
        onclick: () => deps.removeCondition(rule.id, remove),
      },
      t("Remove the {key} condition", { key: remove }),
    );
  return h(
    "div",
    { class: "necto-notice ml-why", "data-reason": "unkept" },
    t("The rule {rule} didn't answer this request. Rule: {expected} · This request: {actual}", {
      rule: ruleLabel(rule),
      expected,
      actual,
    }),
    fix ? " " : "",
    fix,
  );
}

function whyLine(why: Why, deps: TrafficDeps, isPrimary: boolean): HTMLElement {
  const rule = ruleLabel(why.rule);
  const fix = (label: string, action: () => void) =>
    h(
      "button",
      {
        class: "necto-button",
        "data-action": "why-fix",
        "data-field": "detail-why-fix",
        ...(isPrimary ? primary : {}),
        onclick: action,
      },
      label,
    );
  const line = (...children: Array<Node | string | false>) =>
    h("div", { class: "necto-notice ml-why", "data-why": why.kind }, ...children);
  switch (why.kind) {
    case "off":
      return line(t("Map Local is off, so this wasn't mocked"), " ", fix(t("Turn on"), () => deps.enableMapLocal()));
    case "hostNotAllowed":
      return line(
        t("{host} isn't an allowed host, so the rule {rule} didn't apply", { host: why.host, rule }),
        " ",
        fix(t("Add to allowed hosts ({host})", { host: why.host }), () => deps.addAllowedHost(why.host)),
      );
    case "ruleOff":
      return line(t("The rule {rule} is off, so this wasn't mocked", { rule }), " ", fix(t("Turn on rule"), () => deps.enableRule(why.rule.id)));
    case "blockedHost":
      return line(t("The app code blocks this host, so the rule {rule} never mocks it and the request goes to the real server", { rule }));
    case "nowApplies":
      return line(t("The rule {rule} applies now — request again in the app", { rule }));
    case "shadowed":
      return line(
        t("The rule {rule} also matches, but {winner} takes precedence (more query conditions, or earlier in the list)", {
          rule,
          winner: ruleLabel(why.winner),
        }),
      );
  }
}

/// After capturing: whether the app gets the response from its next request, or it was only
/// added to the rule.
function doneState(done: CaptureDone, deps: TrafficDeps): HTMLElement {
  if (done.blockedHost)
    return h(
      "div",
      { class: "necto-caption", "data-capture-done": "blocked" },
      t("Saved to the rule — {note}", { note: blockedHostNote() }),
    );
  if (done.applies) return h("div", { class: "necto-caption", "data-capture-done": "applies" }, t("Mocking · applies from the next request"));
  const rule = deps.rules().find((r): r is Rule => isRule(r) && r.id === done.rule);
  const name = rule ? ruleLabel(rule) : "";
  if (!deps.mapLocalEnabled())
    return h(
      "div",
      { class: "necto-caption", "data-capture-done": "map-local-off" },
      t("Added to the rule {rule} — Map Local is off, so the app gets the real server's response", { rule: name }),
    );
  if (rule?.enabled === false)
    return h(
      "div",
      { class: "necto-caption", "data-capture-done": "off" },
      t("Added to the rule {rule} — the rule is off, so the app gets the real server's response", { rule: name }),
    );
  return h(
    "div",
    { class: "necto-caption", "data-capture-done": "added" },
    t("Added to the rule {rule} — the app still gets another response", { rule: name }),
    " ",
    h(
      "button",
      {
        class: "necto-button-quiet",
        "data-action": "activate-done",
        "data-field": "detail-activate-done",
        onclick: () => deps.activate(done.rule, done.response),
      },
      t("Send this response to the app"),
    ),
  );
}

function pathPicker(
  entry: TrafficEntry,
  deps: TrafficDeps,
  path: string,
  choosePath: (path: string) => void,
): HTMLElement {
  const template = endpointTemplate(entry.path);
  const options = template === entry.path ? [entry.path] : [entry.path, template];
  return h(
    "div",
    {},
    h(
      "label",
      { class: "necto-caption" },
      t("Rule path"),
      " ",
      h(
        "select",
        {
          "data-field": "capture-path",
          onchange: (e) => choosePath((e.target as HTMLSelectElement).value),
        },
        ...options.map((p) => h("option", { value: p, selected: p === path }, p)),
      ),
    ),
    path !== entry.path && preview(entry, deps, path),
  );
}

/// Previews which observed paths outside this group the template would also catch, such as
/// `/devices/{id}` catching `/devices/summary`.
function preview(entry: TrafficEntry, deps: TrafficDeps, template: string): HTMLElement | undefined {
  const own = groupKey(entry);
  const others = [
    ...new Set(
      deps.store
        .entries()
        .filter(
          (e) =>
            e.method === entry.method &&
            e.host === entry.host &&
            groupKey(e) !== own &&
            pathMatches(template, e.path),
        )
        .map((e) => e.path),
    ),
  ].slice(0, previewLimit);
  if (others.length === 0) return undefined;
  return h("div", { class: "necto-caption", "data-capture-preview": true }, t("This path also catches: {paths}", { paths: others.join(", ") }));
}
