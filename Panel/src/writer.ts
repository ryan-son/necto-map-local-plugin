//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import type { MapLocalAPI, WriteOp } from "./api";
import type { WriteResult } from "./types";

/// Sends writes one at a time. Necto does not order operations and the engine rejects a
/// write against an old revision, so concurrent writes would make the panel conflict with
/// itself. A conflict with another writer, such as the CLI, is retried once against the
/// latest revision.
export class Writer {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: MapLocalAPI,
    private readonly revision: () => number,
    private readonly onResult: (result: WriteResult) => void,
  ) {}

  submit(op: WriteOp, input: Record<string, unknown>): Promise<WriteResult> {
    const run = async (): Promise<WriteResult> => {
      let result = await this.api.write(op, { ...input, baseRevision: this.revision() });
      this.onResult(result);
      if (!result.ok && result.reason === "conflict") {
        result = await this.api.write(op, { ...input, baseRevision: this.revision() });
        this.onResult(result);
      }
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: Args | undefined;
  const run = () => {
    timer = undefined;
    const args = last;
    last = undefined;
    if (args) fn(...args);
  };
  return {
    call(...args: Args) {
      last = args;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    },
    flush() {
      if (timer) clearTimeout(timer);
      run();
    },
    /// Drops the waiting call once there is no reason to send it, like the save of a rule
    /// that was just deleted.
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      last = undefined;
    },
    pending: () => timer !== undefined,
  };
}
