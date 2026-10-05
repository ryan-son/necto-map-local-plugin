//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { isNectoBridgeError } from "@necto/bridge";
import { t } from "./localization";
import type { WriteResult } from "./types";

/// A failure or an issue as the engine sends it: a code from Swift's `MessageCode`, the
/// values its text needs, the message that caused it, and the English text.
export interface EngineMessage {
  code?: string;
  params?: Record<string, string>;
  message: string;
  cause?: EngineMessage;
}

type Params = Record<string, string>;

/// Each English key equals the code's template in `Fixtures/message-codes.json`, which the
/// Swift tests check against `MessageCode`.
const byCode: Record<string, (params: Params) => string> = {
  mustBeObject: (p) => t("{key} must be an object", p),
  mustBeArray: (p) => t("{key} must be an array", p),
  mustBeStringArray: (p) => t("{key} must be an array of strings", p),
  mustBeBoolean: (p) => t("{key} must be true or false", p),
  mustBeString: (p) => t("{key} must be a string", p),
  mustBeIntegerAtLeast: (p) => t("{key} must be an integer of {min} or more", p),
  outOfRange: (p) => t("{key} must be an integer from {min} to {max}", p),
  mustBeOneOf: (p) => t("{key} must be one of: {choices}", p),
  unsupportedKey: (p) => t("Unsupported key in {place}: {key}", p),
  required: (p) => t("{key} is required", p),
  invalidHost: (p) => t("{key} has a value that can't be read as a host: {value}", p),
  pathMustStartWithSlash: () => t("match.path must start with /"),
  pathHasQuery: () => t("match.path can't contain a query or a fragment; use match.query"),
  pathNotEncoded: (p) => t("match.path must be percent-encoded, as the app sends it: {value}", p),
  responsesEmpty: () => t("responses must have at least one response"),
  activeNotInResponses: () => t("active must name one of the responses"),
  statusOrErrorRequired: (p) => t("{key} needs a status or an error", p),
  duplicateID: (p) => t("Duplicate id: {id}", p),
  versionTooNew: (p) => t("Configuration version {version} is newer than this plugin supports ({supported})", p),
  authMockedOnlyFalse: () => t("authMocked can only be false, which clears the mocked session"),
  authMockedAlone: () => t("authMocked can't be sent with other keys"),
  orderMismatch: () => t("order must list every rule id exactly once"),
  notWriteOperation: () => t("Not a write operation"),
  ruleNotFound: (p) => t("No rule '{rule}'", p),
  responseNotFound: (p) => t("No response '{response}'", p),
  conflict: () => t("Changed elsewhere first. Get the latest configuration and try again"),
  readOnly: () => t("The configuration is read-only (see issues)"),
  saveFailed: (p) => t("Couldn't save the configuration: {error}", p),
  engineMissing: () => t("The Map Local engine isn't running"),
  fileUnreadable: (p) =>
    t("Couldn't read the configuration file, so it opens read-only and won't be overwritten: {error}", p),
  fileMovedAside: (p) => t("Couldn't read the configuration file, so it was moved aside to {file}", p),
  fileTooNew: (p) => t("Configuration version {version} is newer than this plugin, so it is read-only", p),
  ruleUnsupported: (p) => t("Rule {rule}: {cause}", p),
  // Necto's own error codes, for a call that failed before the engine could answer, such
  // as an input the manifest's schema refused. `detail` is Necto's English text.
  INVALID_INPUT: (p) => t("The app refused the input: {detail}", p),
  OPERATION_UNAVAILABLE: (p) => t("The app doesn't offer this right now: {detail}", p),
  PROVIDER_FAILED: (p) => t("The app couldn't do it: {detail}", p),
  TARGET_DISCONNECTED: () => t("The app disconnected"),
  TIMEOUT: () => t("The app didn't answer in time"),
};

type Failure = Extract<WriteResult, { ok: false }>;

const reasonByBridgeCode: Record<string, Failure["reason"]> = {
  INVALID_INPUT: "invalid",
  OPERATION_UNAVAILABLE: "unavailable",
  PROVIDER_FAILED: "failed",
  INVALID_OUTPUT: "failed",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/// A rejected call as a failed write. The engine throws with its message in `details`,
/// which translates by its code; Necto's own errors carry no details and translate by
/// Necto's code, keeping Necto's English text as the detail.
export function failureFrom(error: unknown, revision: number): Failure {
  if (!isNectoBridgeError(error)) {
    return { ok: false, reason: "transport", message: error instanceof Error ? error.message : String(error), revision };
  }
  const details = error.details;
  if (isRecord(details) && typeof details.message === "string") {
    const engine = details as unknown as EngineMessage & { reason?: Failure["reason"]; revision?: number };
    return {
      ok: false,
      reason: engine.reason ?? reasonByBridgeCode[error.code] ?? "transport",
      code: engine.code,
      params: engine.params,
      message: engine.message,
      cause: engine.cause,
      revision: typeof engine.revision === "number" ? engine.revision : revision,
    };
  }
  return {
    ok: false,
    reason: reasonByBridgeCode[error.code] ?? "transport",
    code: error.code,
    params: { detail: error.message },
    message: error.message,
    revision,
  };
}

/// The message in the panel's language. A code this panel doesn't know, from a newer app,
/// shows the engine's English text.
export function translate(message: EngineMessage): string {
  const translation = message.code !== undefined && Object.hasOwn(byCode, message.code) ? byCode[message.code] : undefined;
  if (!translation) return message.message;
  const params: Params = { ...message.params };
  if (message.cause) params.cause = translate(message.cause);
  return translation(params);
}
