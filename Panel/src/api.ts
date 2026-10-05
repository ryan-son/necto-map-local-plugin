//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { hasErrorCode, necto } from "@necto/bridge";
import type { Configuration, EngineState, NetworkDetail, NetworkSummary, RequestEvent, WriteResult } from "./types";

export type WriteOp =
  | "maplocal.configuration.replace"
  | "maplocal.configuration.patch"
  | "maplocal.rule.upsert"
  | "maplocal.rule.delete"
  | "maplocal.rule.setActive";

type Unsubscribe = () => Promise<void>;

export interface MapLocalAPI {
  state(): Promise<EngineState>;
  write(op: WriteOp, input: Record<string, unknown>): Promise<WriteResult>;
  exportConfiguration(): Promise<Configuration>;
  observeState(on: (state: EngineState) => void, onError: (error: unknown) => void): Promise<Unsubscribe>;
  observeRequests(on: (event: RequestEvent) => void, onError: (error: unknown) => void): Promise<Unsubscribe>;
  requestsList(): Promise<{ events: RequestEvent[]; lastSeq: number }>;
  observeNetwork(on: (record: NetworkSummary) => void, onError: (error: unknown) => void): Promise<Unsubscribe>;
  /// Whether Necto's network plugin answers, and Necto's reason when it doesn't.
  networkAvailability(): Promise<{ available: boolean; reason?: string }>;
  networkRecords(): Promise<NetworkSummary[]>;
  networkDetail(id: string): Promise<NetworkDetail>;
}

// The bridge types its input as a JSON object; every input here serialises to JSON.
type BridgeInput = Parameters<typeof necto.device.send>[1];

export function bridgeAPI(): MapLocalAPI {
  return {
    state: () => necto.device.send<EngineState>("maplocal.state"),
    write: (op, input) => necto.device.send<WriteResult>(op, input as BridgeInput),
    exportConfiguration: async () =>
      (await necto.device.send<{ configuration: Configuration }>("maplocal.configuration.export")).configuration,
    async observeState(on, onError) {
      const subscription = await necto.device.subscribe<EngineState>("maplocal.state.observe", {}, on, onError);
      return () => subscription.unsubscribe();
    },
    async observeRequests(on, onError) {
      const subscription = await necto.device.subscribe<RequestEvent>("maplocal.requests.observe", {}, on, onError);
      return () => subscription.unsubscribe();
    },
    requestsList: () => necto.device.send<{ events: RequestEvent[]; lastSeq: number }>("maplocal.requests.list", {}),
    async observeNetwork(on, onError) {
      // Necto's stream delivers `{record: …}`, as measured against a live session.
      const subscription = await necto.device.subscribe<{ record: NetworkSummary }>(
        "network.observe",
        {},
        (event) => on(event.record),
        onError,
      );
      return () => subscription.unsubscribe();
    },
    async networkAvailability() {
      const context = await necto.context();
      if (necto.isOperationAvailable(context, "network.list")) return { available: true };
      return { available: false, reason: context.operations.find((o) => o.id === "network.list")?.unavailableReason };
    },
    networkRecords: async () =>
      (await necto.device.send<{ records: NetworkSummary[] }>("network.list", { limit: 1000 })).records,
    networkDetail: async (id) =>
      (await necto.device.send<{ record: NetworkDetail }>("network.detail", { recordID: id })).record,
  };
}

export const isDisconnected = (error: unknown): boolean => hasErrorCode(error, "TARGET_DISCONNECTED");
