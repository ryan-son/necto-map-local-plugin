//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { indentJSON } from "../json";
import { t } from "../localization";
import { newRule, ruleLabel, uniqueName } from "../rules";
import type { Configuration, NetworkDetail, ResponseSpec, Rule, TrafficEntry } from "../types";
import { matchingDisabledRule, pickRule } from "./match";

export type CaptureBlock = "blocked" | "mocked" | "failed" | "pending" | "truncated" | "noBody" | "noDetail";
export function blockReason(block: CaptureBlock): string {
  switch (block) {
    case "blocked": return t("Map Local blocked this request, so there is no real response");
    case "mocked": return t("This is already a Map Local response — edit it in the rule");
    case "failed": return t("The request failed without a response");
    case "pending": return t("Still waiting for the response");
    case "truncated": return t("The body was cut off past 512KB");
    case "noBody": return t("The body isn't text, so it can't be carried over");
    case "noDetail": return t("Couldn't fetch the response");
  }
}

/// The body arrives already decoded, and the engine sets length and transfer encoding
/// itself. Cookies and our own marker header are not carried over.
const dropped = new Set([
  "set-cookie",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "date",
  "x-map-local",
]);

/// Headers the server adds to every response, which the app does not act on and which only
/// crowd the editor: CORS, caching, browser security policies, the server name and request
/// ids. Content-Type and the app's own headers are kept.
const noise = new Set([
  "cache-control",
  "pragma",
  "expires",
  "x-frame-options",
  "x-content-type-options",
  "x-xss-protection",
  "strict-transport-security",
  "server",
]);
const isNoise = (name: string) =>
  noise.has(name) ||
  name.startsWith("access-control-") ||
  /^(x-)?(amzn-|amz-)?(message|request|correlation|trace)-?id$/.test(name);

/// Whether a captured response leaves this header out. Our marker is not the server's, so it
/// is not counted as left out.
const omits = (name: string) => name !== "x-map-local" && (dropped.has(name) || isNoise(name));

/// The request's URL as the engine saw it. Without a Necto record it is rebuilt from the
/// parts, with decoded query values encoded again so values containing & or = read back
/// unchanged.
export function requestURL(entry: TrafficEntry): string {
  const query = Object.entries(entry.query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return entry.url ?? `https://${entry.host}${entry.path}${query ? `?${query}` : ""}`;
}

export interface CapturePlan {
  blockedBy?: CaptureBlock;
  target?: Rule;
  disabledMatch?: Rule;
  label: string;
  hint?: string;
}

export function planCapture(
  entry: TrafficEntry,
  detail: NetworkDetail | undefined,
  rules: Configuration["rules"],
): CapturePlan {
  // Pick by query too, as the engine does, so a request with no Necto record still finds
  // rules with query conditions.
  const target = pickRule(rules, entry.method, requestURL(entry));
  // A matching rule gets the response added instead of a new mock, and the button says so.
  const plan: CapturePlan = {
    target,
    label: target ? t("Add this response to the rule") : t("Mock with this response"),
    hint: target && t("Adds it as a response to the rule {rule}", { rule: ruleLabel(target) }),
  };
  if (!target) plan.disabledMatch = matchingDisabledRule(rules, entry.method, requestURL(entry));
  if (entry.result === "blocked") return { ...plan, blockedBy: "blocked" };
  if (entry.result === "mocked") return { ...plan, blockedBy: "mocked" };
  if (entry.state === "failed" || detail?.state === "failed")
    return { ...plan, blockedBy: "failed" };
  if (!detail) return { ...plan, blockedBy: "noDetail" };
  const ours = Object.entries(detail.responseHeaders).find(
    ([k]) => k.toLowerCase() === "x-map-local",
  )?.[1];
  if (ours) return { ...plan, blockedBy: ours === "unmocked" ? "blocked" : "mocked" };
  if (entry.state === "pending" || detail.state !== "completed")
    return { ...plan, blockedBy: "pending" };
  if (detail.statusCode === undefined) return { ...plan, blockedBy: "noDetail" };
  const body = detail.responseBody;
  if (body?.isTruncated) return { ...plan, blockedBy: "truncated" };
  if (body && body.byteCount > 0 && body.text === undefined)
    return { ...plan, blockedBy: "noBody" };
  return plan;
}

export interface Captured {
  spec: ResponseSpec;
  /// The server's headers left out, by their names as sent.
  omitted: string[];
}

/// Values are carried over as they are, transport noise left out, and the body as the text
/// the server sent: a JSON body is not parsed and written again, so its numbers, key order
/// and repeated keys reach the editor and the app unchanged. One sent on a single line is
/// indented for editing, which changes only its whitespace. The editor opens a JSON body in
/// JSON mode.
export function captureResponse(detail: NetworkDetail): Captured {
  const spec: ResponseSpec = { status: detail.statusCode ?? 200 };
  const entries = Object.entries(detail.responseHeaders);
  const headers = Object.fromEntries(
    entries.filter(([k]) => !dropped.has(k.toLowerCase()) && !isNoise(k.toLowerCase())),
  );
  if (Object.keys(headers).length > 0) spec.headers = headers;
  spec.body = indentJSON(detail.responseBody?.text ?? "");
  return { spec, omitted: entries.map(([k]) => k).filter((k) => omits(k.toLowerCase())) };
}

/// Saved into the configuration, so it is named in the language the panel showed then.
const capturedName = () => t("Captured response");

export function addCapturedResponse(rule: Rule, captured: Captured): { rule: Rule; name: string } {
  const name = uniqueName(capturedName(), Object.keys(rule.responses));
  return { rule: { ...rule, responses: { ...rule.responses, [name]: captured.spec } }, name };
}

/// A `query`, passed when the user limits the rule to this query, becomes its conditions.
/// The default is no conditions, as before.
export function newRuleFromCapture(
  existingIds: string[],
  entry: TrafficEntry,
  path: string,
  captured: Captured,
  query?: Record<string, string>,
): Rule {
  const r = newRule(existingIds, {
    method: entry.method.toUpperCase(),
    host: entry.host,
    path,
    ...(query && Object.keys(query).length > 0 ? { query: { ...query } } : {}),
  });
  const name = capturedName();
  return { ...r, active: name, responses: { [name]: captured.spec } };
}
