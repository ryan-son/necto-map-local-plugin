//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { MapLocalAPI, WriteOp } from "./api";
import { failureFrom } from "./messages";
import type { Configuration, EngineState, RequestEvent, Rule, Unmatched, WriteResult } from "./types";
import { Writer } from "./writer";

const maxRequests = 200;

export type ChangeReason = "state" | "requests" | "write";

/// The panel's state and its write commands. The view reads nothing else.
export class PanelModel {
  state?: EngineState;
  requests: RequestEvent[] = [];
  lastFailure?: WriteResult;
  conflict = false;
  private known = 0;
  private inflight: Promise<unknown> = Promise.resolve();
  private readonly writer: Writer;

  constructor(
    private readonly api: MapLocalAPI,
    private readonly changed: (reason: ChangeReason) => void,
  ) {
    this.writer = new Writer(
      api,
      () => this.known,
      (result) => this.afterWrite(result),
    );
  }

  receiveState(state: EngineState) {
    const previous = this.state;
    const restarted =
      previous !== undefined &&
      (previous.launchID !== state.launchID || state.revision < previous.revision);
    this.state = state;
    this.known = restarted ? state.revision : Math.max(this.known, state.revision);
    this.changed("state");
  }

  receiveRequest(event: RequestEvent) {
    this.requests = [event, ...this.requests].slice(0, maxRequests);
    this.changed("requests");
  }

  setEnabled = (enabled: boolean) => this.send("maplocal.configuration.patch", { enabled });
  setAllowedHosts = (allowedHosts: string[]) =>
    this.send("maplocal.configuration.patch", { allowedHosts });
  setUnmatched = (unmatched: Unmatched) => this.send("maplocal.configuration.patch", { unmatched });
  acknowledgeSession = () => this.send("maplocal.configuration.patch", { authMocked: false });
  reorder = (order: string[]) => this.send("maplocal.configuration.patch", { order });
  upsertRule = (rule: Rule) => this.send("maplocal.rule.upsert", { rule });
  deleteRule = (id: string) => this.send("maplocal.rule.delete", { id });
  setActive = (id: string, response: string) =>
    this.send("maplocal.rule.setActive", { id, response });
  importConfiguration = (configuration: Configuration) =>
    this.send("maplocal.configuration.replace", { force: true, configuration });

  idle(): Promise<void> {
    return this.inflight.then(
      () => undefined,
      () => undefined,
    );
  }

  /// Turns a throw (an input the app refused, the app disconnected, a timeout) into a
  /// result too, so the view hears about it. Callers are free to ignore the result.
  private send(op: WriteOp, input: Record<string, unknown>): Promise<WriteResult> {
    const result = this.writer.submit(op, input).catch((error: unknown): WriteResult => {
      const failure = failureFrom(error, this.known);
      this.lastFailure = failure;
      // Not a conflict, so a conflict notice left by earlier writes no longer holds.
      this.conflict = false;
      this.changed("write");
      return failure;
    });
    this.inflight = result;
    return result;
  }

  private afterWrite(result: WriteResult) {
    this.known = Math.max(this.known, result.revision);
    if (result.ok) {
      this.lastFailure = undefined;
      this.conflict = false;
    } else {
      this.conflict =
        result.reason === "conflict" &&
        this.lastFailure?.ok === false &&
        this.lastFailure.reason === "conflict";
      this.lastFailure = result;
    }
    this.changed("write");
  }
}
