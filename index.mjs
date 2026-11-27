import { createHash } from "node:crypto";
import { decideWorkflow } from "./workflow.mjs";
import { createReceiptVerifier } from "./receipt-contract.mjs";
import { createPeerMemory } from "./peer-memory.mjs";
import { classifySql } from "./sql-classify.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export function conversationKey(ctx) {
  if (!ctx?.agentId || !ctx?.sessionKey) return undefined;
  // Preserve the existing adapter's stable host-session mapping, not a model key.
  return `openclaw:${digest(JSON.stringify([ctx.agentId, ctx.sessionKey]))}`;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function parsedText(result) {
  if (typeof result === "string") return result;
  const items = Array.isArray(result) ? result : result?.content;
  return items?.find((item) => item?.type === "text")?.text;
}
function packet(result) {
  // Server tools/call success is { content:[{type:text,text:json}], structuredContent, isError:false }.
  // isError and JSON-RPC error are execution failures, not kernel records.
  if (!result || result.isError === true || object(result.error)) return undefined;
  const text = parsedText(result);
  let parsed;
  if (typeof text === "string" && text.length <= 100000) {
    try {
      const value = JSON.parse(text.replace(/^structuredContent:\s*\n/, ""));
      if (object(value) && value.isError !== true) parsed = value;
    } catch { parsed = undefined; }
  }
  const structured = object(result.structuredContent) && result.structuredContent.isError !== true
    ? result.structuredContent : undefined;
  if (structured && parsed && stable(structured) !== stable(parsed)) return undefined;
  if (structured) return structured;
  if (parsed) return parsed;
  if (typeof result === "string") return undefined;
  if (object(result) && (typeof result.state === "string" || typeof result.kernel_state === "string")) return result;
  return undefined;
}
export function toolEffect(name) {
  if (name === "kernel_delegate" || name === "kernel_return") return "mutation";
  if (name === "factory_query") return "guarded_read";
  return "other";
}
const deny = (blockReason) => ({ block: true, blockReason });
const proofShape = /^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/;
const schema = { type: "object", properties: { taskRef: {
  type: "object", required: ["factory", "taskId", "taskRevision"], additionalProperties: false,
  properties: { factory: { type: "string", minLength: 1, maxLength: 256 },
    taskId: { type: "string", minLength: 1, maxLength: 256 }, taskRevision: { type: "integer", minimum: 1 } },
} }, additionalProperties: false };

export default {
  id: "omatic-governance",
  name: "o-MATIC Server Connection",
  register(api) {
    const config = api.pluginConfig ?? {};
    const connections = new Set(config.connections ?? []);
    const agents = config.agentIds ? new Set(config.agentIds) : undefined;
    const names = new Map(Object.entries(config.toolNames ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const owners = config.toolOwners ?? {};
    const states = new Map();
    const peers = createPeerMemory();
    const maxEntries = 512;
    const slot = (ctx, connection) => JSON.stringify([ctx.agentId, ctx.sessionKey, ctx.sessionId ?? null, connection]);
    const enrolled = (ctx) => Boolean(conversationKey(ctx)) && (!agents || agents.has(ctx.agentId));
    const stateFor = (ctx, connection) => {
      const id = slot(ctx, connection);
      if (!states.has(id)) {
        states.set(id, {});
        if (states.size > maxEntries) {
          const oldest = states.keys().next().value;
          if (oldest !== id) {
            states.delete(oldest);
            peers.invalidateSlot(oldest, "state_evicted");
          }
        }
      }
      return states.get(id);
    };
    const known = new Set(["startup", "connections_list", "omatic_guide", "search", "kernel_session_get", "factory_query"]);
    const mutations = new Set(["kernel_delegate", "kernel_return"]);
    // Supported reads already named by the previous package guard. Not grants.
    const serverReads = new Set(["module_status", "observability_snapshot", "embed_query", "mom_summary", "mom_network_inventory", "mom_trends", "mom_compliance_posture"]);
    const scopedReads = new Set(["db_health_snapshot", "factory_web_status", "ladder_status", "proposal_vault_list", "proposal_vault_get", "proposal_vault_trash_list", "slate_canvas_open", "slate_asset_get", "slate_entity_search", "slate_entity_verify", "slate_proposal_list", "slate_scene_observe", "task_duplicate_check", "task_relationships", "ocr_result_get", "vision_page_get"]);

    const now = () => Date.now();

    api.on("before_prompt_build", (_event, ctx) => {
      if (!enrolled(ctx)) return;
      return { prependContext: `For explicit o-MATIC operations, use conversation_key ${conversationKey(ctx)}. Supply all schema-supported arguments before approval; this adapter does not rewrite them. Use only your own startup proof in guarded tool arguments; never echo or persist it. READY does not establish current tool discovery or workflow completion. Ordinary acknowledgments need no factory operation. Existing full-agent coordination remains model-led.` };
    });

    api.on("before_tool_call", (event, ctx) => {
      if (!enrolled(ctx)) return;
      const tool = names.get(event.toolName?.toLowerCase());
      if (!tool) return; // Exact configured aliases only; no guessed provider names.
      if (owners[tool] && !owners[tool].includes(ctx.agentId)) return deny("o-MATIC: dedicated operation belongs to a different configured executor");
      if (tool === "connections_list" || tool === "omatic_guide" || serverReads.has(tool)) return;
      const args = event.params;
      if (!connections.has(args?.connection)) return deny("o-MATIC: select an explicitly configured factory connection");
      // Scoped reads keep the previous package contract: connection and READY,
      // not a conversation key. Every other guarded call must use the host key.
      if (!scopedReads.has(tool) && args.conversation_key !== conversationKey(ctx)) return deny("o-MATIC: supply this host conversation's exact key before approval");
      // kernel_delegate and kernel_return are mutations. The Server authorizes
      // them from the authenticated client: read_only refusal, probot binding,
      // and roster role. READY is not that authorization. No extra local
      // approval gate is added. Client-supplied authority is not accepted.
      if (mutations.has(tool)) return;
      // This candidate deliberately enables only verified read contracts.
      // No generic SQL classifier is treated as authorization.
      if (!known.has(tool) && !scopedReads.has(tool)) return deny("o-MATIC: operation is outside this read-only candidate's verified contract");
      // Same split as the Server classifier. A read is not certified safe.
      // Write and destructive calls stop here; startup does not approve them.
      if (tool === "factory_query" && classifySql(args.sql) !== "read") return deny("o-MATIC: exact-SQL operator approval is not integrated; no database mutation is authorized by this adapter");
      const state = stateFor(ctx, args.connection);
      if (tool === "startup") {
        peers.invalidateSlot(slot(ctx, args.connection), "startup_reset");
        Object.keys(state).forEach((key) => delete state[key]);
        if (!event.toolCallId) return deny("o-MATIC: correlated startup invocation required");
        state.pending = event.toolCallId;
        return; // Never return params, even an apparently identical copy.
      }
      if (state.readiness !== "READY" || !(state.expires > now())) return deny("o-MATIC: fresh correlated READY startup required");
      // Existing readable kernel contract does not accept startup_proof.
      if (scopedReads.has(tool)) return;
      if ((tool === "search" || tool === "factory_query") && (!proofShape.test(args.startup_proof ?? "")
          || digest(args.startup_proof) !== state.proofDigest)) return deny("o-MATIC: use the proof returned by your own startup before approval");
      if (tool === "kernel_session_get" && args.role_id !== ctx.agentId) return deny("o-MATIC: read the kernel as the actual host executor");
    });

    api.on("after_tool_call", (event, ctx) => {
      if (!enrolled(ctx)) return;
      const tool = names.get(event.toolName?.toLowerCase());
      if (!connections.has(event.params?.connection) || event.params.conversation_key !== conversationKey(ctx)) return;
      const out = event.error ? undefined : packet(event.result);
      if (tool === "kernel_delegate") {
        peers.rememberDelegation(slot(ctx, event.params.connection), event.params.connection, out, now());
        return;
      }
      if (tool === "kernel_return") {
        // A peer may close from another conversation. Match the delegation's
        // origin kernel, never the kernel that closed it.
        peers.observeReturn(event.params.connection, out, now());
        return;
      }
      if (tool !== "startup") return;
      const state = stateFor(ctx, event.params.connection);
      if (!state.pending || state.pending !== event.toolCallId) return;
      delete state.pending;
      if (out?.state !== "READY" || out.connection !== event.params.connection
          || out.kernel?.kernel_state !== "active" || out.kernel.addressing !== "conversation_key"
          || !proofShape.test(out.startup_proof ?? "")) return;
      const ttl = out.startup_proof_expires_in_seconds;
      if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 3600) return;
      state.readiness = "READY";
      state.expires = now() + ttl * 1000;
      state.proofDigest = digest(out.startup_proof); // Do not retain the private proof.
      const surface = out.session_tool_surface;
      state.surface = surface?.state === "CURRENT" && surface.this_session_listed_by_this_process === true
        ? "CURRENT" : "UNVERIFIED";
      // A successful known read remains permitted when discovery is unverified;
      // it does not upgrade the whole catalog to CURRENT.
    });

    api.registerTool({ contextVersion: 2, create(ctx) {
      if (!enrolled(ctx)) return null;
      // No unsupported external-plugin MCP invoker or model-provided reader.
      // The authenticated backend adapter remains unbound until its real public
      // interface exists. The complete validator is nevertheless called here.
      const verifyReceipt = createReceiptVerifier({ assertCurrent: () => ctx.assertInvocationCurrent() });
      return { name: "omatic_workflow_status", label: "o-MATIC workflow status",
        description: "Explicit readiness/discovery status; never creates completion evidence or sends work.",
        parameters: schema,
        execute: async (_id, args) => {
          ctx.assertInvocationCurrent();
          if (!object(args) || Object.keys(args).some((key) => key !== "taskRef")) throw new Error("No model-supplied status, actor, or receipt arguments are accepted");
          if (args.taskRef !== undefined) {
            if (!object(args.taskRef) || !connections.has(args.taskRef.factory)) {
              return { content: [{ type: "text", text: JSON.stringify({ status: "refused",
                reason: "unconfigured_factory_reference", automaticRetry: false }) }] };
            }
            const result = await verifyReceipt(args.taskRef);
            ctx.assertInvocationCurrent();
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          }
          const factories = [...connections].map((connection) => {
            const state = states.get(slot(ctx, connection));
            const readiness = state?.expires > now() ? state.readiness : "UNVERIFIED";
            const surface = state?.expires > now() ? state.surface : "UNVERIFIED";
            peers.tick(now());
            return { connection, readiness, toolSurface: surface,
              volatileOpenDelegations: peers.openCount(slot(ctx, connection)),
              ...decideWorkflow({ readiness, surface }) };
          });
          ctx.assertInvocationCurrent();
          return { content: [{ type: "text", text: JSON.stringify({ status: "blocked", factories,
            backendReceiptBinding: "unavailable", universalChatEnforcement: false,
            delegationObservation: "volatile_process_only",
            durableDelegationRecord: "server_ledger_not_read_or_written_here",
            kernelMutationAdmission: "server_policy_not_local_ready",
            volatileUnresolvedDelegations: peers.unresolvedCount(),
            matchedReturnObservations: peers.matchedReturnCount() }) }] };
        } };
    } }, { name: "omatic_workflow_status" });
    // Deliberately no Stop, before_agent_finalize, or automatic dispatch hook.
    api.on("gateway_stop", () => { states.clear(); peers.clear(); });
  },
};
