//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { normalizeHost } from "../hosts";
import type { Configuration, Rule, TrafficEntry } from "../types";
import { requestURL } from "./capture";
import { matchingRules, matchingDisabledRule, pickRule } from "./match";

export interface WhyContext {
  rules: Configuration["rules"];
  enabled: boolean;
  allowedHosts: string[];
  isBlockedHost(host: string): boolean;
}

/// Why a request a rule matches was not mocked, by what stops it in the engine's order, so
/// fixing one shows the next. A mocked request only says which matching rule lost.
export type Why =
  | { kind: "blockedHost" | "off" | "ruleOff" | "nowApplies"; rule: Rule }
  | { kind: "hostNotAllowed"; rule: Rule; host: string }
  | { kind: "shadowed"; rule: Rule; winner: Rule };

/// Read from the configuration now, not when the request was made; `nowApplies` covers a
/// request made before the fix. A request with a host the engine can't read (an IPv6
/// literal) gets no reason: nothing in the panel can make it mocked.
export function whyNotMocked(entry: TrafficEntry, context: WhyContext): Why | undefined {
  const host = normalizeHost(entry.host);
  if (host === undefined) return undefined;
  const url = requestURL(entry);
  const on = pickRule(context.rules, entry.method, url);
  if (entry.result === "mocked") {
    // Shadowed only while the rule that answered would still win; otherwise the rule that
    // wins now is explained like any other.
    const winner = entry.mockedBy?.rule;
    if (!on) return undefined;
    if (on.id === winner) {
      const lost = matchingRules(context.rules, entry.method, url, true).find((r) => r.id !== winner);
      return lost ? { kind: "shadowed", rule: lost, winner: on } : undefined;
    }
  }
  const rule = on ?? matchingDisabledRule(context.rules, entry.method, url);
  if (!rule) return undefined;
  if (context.isBlockedHost(host)) return { kind: "blockedHost", rule };
  if (!context.enabled) return { kind: "off", rule };
  if (!context.allowedHosts.includes(host)) return { kind: "hostNotAllowed", rule, host };
  if (!on) return { kind: "ruleOff", rule };
  // An unknown result may have been a mock (a mocked error looks like any failure).
  if (entry.result === "unknown") return undefined;
  return { kind: "nowApplies", rule };
}
