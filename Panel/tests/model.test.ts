//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import { ko } from "../src/localization";
import { type EngineMessage, translate } from "../src/messages";
import { PanelModel } from "../src/model";
import { configuration, engineState, FakeAPI, rule } from "./fake-api";

function setup() {
  const api = new FakeAPI();
  let changes = 0;
  const model = new PanelModel(api, () => { changes += 1; });
  model.receiveState(engineState());
  return { api, model, changes: () => changes };
}

test("writes with the revision of the state it received", async () => {
  const { api, model } = setup();
  model.receiveState(engineState({ ...configuration(), revision: 7 }));
  await model.setEnabled(false);
  expect(api.writes[0]).toEqual({ op: "maplocal.configuration.patch", input: { enabled: false, baseRevision: 7 } });
});

test("commands turn into the defined operations and inputs", async () => {
  const { api, model } = setup();
  await model.setAllowedHosts(["a.invalid"]);
  await model.setUnmatched({ mode: "block", status: 421 });
  await model.acknowledgeSession();
  await model.upsertRule(rule("b"));
  await model.setActive("b", "ok");
  await model.deleteRule("b");
  await model.reorder(["a"]);
  await model.importConfiguration(configuration([]));
  expect(api.writes.map((w) => [w.op, Object.keys(w.input).sort().join(",")])).toEqual([
    ["maplocal.configuration.patch", "allowedHosts,baseRevision"],
    ["maplocal.configuration.patch", "baseRevision,unmatched"],
    ["maplocal.configuration.patch", "authMocked,baseRevision"],
    ["maplocal.rule.upsert", "baseRevision,rule"],
    ["maplocal.rule.setActive", "baseRevision,id,response"],
    ["maplocal.rule.delete", "baseRevision,id"],
    ["maplocal.configuration.patch", "baseRevision,order"],
    ["maplocal.configuration.replace", "baseRevision,configuration,force"],
  ]);
  expect(api.writes[2].input.authMocked).toBe(false);
  expect(api.writes[7].input.force).toBe(true);
});

test("a failed write keeps its reason, and a repeated conflict turns conflict on", async () => {
  const { api, model } = setup();
  api.results = [
    {
      ok: false,
      reason: "invalid",
      code: "pathMustStartWithSlash",
      params: {},
      message: "match.path must start with /",
      revision: 0,
    },
  ];
  await model.upsertRule(rule("bad"));
  expect(model.lastFailure).toMatchObject({ reason: "invalid" });
  api.results = [
    { ok: false, reason: "conflict", message: "", revision: 3 },
    { ok: false, reason: "conflict", message: "", revision: 4 },
  ];
  await model.setEnabled(false);
  expect(model.conflict).toBe(true);
});

test("a write that throws clears a conflict notice left by earlier writes", async () => {
  const { api, model } = setup();
  api.results = [
    { ok: false, reason: "conflict", message: "", revision: 3 },
    { ok: false, reason: "conflict", message: "", revision: 4 },
  ];
  await model.setEnabled(false);
  expect(model.conflict).toBe(true);
  api.write = async () => { throw { code: "INVALID_INPUT", message: "No rule 'gone'" }; };
  await model.deleteRule("gone");
  expect(model.lastFailure).toMatchObject({ ok: false });
  expect(model.conflict).toBe(false);
});

test("keeps only the latest 200 request records, newest first", () => {
  const { model } = setup();
  for (let i = 0; i < 205; i += 1)
    model.receiveRequest({
      seq: 0,
      query: {},
      date: i,
      method: "GET",
      host: "h",
      path: `/${i}`,
      outcome: { passthrough: {} },
    });
  expect(model.requests).toHaveLength(200);
  expect(model.requests[0].path).toBe("/204");
});

test("keeps the failure and tells the screen when sending throws (the app disconnected)", async () => {
  const { api, model, changes } = setup();
  api.write = async () => { throw Object.assign(new Error("앱 연결이 끊겼어요"), { code: "TARGET_DISCONNECTED" }); };
  const before = changes();
  const result = await model.setEnabled(false);
  expect(result).toMatchObject({ ok: false, reason: "transport" });
  expect(model.lastFailure).toMatchObject({ reason: "transport", message: "앱 연결이 끊겼어요" });
  expect(changes()).toBeGreaterThan(before);
});

test("idle waits until the write in progress finishes", async () => {
  const { api, model } = setup();
  void model.setEnabled(false);
  await model.idle();
  expect(api.writes).toHaveLength(1);
});

test("change notifications carry the reason (state, records, write)", async () => {
  const api = new FakeAPI();
  const reasons: string[] = [];
  const model = new PanelModel(api, (reason) => { reasons.push(reason); });
  model.receiveState(engineState());
  model.receiveRequest({
    seq: 0,
    query: {},
    date: 0,
    method: "GET",
    host: "h",
    path: "/",
    outcome: { passthrough: {} },
  });
  await model.setEnabled(false);
  expect(reasons).toEqual(["state", "requests", "write"]);
});

test("writes with the new revision even when it is lower, once a relaunch changes launchID", async () => {
  const { api, model } = setup();
  model.receiveState(engineState({ ...configuration(), revision: 9 }));
  model.receiveState({ ...engineState({ ...configuration(), revision: 0 }), launchID: "launch-2" });
  await model.setEnabled(false);
  expect(api.writes[0].input).toMatchObject({ baseRevision: 0 });
});

test("realigns to the state revision when it goes backwards within the same launch", async () => {
  const { api, model } = setup();
  model.receiveState(engineState({ ...configuration(), revision: 9 }));
  model.receiveState(engineState({ ...configuration(), revision: 2 }));
  await model.setEnabled(false);
  expect(api.writes[0].input).toMatchObject({ baseRevision: 2 });
});

/// What the bridge rejects with: an Error carrying a code, and the engine's details when
/// the app threw.
const bridgeError = (code: string, message: string, details?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, details });

test("turns an error the app threw into a failure the panel translates by its code", async () => {
  const { api, model } = setup();
  api.write = async () => {
    throw bridgeError("OPERATION_UNAVAILABLE", "No rule 'r'", {
      reason: "notFound",
      code: "ruleNotFound",
      params: { rule: "r" },
      message: "No rule 'r'",
      revision: 4,
    });
  };
  const result = await model.deleteRule("r");
  expect(result).toMatchObject({ ok: false, reason: "notFound", code: "ruleNotFound", revision: 4 });
  expect(translate(model.lastFailure as EngineMessage)).toBe(ko["No rule '{rule}'"].replace("{rule}", "r"));
});

test("an input Necto refused against the schema shows a translated lead with Necto's own text", async () => {
  const { api, model } = setup();
  api.write = async () => { throw bridgeError("INVALID_INPUT", "baseRevision: must be of type integer"); };
  const result = await model.setEnabled(false);
  expect(result).toMatchObject({ ok: false, reason: "invalid" });
  expect(translate(model.lastFailure as EngineMessage)).toBe(
    ko["The app refused the input: {detail}"].replace("{detail}", "baseRevision: must be of type integer"),
  );
});

test.each([
  ["TARGET_DISCONNECTED", "transport", "The app disconnected"],
  ["TIMEOUT", "transport", "The app didn't answer in time"],
  ["PROVIDER_FAILED", "failed", "The app couldn't do it: {detail}"],
  ["OPERATION_UNAVAILABLE", "unavailable", "The app doesn't offer this right now: {detail}"],
])("a %s without details reads as %s in the panel's language", async (code, reason, english) => {
  const { api, model } = setup();
  api.write = async () => { throw bridgeError(code, "host text"); };
  await model.setEnabled(false);
  expect(model.lastFailure).toMatchObject({ ok: false, reason });
  expect(translate(model.lastFailure as EngineMessage)).toBe(ko[english].replace("{detail}", "host text"));
});

test("an error that is not the bridge's shows its own text", async () => {
  const { api, model } = setup();
  api.write = async () => { throw new Error("boom"); };
  await model.setEnabled(false);
  expect(model.lastFailure).toMatchObject({ ok: false, reason: "transport", message: "boom" });
  expect(translate(model.lastFailure as EngineMessage)).toBe("boom");
});
