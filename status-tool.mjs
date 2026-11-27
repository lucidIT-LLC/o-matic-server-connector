import { createHash } from "node:crypto";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keyFor = (ctx) => ctx?.sessionKey && `openclaw:${createHash("sha256").update(JSON.stringify([ctx.agentId ?? "", ctx.sessionKey])).digest("hex")}`;
const slotFor = (ctx, connection) => JSON.stringify([ctx.agentId, ctx.sessionKey, ctx.sessionId ?? null, connection]);
function packet(value) {
  if (value?.isError) return;
  if (object(value?.structuredContent)) return value.structuredContent;
  if (object(value) && value.state) return value;
  const content = Array.isArray(value) ? value : value?.content;
  const text = typeof value === "string" ? value : content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string" || text.length > 100000) return;
  try { const parsed = JSON.parse(text.replace(/^structuredContent:\s*\n/, ""));
    if (object(parsed) && !parsed.isError) return parsed;
  } catch { /* Unverifiable output is not a successful observation. */ }
}

export function registerConnectionStatus(api) {
  const config = api.pluginConfig ?? {};
  const connections = new Set(config.connections ?? []);
  const agents = config.agentIds ? new Set(config.agentIds) : undefined;
  const names = new Map(Object.entries(config.toolNames ?? {}).map(([name, tool]) => [name.toLowerCase(), tool]));
  const identify = (name) => typeof name === "string" && (names.get(name.toLowerCase())
    ?? name.toLowerCase().match(/^(?:mcp__o_matic_server__|mcp__codex_apps__o_matic_server_mcp__?|o-matic-server(?:__|\.))([a-z_]+)$/)?.[1]);
  const enrolled = (ctx) => Boolean(keyFor(ctx)) && (!agents || agents.has(ctx.agentId));
  const states = new Map();
  const stateFor = (ctx, connection) => {
    const slot = slotFor(ctx, connection);
    if (!states.has(slot)) {
      states.set(slot, {});
      if (states.size > 2048) states.delete(states.keys().next().value);
    }
    return states.get(slot);
  };
  api.on("before_tool_call", (event, ctx) => {
    if (!enrolled(ctx) || identify(event.toolName) !== "startup"
        || !connections.has(event.params?.connection)) return;
    // Observation only. The main guard validates the actual arguments.
    const state = stateFor(ctx, event.params.connection);
    for (const key of Object.keys(state)) delete state[key];
    if (event.params.conversation_key === keyFor(ctx) && event.toolCallId) state.pending = event.toolCallId;
  });
  api.on("after_tool_call", (event, ctx) => {
    if (!enrolled(ctx) || identify(event.toolName) !== "startup" || !connections.has(event.params?.connection)
        || event.params.conversation_key !== keyFor(ctx)) return;
    const state = stateFor(ctx, event.params.connection);
    if (!state.pending || state.pending !== event.toolCallId) return;
    delete state.pending;
    const out = event.error ? undefined : packet(event.result);
    const ttl = out?.startup_proof_expires_in_seconds;
    if (out?.state !== "READY" || out.connection !== event.params.connection
        || out.kernel?.addressing !== "conversation_key" || out.kernel?.kernel_state !== "active"
        || typeof out.startup_proof !== "string" || !/^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(out.startup_proof)
        || !Number.isInteger(ttl) || ttl < 1 || ttl > 3600) return;
    state.readiness = "READY";
    state.expiresAt = Date.now() + ttl * 1000;
    state.surface = out.session_tool_surface?.state === "CURRENT"
      && out.session_tool_surface.this_session_listed_by_this_process === true ? "CURRENT" : "UNVERIFIED";
    // Neither proof, raw startup packet, principal, artifact nor credential is retained.
  });
  api.registerTool({ contextVersion: 2, create(ctx) {
    if (!enrolled(ctx) || typeof ctx.assertInvocationCurrent !== "function") return null;
    return {
      name: "omatic_connection_status", label: "o-MATIC Server Connection status",
      description: "Read bounded local connection observations and explicit capability limits. Does not dispatch agents, reconnect, grant authority or claim task completion.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_toolCallId, args) => {
        ctx.assertInvocationCurrent();
        if (!object(args) || Object.keys(args).length) throw new Error("No actor, receipt, status or connection overrides are accepted");
        const factories = [...connections].map((connection) => {
          const state = states.get(slotFor(ctx, connection));
          const current = state?.expiresAt > Date.now();
          return { connection, readiness: current ? state.readiness : "UNVERIFIED",
            toolSurface: current ? state.surface : "UNVERIFIED" };
        });
        const result = {
          plugin: { id: "omatic-governance", name: "o-MATIC Server Connection" },
          status: "diagnostic_only", factories,
          workflow: { status: "blocked", reason: "authenticated_backend_unbound",
            executorProvenance: "executor_unverified",
            canonicalPeerReturn: "unbound", productionReceiptStore: "unbound", automaticRetry: false },
          agentDispatch: "not_provided", generalChatFinalizationHook: "not_registered",
          discovery: { automaticRetry: false, remediation: "Owning host must measure reconnect/tools-list if needed; repeated startup/search or another process's CLI reload is not repair." },
        };
        ctx.assertInvocationCurrent();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    };
  } }, { name: "omatic_connection_status" });
  api.on("gateway_stop", () => states.clear());
}
