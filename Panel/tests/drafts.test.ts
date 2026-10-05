//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import { localDrafts } from "../src/drafts";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

test("keeps and clears in-progress edits per rule and response", () => {
  const drafts = localDrafts(new MemoryStorage() as unknown as Storage);
  drafts.set("a/ok", { headersText: "{}", bodyText: "{\"x\":" });
  expect(drafts.get("a/ok")).toEqual({ headersText: "{}", bodyText: "{\"x\":" });
  expect(drafts.get("a/other")).toBeUndefined();
  drafts.clear("a/ok");
  expect(drafts.get("a/ok")).toBeUndefined();
});

test("the panel keeps working when the storage throws", () => {
  const broken = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  const drafts = localDrafts(broken as unknown as Storage);
  expect(() => drafts.set("a/ok", { headersText: "{}", bodyText: "x" })).not.toThrow();
  expect(drafts.get("a/ok")).toBeUndefined();
});

test("localDrafts() keeps working even when merely accessing localStorage throws", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  try {
    const drafts = localDrafts();
    expect(() => drafts.set("a/ok", { headersText: "{}", bodyText: "x" })).not.toThrow();
    expect(drafts.get("a/ok")).toBeUndefined();
    expect(() => drafts.clear("a/ok")).not.toThrow();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
