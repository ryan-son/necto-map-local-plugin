//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { MapLocalAPI, WriteOp } from "../src/api";
import type {
  Configuration,
  EngineState,
  NetworkDetail,
  NetworkSummary,
  RequestEvent,
  Rule,
  WriteResult,
} from "../src/types";

export const rule = (id: string, path = `/${id}`): Rule => ({
  id,
  enabled: true,
  tags: [],
  match: { method: "GET", path },
  active: "ok",
  responses: { ok: { status: 200 } },
});

export const configuration = (rules: Rule[] = [rule("a")]): Configuration => ({
  version: 1,
  revision: 0,
  enabled: true,
  allowedHosts: ["maplocal.invalid"],
  unmatched: { mode: "passthrough" },
  rules,
});

export const engineState = (c: Configuration = configuration()): EngineState => ({
  revision: c.revision,
  configuration: c,
  readOnly: false,
  issues: [],
  observedHosts: [],
  blockedHosts: [],
  authMocked: false,
  launchID: "launch-1",
});

/** Records writes and returns the preset results (a revision+1 success when none are set). */
export class FakeAPI implements MapLocalAPI {
  writes: Array<{ op: WriteOp; input: Record<string, unknown> }> = [];
  results: WriteResult[] = [];
  revision = 0;
  current: EngineState = engineState();
  onState?: (s: EngineState) => void;
  onRequest?: (e: RequestEvent) => void;
  stateError?: unknown;
  stateErrorHandler?: (e: unknown) => void;
  network = false;
  networkReason?: string;
  calls: string[] = [];
  listed = { events: [] as RequestEvent[], lastSeq: 0 };
  networkList: NetworkSummary[] = [];
  onNetwork?: (r: NetworkSummary) => void;
  networkErrorHandler?: (e: unknown) => void;
  detailFor?: (id: string) => NetworkDetail;

  async state() { return this.current; }
  async write(op: WriteOp, input: Record<string, unknown>) {
    this.writes.push({ op, input });
    const next = this.results.shift();
    if (next) { if (next.ok) this.revision = next.revision; return next; }
    this.revision += 1;
    return { ok: true as const, revision: this.revision };
  }
  async exportConfiguration() { return this.current.configuration; }
  async observeState(on: (s: EngineState) => void, onError: (e: unknown) => void) {
    if (this.stateError) { const e = this.stateError; this.stateError = undefined; throw e; }
    this.onState = on;
    this.stateErrorHandler = onError;
    on(this.current);
    return async () => { this.onState = undefined; };
  }
  async observeRequests(on: (e: RequestEvent) => void) {
    this.onRequest = on;
    return async () => { this.onRequest = undefined; };
  }
  async networkAvailability() { return { available: this.network, reason: this.network ? undefined : this.networkReason }; }
  async requestsList() { this.calls.push("requestsList"); return this.listed; }
  async observeNetwork(on: (r: NetworkSummary) => void, onError: (e: unknown) => void) {
    this.calls.push("observeNetwork");
    this.onNetwork = on;
    this.networkErrorHandler = onError;
    return async () => { this.onNetwork = undefined; };
  }
  async networkRecords() { this.calls.push("networkRecords"); return this.networkList; }
  async networkDetail(id: string): Promise<NetworkDetail> {
    if (this.detailFor) return this.detailFor(id);
    throw new Error("no record");
  }
}
