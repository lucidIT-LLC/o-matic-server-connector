import { createHash } from "node:crypto";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isProof = (v) => typeof v === "string" && /^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(v);
const block = (blockReason) => ({ block: true, blockReason });
const bootstrap = new Set(["startup", "connections_list", "omatic_guide"]);
const cleanRead = (sql) => typeof sql === "string"
  && /^\s*SELECT\b/i.test(sql) && !/;\s*\S|\b(INTO|FOR\s+(UPDATE|SHARE))\b/i.test(sql);
const targetedRead = (sql) => cleanRead(sql)
  && /\bFROM\s+(factory|brain|public|information_schema)\.[a-z_][a-z_0-9]*\b/i.test(sql)
  && /\bWHERE\b/i.test(sql);

function conversation(ctx) {
  if (typeof ctx?.sessionKey !== "string" || !ctx.sessionKey) return;
  const digest = createHash("sha256").update(JSON.stringify([
    ctx.agentId ?? "", ctx.sessionKey,
  ])).digest("hex");
  return `openclaw:${digest}`;
}

function packet(result) {
  // Native dynamic MCP renders structuredContent as a labeled text block;
  // Codex connector calls preserve the structured object. Accept only bounded
  // JSON from those observed envelopes, never prose or model-authored claims.
  if (object(result) && result.isError === true) return;
  if (object(result?.structuredContent)) return result.structuredContent;
  if (object(result) && (result.state || result.kernel_state)) return result;
  const content = Array.isArray(result) ? result : result?.content;
  const item = Array.isArray(content) && content.find((x) => x?.type === "text");
  const text = typeof result === "string" ? result : item?.text;
  if (typeof text === "string" && text.length < 100000) {
    try {
      const parsed = JSON.parse(text.replace(/^structuredContent:\s*\n/, ""));
      if (object(parsed) && parsed.isError !== true) return parsed;
    } catch { /* No server packet. */ }
  }
}

export default {
  id: "omatic-governance",
  name: "o-MATIC Server Connection",
  description: "Scope o-MATIC MCP tool calls to exact OpenClaw sessions",
  register(api) {
    // OpenClaw lowercases tool-policy names before invoking native hooks.
    const exactNames = new Map(Object.entries(api.pluginConfig?.toolNames ?? {})
      .map(([name, tool]) => [name.toLowerCase(), tool]));
    const identify = (name) => {
      if (typeof name !== "string") return;
      const normalized = name.toLowerCase();
      return exactNames.get(normalized) ?? normalized.match(
        /^(?:mcp__o_matic_server__|mcp__codex_apps__o_matic_server_mcp__?|o-matic-server(?:__|\.))([a-z_]+)$/)?.[1];
    };
    const scopedReads = new Set(["db_health_snapshot", "factory_web_status", "ladder_status",
      "proposal_vault_list", "proposal_vault_get", "proposal_vault_trash_list",
      "slate_canvas_open", "slate_asset_get", "slate_entity_search", "slate_entity_verify",
      "slate_proposal_list", "slate_scene_observe", "task_duplicate_check", "task_relationships",
      "ocr_result_get", "vision_page_get"]);
    // These report server-scoped state, not factory evidence or permission.
    const serverReads = new Set(["module_status", "observability_snapshot", "embed_query",
      "mom_summary", "mom_network_inventory", "mom_trends", "mom_compliance_posture"]);
    const receiptReads = new Set(["workflow_status", "workflow_mutation_status"]);
    const supported = new Set([...bootstrap, ...scopedReads, ...receiptReads, "search", "factory_query", "factory_owner_ddl",
      "work_claim_acquire", "work_claim_release", "kernel_session_open", "kernel_session_get",
      "kernel_plan_update", "kernel_delegate", "kernel_return", "kernel_session_close"]);
    const audit = (stage, ctx, tool, connection) => api.logger?.info?.(
      JSON.stringify({ component: "omatic-governance", stage, agentId: ctx?.agentId,
        tool, connection }));
    const connections = new Set(api.pluginConfig?.connections ?? []);
    const factoryMap = api.pluginConfig?.agentFactoryMap ?? {};
    const agentIds = Array.isArray(api.pluginConfig?.agentIds) ? new Set(api.pluginConfig.agentIds) : undefined;
    const enrolled = (ctx) => !agentIds || agentIds.has(ctx?.agentId);
    const grants = new Map();
    const activeFactories = new Map();
    const turns = new Map();
    const pending = new Map();
    const delegations = new Map();
    const origins = new Map();
    const maxEntries = 2048;
    const keyFor = (key, connection) => JSON.stringify([key, connection]);
    const runFor = (event, ctx) => {
      const key = conversation(ctx);
      const run = ctx?.runId ?? event?.runId;
      return key && typeof run === "string" && run ? keyFor(key, run) : undefined;
    };
    const trim = (map) => { if (map.size > maxEntries) map.delete(map.keys().next().value); };
    const turnFor = (event, ctx, connection) => {
      const id = runFor(event, ctx);
      if (!id) return;
      let turn = turns.get(id);
      if (!turn) { turn = { connections: new Set(), retrieved: new Set() }; turns.set(id, turn); trim(turns); }
      if (connection) turn.connections.add(connection);
      return turn;
    };

    // Explicitly enrolled agents are factory-scoped even on a zero-tool turn.
    // No text heuristic, model/provider change, agent spawn, or global exemption.
    api.on("before_prompt_build", (event, ctx) => {
      if (!enrolled(ctx)) return;
      const connection = activeFactories.get(conversation(ctx)) ?? factoryMap[ctx?.agentId];
      const explicitArgs = "For explicit o-MATIC operations on every host, supply this conversation_key on tools whose schema accepts it, and your own startup_proof on guarded search/factory_query calls, before approval. This adapter validates but never rewrites tool arguments. Keep proof in tool arguments only, never echo or persist it. READY and a successful known read do not verify tools/list or workflow completion. Ordinary acknowledgments need no factory calls; do not repeat startup/search to repair a discovery warning.";
      if (!connections.has(connection)) {
        const key = conversation(ctx);
        if (key) return { prependContext: `o-MATIC governance is enabled. Conversation key: ${key}. No default factory is selected; preserve any operator-selected factory and do not invent one. For an explicit factory operation or official workflow status, select an authorized factory and verify its evidence; do not create an automatic evidence-read/reply loop. ${explicitArgs} Use existing full agents; this plugin does not dispatch agents.` };
        return;
      }
      const turn = turnFor(event, ctx, connection);
      if (turn) turn.defaultConnection = connection;
      if (turn && typeof event.currentUserMessageId === "string"
          && turn.admission !== event.currentUserMessageId) {
        turn.admission = event.currentUserMessageId;
        turn.retrieved.clear();
      }
      const key = conversation(ctx);
      if (key) return { prependContext: `o-MATIC factory: ${connection}. Conversation key: ${key}. Verify startup/evidence for explicit factory operations or official workflow status, not ordinary acknowledgments. ${explicitArgs} Use existing full agents; this plugin does not dispatch agents.` };
    });

    api.on("before_tool_call", (event, ctx) => {
      if (!enrolled(ctx)) return;
      const tool = identify(event.toolName);
      if (!tool) return;
      const connection = receiptReads.has(tool) ? event.params?.factory : event.params?.connection;
      if (tool === "omatic_guide" || tool === "connections_list" || serverReads.has(tool)) return;
      if (!supported.has(tool)) return block("o-MATIC: tool has not been reviewed for governance coverage: " + tool);
      if (!connections.has(connection)) return block("o-MATIC: select an explicitly configured factory connection");
      audit("before", ctx, tool, connection);
      const key = conversation(ctx);
      if (!key) return block("o-MATIC: OpenClaw did not provide the exact conversation context");
      if (event.params.conversation_key && event.params.conversation_key !== key) {
        return block("o-MATIC: use this OpenClaw conversation's own factory startup");
      }
      const params = event.params;
      if ((tool === "startup" || tool === "search" || tool === "factory_query" || tool.startsWith("kernel_") || receiptReads.has(tool))
          && params.conversation_key !== key) {
        return block("o-MATIC: supply this conversation key before approval; native parameters cannot be rewritten");
      }
      const slot = keyFor(key, connection);
      const turn = turnFor(event, ctx, connection);
      if (turn?.defaultConnection && turn.defaultConnection !== connection) {
        turn.connections.delete(turn.defaultConnection);
        turn.defaultConnection = undefined;
      }
      if (tool === "startup") {
        activeFactories.set(key, connection); trim(activeFactories);
        grants.delete(slot);
        turn?.retrieved.delete(connection);
        if (typeof event.toolCallId !== "string" || !event.toolCallId) return block("o-MATIC: startup requires a host-correlated tool call ID");
        pending.set(slot, event.toolCallId); trim(pending);
        return; // Approval-bound parameters remain unchanged.
      }
      if (bootstrap.has(tool)) return;
      if (tool === "kernel_plan_update" && (ctx.agentId !== "probot"
          || /:subagent:/.test(ctx.sessionKey))) {
        return block("o-MATIC: only the existing Probot desk may update its plan");
      }
      // A role name and a work claim are NOT operator approval of exact SQL.
      // Until a server-authenticated approval bridge exists, fail closed.
      if (tool === "factory_owner_ddl" || (tool === "factory_query" && !cleanRead(params.sql))) {
        return block("o-MATIC: exact-SQL operator approval is not integrated; no database mutation is authorized by this adapter");
      }
      const entry = grants.get(slot);
      if (!entry || entry.expires <= Date.now()) {
        grants.delete(slot);
        return block("o-MATIC: run READY startup on this factory in the current conversation");
      }
      // Do not add private proof/key fields to tools whose schemas do not accept them.
      if (scopedReads.has(tool)) return;
      if ((tool === "search" || tool === "factory_query" || receiptReads.has(tool)) && (!isProof(params.startup_proof)
          || createHash("sha256").update(params.startup_proof).digest("hex") !== entry.proofDigest)) {
        return block("o-MATIC: supply your own current startup proof before approval; parameters are not rewritten");
      }
      return;
    });

    api.on("after_tool_call", (event, ctx) => {
      if (!enrolled(ctx)) return;
      const tool = identify(event.toolName);
      const key = conversation(ctx);
      const connection = receiptReads.has(tool) ? event.params?.factory : event.params?.connection;
      if (!key || !connections.has(connection)) return;
      const slot = keyFor(key, connection);
      const out = event.error ? undefined : packet(event.result);
      const turn = turnFor(event, ctx, connection);
      if (tool === "search" && out && !out.reason_code
          && ["hybrid", "vector_only", "no_rows"].includes(out.retrieval)) {
        turn?.retrieved.add(connection);
        audit("retrieved", ctx, tool, connection);
      }
      if (tool === "factory_query" && targetedRead(event.params?.sql)
          && out && Array.isArray(out.rows) && Array.isArray(out.columns)) {
        turn?.retrieved.add(connection);
        audit("retrieved", ctx, tool, connection);
      }
      if (tool === "kernel_delegate" && out?.delegation_id && out.kernel_state === "active"
          && typeof out.kernel_session_id === "string" && !out.reason_code) {
        let open = delegations.get(slot);
        if (!open) { open = new Set(); delegations.set(slot, open); trim(delegations); }
        open.add(String(out.delegation_id));
        origins.set(keyFor(connection, String(out.delegation_id)), { slot, kernel: out.kernel_session_id });
        trim(origins);
      }
      if (tool === "kernel_return" && out?.delegation_id
          && (out.status === "returned" || out.delegation_state === "returned")) {
        const id = keyFor(connection, String(out.delegation_id));
        const origin = origins.get(id);
        // A full peer returns in its own conversation. Close the originating
        // desk's item only when the server verifies the same origin kernel.
        if (origin && out.delegation_kernel_session_id === origin.kernel) {
          delegations.get(origin.slot)?.delete(String(out.delegation_id));
          origins.delete(id);
        }
      }
      if (tool === "kernel_session_close") {
        if (out?.kernel_state === "closed") { grants.delete(slot); delegations.delete(slot); }
        return;
      }
      if (tool !== "startup") return;
      // Ignore responses with no matching observed invocation. Prevent a late
      // successful startup from overwriting the result of a newer startup.
      if (!pending.has(slot) || pending.get(slot) !== event.toolCallId) return;
      pending.delete(slot);
      grants.delete(slot);
      if (out?.state !== "READY" || out.connection !== connection
          || out.kernel?.addressing !== "conversation_key"
          || out.kernel?.kernel_state !== "active" || !isProof(out.startup_proof)) return;
      const ttl = out.startup_proof_expires_in_seconds;
      if (!(Number.isInteger(ttl) && ttl > 0 && ttl <= 3600)) return;
      grants.delete(slot);
      grants.set(slot, { proofDigest: createHash("sha256").update(out.startup_proof).digest("hex"), expires: Date.now() + ttl * 1000 });
      audit("ready", ctx, tool, connection);
      if (grants.size > maxEntries) grants.delete(grants.keys().next().value);
    });
    // Official workflow completion belongs to authenticated backend receipts.
    // Do not force generic Stop/finalize retries for ordinary replies.
    api.on("agent_end", (event, ctx) => { const id = runFor(event, ctx); if (id) turns.delete(id); });
    api.on("gateway_stop", () => { grants.clear(); activeFactories.clear(); turns.clear(); pending.clear(); delegations.clear(); origins.clear(); });
  },
};
