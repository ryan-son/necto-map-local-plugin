//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

/// A stand-in for Necto and the app, used only by `npm run dev`, as Necto's own plugins do
/// (docs/harness.md, Rule 6). It answers on the same `webkit.messageHandlers.necto` channel
/// the host uses, so the panel runs through the real bridge client.
///
/// The data is deliberately awkward: a path too long for its column, a query rule, a 5xx,
/// a failure, pending rows, a body of about 200 KB, 500 rows to scroll and a host the
/// app blocks. A layout that survives these survives real traffic.
///
/// Never in the production bundle: `main.ts` imports it behind `import.meta.env.DEV`, and
/// script/build-panel fails when `mockMarker` shows up in `dist/`.

import type {
  Configuration,
  EngineState,
  NetworkDetail,
  NetworkSummary,
  Outcome,
  RequestEvent,
  Rule,
  WriteResult,
} from "./types";

/// Found in this file and nowhere in a production build; script/build-panel checks both.
export const mockMarker = "maplocal-dev-mock-host";

const api = "api.example.com";
const cdn = "cdn.example.com";
const auth = "auth.example.com";
const longPath =
  "/api/v2/organizations/{orgId}/projects/{projectId}/environments/{environment}/deployments/latest/artifacts";

const rules: Rule[] = [
  {
    id: "get-api-sites",
    enabled: true,
    tags: [],
    match: { method: "GET", host: api, path: "/api/sites" },
    active: "ok",
    responses: {
      ok: { status: 200, json: { sites: [{ id: 1, name: "Riverside Apartments, Building 102" }] } },
      "server error": { status: 500, json: { error: "internal" } },
      slow: { status: 200, delayMs: 3000, json: { sites: [] } },
    },
  },
  {
    id: "get-api-sites-page-2",
    enabled: true,
    tags: [],
    match: { method: "GET", host: api, path: "/api/sites", query: { page: "2" } },
    active: "unavailable",
    responses: { unavailable: { status: 503, json: { error: "maintenance" } }, ok: { status: 200, json: { sites: [] } } },
  },
  {
    id: "get-deployment-artifacts",
    enabled: true,
    tags: [],
    match: { method: "GET", host: api, path: longPath },
    active: "ok",
    responses: { ok: { status: 200, json: { artifacts: [] } } },
  },
  {
    id: "post-api-sessions",
    enabled: false,
    tags: ["auth"],
    match: { method: "POST", host: api, path: "/api/sessions" },
    active: "timeout",
    responses: { timeout: { error: "timedOut" } },
  },
];

interface Shape {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  outcome: Outcome;
  status: number;
}

const realPath = longPath
  .replace("{orgId}", "8f14e45fceea167a5a36dedd4bea2543")
  .replace("{projectId}", "c9f0f895fb98ab9159f51fd0297e236d")
  .replace("{environment}", "production-eu-west-1");
const mocked = (rule: string, response: string, status: number): Outcome => ({ mocked: { rule, response, status } });

/// Each shape's outcome is what the engine answers for it under the configuration above.
const shapes: Shape[] = [
  { method: "GET", host: api, path: "/api/sites", query: { page: "1", size: "20" }, outcome: mocked("get-api-sites", "ok", 200), status: 200 },
  { method: "GET", host: api, path: "/api/sites", query: { page: "2" }, outcome: mocked("get-api-sites-page-2", "unavailable", 503), status: 503 },
  {
    method: "GET",
    host: api,
    path: realPath,
    query: { include: "checksums,signatures,provenance", expand: "builder" },
    outcome: mocked("get-deployment-artifacts", "ok", 200),
    status: 200,
  },
  { method: "POST", host: api, path: "/api/sessions", outcome: { unmocked: { status: 503 } }, status: 503 },
  { method: "GET", host: api, path: "/api/notices", outcome: { unmocked: { status: 503 } }, status: 503 },
  { method: "GET", host: cdn, path: "/data/catalog.json", outcome: { passthrough: {} }, status: 200 },
  { method: "GET", host: cdn, path: "/images/missing.png", outcome: { passthrough: {} }, status: 404 },
  { method: "POST", host: auth, path: "/oauth/token", outcome: { passthrough: {} }, status: 200 },
];

const urlOf = (s: Shape) => {
  const query = s.query ? `?${new URLSearchParams(s.query)}` : "";
  return `https://${s.host}${s.path}${query}`;
};

/// About 200 KB of JSON, for the response viewer.
const largeBody = JSON.stringify(
  {
    items: Array.from({ length: 1700 }, (_, i) => ({
      id: i,
      sku: `SKU-${String(i).padStart(6, "0")}`,
      title: `Catalog item ${i} with a name long enough to wrap`,
      price: { amount: 1000 + i, currency: "KRW" },
    })),
  },
  null,
  2,
);

interface Session {
  state: EngineState;
  records: NetworkSummary[];
  shapeOf: Map<string, Shape>;
  events: RequestEvent[];
  subscriptions: Map<string, string>;
  nextSubscription: number;
}

function seed(now: number): Session {
  const configuration: Configuration = {
    version: 1,
    revision: 0,
    enabled: true,
    allowedHosts: [api],
    unmatched: { mode: "block", status: 503 },
    rules: structuredClone(rules),
  };
  const session: Session = {
    state: {
      revision: 0,
      configuration,
      readOnly: false,
      issues: [],
      observedHosts: [api, cdn, auth],
      blockedHosts: [auth],
      authMocked: false,
      launchID: "mock-launch",
    },
    records: [],
    shapeOf: new Map(),
    events: [],
    subscriptions: new Map(),
    nextSubscription: 1,
  };
  for (let i = 0; i < 500; i++) {
    const startedAt = now - (500 - i) * 1200;
    const pending = i >= 498;
    const failed = !pending && i % 41 === 7;
    add(session, shapes[i % shapes.length], startedAt, pending ? "pending" : failed ? "failed" : "completed", i);
  }
  return session;
}

function add(session: Session, shape: Shape, startedAt: number, state: NetworkSummary["state"], i: number) {
  const id = `r${session.records.length + 1}`;
  const record: NetworkSummary = {
    id,
    method: shape.method,
    url: urlOf(shape),
    host: shape.host,
    name: shape.path.split("/").pop(),
    startedAtMilliseconds: startedAt,
    state,
    ...(state === "completed" && {
      statusCode: shape.status,
      durationMilliseconds: 20 + ((i * 37) % 1500),
      responseByteCount: shape.path.endsWith("catalog.json") ? largeBody.length : 120 + i,
    }),
    ...(state === "failed" && { durationMilliseconds: 5000, errorSummary: "The request timed out." }),
  };
  session.records.push(record);
  session.shapeOf.set(id, shape);
  // Every 50th request is missing from our log, so the panel shows an unknown result.
  if (i % 50 === 49) return { record, event: undefined };
  const event: RequestEvent = {
    seq: session.events.length + 1,
    query: shape.query ?? {},
    date: startedAt + 2,
    method: shape.method,
    host: shape.host,
    path: shape.path,
    outcome: shape.outcome,
  };
  session.events.push(event);
  return { record, event };
}

function detail(session: Session, id: string): NetworkDetail | undefined {
  const record = session.records.find((r) => r.id === id);
  if (!record) return undefined;
  const large = record.url.endsWith("catalog.json");
  return {
    ...record,
    requestHeaders: { Accept: "application/json", "User-Agent": "ExampleApp/1.0 (iPhone; iOS 26.0; Scale/3.00)" },
    responseHeaders: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": "session=8f14e45fceea167a5a36dedd4bea2543; path=/; domain=.example.com; HttpOnly; Secure",
    },
    responseBody:
      record.state === "completed"
        ? {
            byteCount: large ? largeBody.length : 64,
            isTruncated: false,
            contentType: "application/json",
            text: large ? largeBody : JSON.stringify({ ok: (record.statusCode ?? 0) < 400, id }),
          }
        : undefined,
  };
}

type Message = { type: string; operationID?: string; input?: Record<string, unknown>; subscriptionID?: string };
type Reply = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

const ok = (value: unknown): Reply => ({ ok: true, value });
const fail = (code: string, message: string): Reply => ({ ok: false, error: { code, message } });

function write(session: Session, op: string, input: Record<string, unknown>): Reply {
  const { state } = session;
  const configuration = state.configuration;
  const forced = op === "maplocal.configuration.replace" && input.force === true;
  if (!forced && input.baseRevision !== state.revision) {
    const result: WriteResult = {
      ok: false,
      reason: "conflict",
      revision: state.revision,
      code: "conflict",
      message: "The configuration changed. Read maplocal.state and retry against its revision.",
    };
    return ok(result);
  }
  const ruleList = configuration.rules as Rule[];
  switch (op) {
    case "maplocal.configuration.replace":
      state.configuration = structuredClone(input.configuration) as Configuration;
      break;
    case "maplocal.configuration.patch": {
      const { baseRevision: _, order, ...fields } = input;
      Object.assign(configuration, structuredClone(fields));
      if (Array.isArray(order))
        configuration.rules = order.map((id) => ruleList.find((r) => r.id === id)).filter((r) => r !== undefined);
      break;
    }
    case "maplocal.rule.upsert": {
      const rule = structuredClone(input.rule) as Rule;
      const at = ruleList.findIndex((r) => r.id === rule.id);
      if (at >= 0) ruleList[at] = rule;
      else ruleList.push(rule);
      break;
    }
    case "maplocal.rule.delete":
    case "maplocal.rule.setActive": {
      const at = ruleList.findIndex((r) => r.id === input.id);
      if (at < 0) return fail("OPERATION_UNAVAILABLE", `No rule ${String(input.id)}`);
      if (op === "maplocal.rule.delete") ruleList.splice(at, 1);
      else ruleList[at].active = String(input.response);
      break;
    }
    default:
      return fail("OPERATION_NOT_FOUND", `No mock for ${op}`);
  }
  state.revision += 1;
  state.configuration.revision = state.revision;
  broadcast(session, "maplocal.state.observe", structuredClone(state));
  const result: WriteResult = { ok: true, revision: state.revision };
  return ok(result);
}

type Deliver = (subscriptionID: string, event: unknown) => void;
const deliver: Deliver = (id, event) =>
  (window as unknown as { __nectoBridgeDeliver?: Deliver }).__nectoBridgeDeliver?.(id, event);

/// Later, never inline: the bridge registers the stream only after `subscribe` resolves.
function broadcast(session: Session, operationID: string, event: unknown) {
  for (const [id, op] of session.subscriptions)
    if (op === operationID) setTimeout(() => deliver(id, event), 0);
}

const operationIDs = [
  "maplocal.state",
  "maplocal.state.observe",
  "maplocal.configuration.replace",
  "maplocal.configuration.patch",
  "maplocal.rule.upsert",
  "maplocal.rule.delete",
  "maplocal.rule.setActive",
  "maplocal.requests.observe",
  "maplocal.requests.list",
  "maplocal.configuration.export",
  "network.observe",
  "network.list",
  "network.detail",
];

function reply(session: Session, message: Message): Reply {
  const input = message.input ?? {};
  switch (message.type) {
    case "context":
      return ok({
        protocolVersion: 1,
        pluginID: "io.github.ryan-son.maplocal",
        pluginVersion: "0.0.0-dev",
        sourceIdentity: mockMarker,
        operations: operationIDs.map((id) => ({ id, available: true })),
        target: { targetHandle: "mock", deviceID: "mock", appBundleID: "com.example.app", appName: "ExampleApp" },
      });
    case "ready":
    case "unsubscribe":
      if (message.subscriptionID) session.subscriptions.delete(message.subscriptionID);
      return ok(null);
    case "subscribe": {
      const id = `mock-${session.nextSubscription++}`;
      session.subscriptions.set(id, message.operationID ?? "");
      // Like the host, the state stream starts with the current state.
      if (message.operationID === "maplocal.state.observe") {
        const state = structuredClone(session.state);
        setTimeout(() => deliver(id, state), 0);
      }
      return ok(id);
    }
    case "invoke":
      switch (message.operationID) {
        case "maplocal.state":
          return ok(structuredClone(session.state));
        case "maplocal.configuration.export":
          return ok({ configuration: structuredClone(session.state.configuration) });
        case "maplocal.requests.list": {
          const limit = typeof input.limit === "number" ? input.limit : 500;
          return ok({ events: session.events.slice(-limit), lastSeq: session.events.at(-1)?.seq ?? 0 });
        }
        case "network.list": {
          const limit = typeof input.limit === "number" ? input.limit : 1000;
          return ok({ records: session.records.slice(-limit) });
        }
        case "network.detail": {
          const record = detail(session, String(input.recordID));
          return record ? ok({ record }) : fail("OPERATION_UNAVAILABLE", "No such record");
        }
        default:
          return write(session, message.operationID ?? "", input);
      }
    default:
      return fail("OPERATION_NOT_FOUND", `No mock for '${message.type}'`);
  }
}

/// A new request every `liveMs` (0 for none): pending first, then completed.
function live(session: Session, liveMs: number): () => void {
  if (liveMs <= 0) return () => undefined;
  let n = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const interval = setInterval(() => {
    const i = n++;
    const shape = shapes[i % shapes.length];
    const { record, event } = add(session, shape, Date.now(), "pending", i);
    broadcast(session, "network.observe", { record: { ...record } });
    if (event) broadcast(session, "maplocal.requests.observe", event);
    const done = setTimeout(() => {
      timers.delete(done);
      Object.assign(record, { state: "completed", statusCode: shape.status, durationMilliseconds: 300, responseByteCount: 64 });
      broadcast(session, "network.observe", { record: { ...record } });
    }, Math.min(300, liveMs));
    timers.add(done);
  }, liveMs);
  return () => {
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
  };
}

/// Installs the stand-in host and returns a function that removes it.
export function installMockBridge(options: { liveMs?: number } = {}): () => void {
  const session = seed(Date.now());
  const target = window as unknown as {
    webkit?: { messageHandlers?: Record<string, { postMessage(message: unknown): Promise<Reply> }> };
  };
  target.webkit = { messageHandlers: { necto: { postMessage: async (message) => reply(session, message as Message) } } };
  const stop = live(session, options.liveMs ?? 4000);
  return () => {
    stop();
    delete target.webkit;
  };
}
