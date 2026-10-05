//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { EngineMessage } from "./messages";

export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

export type MockError = "notConnectedToInternet" | "connectionLost" | "timedOut";

export interface ResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  json?: JSONValue;
  delayMs?: number;
  error?: MockError;
}

export interface Rule {
  id: string;
  enabled?: boolean;
  tags?: string[];
  match: { method: string; host?: string; path: string; query?: Record<string, string> };
  active: string;
  responses: Record<string, ResponseSpec>;
}

export type Unmatched =
  | { mode: "passthrough" }
  | { mode: "block"; status?: number }
  | { mode: "fail"; error?: MockError };

export interface Configuration {
  version: number;
  revision: number;
  enabled: boolean;
  allowedHosts: string[];
  unmatched: Unmatched;
  /// Rules this panel does not support arrive verbatim; `isRule` tells them apart.
  rules: Array<Rule | { [key: string]: JSONValue }>;
}

export interface EngineState {
  revision: number;
  configuration: Configuration;
  readOnly: boolean;
  issues: string[];
  /// The same issues with their codes. Older apps don't send it.
  issueDetails?: EngineMessage[];
  observedHosts: string[];
  blockedHosts: string[];
  authMocked: boolean;
  /// Changes on every launch of the app, where `revision` starts again from 0.
  launchID: string;
}

export type Outcome =
  | { passthrough: Record<string, never> }
  | { mocked: { rule: string; response: string; status?: number; error?: number } }
  | { unmocked: { status?: number; error?: number } };

export interface RequestEvent {
  seq: number;
  query: Record<string, string>;
  /// Milliseconds since 1970.
  date: number;
  method: string;
  host: string;
  path: string;
  outcome: Outcome;
}

export type WriteResult =
  | { ok: true; revision: number }
  | ({
      ok: false;
      reason: "conflict" | "readOnly" | "notFound" | "invalid" | "storage" | "unavailable" | "failed" | "transport";
      revision: number;
    } & EngineMessage);

export type NetworkState = "pending" | "completed" | "failed";

export interface NetworkSummary {
  id: string;
  method: string;
  url: string;
  host: string;
  name?: string;
  startedAtMilliseconds: number;
  durationMilliseconds?: number;
  statusCode?: number;
  responseByteCount?: number;
  state: NetworkState;
  errorSummary?: string;
}

export interface NetworkDetail extends NetworkSummary {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  responseBody?: { byteCount: number; isTruncated: boolean; contentType?: string; text?: string };
}

export type ResultKind = "mocked" | "passthrough" | "blocked" | "unknown";

export interface TrafficEntry {
  /// A Necto record id, or `ours:<seq>`.
  key: string;
  method: string;
  host: string;
  path: string;
  query: Record<string, string>;
  url?: string;
  startedAt: number;
  durationMs?: number;
  status?: number;
  state: NetworkState;
  bytes?: number;
  result: ResultKind;
  mockedBy?: { rule: string; response: string };
  /// The Necto record id to fetch the detail with.
  networkID?: string;
}
