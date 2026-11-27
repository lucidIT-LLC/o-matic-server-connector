import { hostCanIntercept } from "./server-contract.mjs";

const proofShape = /^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/;
const proofText = /v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}/g;
const TIERS = new Set(["documents", "semantic"]);

// Read adapter only. Orchestration writes stay closed until a separate approval.
export const orchestrationGate = Object.freeze({
  complete: false,
  execute: "closed",
  reason: "explicit_server_write_approval_required",
  delegate: "Server kernel_delegate refuses a read_only client and requires a probot binding plus an active target role.",
  return: "Server kernel_return allows the delegation target role to close it. The closing kernel is not the origin.",
});

function knownHost(host) {
  return hostCanIntercept(host) || host === "grok" || host === "m365-copilot";
}

function outboundSearch(args) {
  if (typeof args?.connection !== "string" || args.connection.length === 0) return { ok: false, reason: "connection_required" };
  if (typeof args.query !== "string" || args.query.length === 0) return { ok: false, reason: "query_required" };
  if (typeof args.conversation_key !== "string" || args.conversation_key.length === 0) return { ok: false, reason: "conversation_key_required" };
  if (!proofShape.test(args.startup_proof ?? "")) return { ok: false, reason: "startup_proof_required" };
  const arguments_ = {
    connection: args.connection, query: args.query,
    conversation_key: args.conversation_key, startup_proof: args.startup_proof,
  };
  if (args.tenant_id !== undefined) {
    if (typeof args.tenant_id !== "string" || args.tenant_id.length === 0) return { ok: false, reason: "tenant_invalid" };
    arguments_.tenant_id = args.tenant_id;
  }
  if (args.limit !== undefined) {
    if (!Number.isInteger(args.limit) || args.limit < 1) return { ok: false, reason: "limit_invalid" };
    arguments_.limit = args.limit;
  }
  if (args.tier !== undefined) {
    if (!TIERS.has(args.tier)) return { ok: false, reason: "tier_invalid" };
    arguments_.tier = args.tier;
  }
  return { ok: true, call: { tool: "search", arguments: arguments_ } };
}

function outboundKernelGet(args) {
  if (typeof args?.connection !== "string" || args.connection.length === 0) return { ok: false, reason: "connection_required" };
  if (typeof args.role_id !== "string" || args.role_id.length === 0) return { ok: false, reason: "role_required" };
  if (typeof args.conversation_key !== "string" || args.conversation_key.length === 0) return { ok: false, reason: "conversation_key_required" };
  return { ok: true, call: { tool: "kernel_session_get", arguments: {
    connection: args.connection, role_id: args.role_id, conversation_key: args.conversation_key,
  } } };
}

export function serverCall(host, tool, args) {
  if (!knownHost(host)) throw new Error("unknown host");
  if (tool === "kernel_delegate" || tool === "kernel_return" || tool === "kernel_plan_update") {
    return { admitted: false, reason: "not_this_read_adapter", orchestrationGate };
  }
  const built = tool === "search" ? outboundSearch(args) : tool === "kernel_session_get" ? outboundKernelGet(args) : { ok: false, reason: "unsupported_interface" };
  if (!built.ok) return { admitted: false, reason: built.reason };
  return {
    admitted: true,
    interceptedBeforeServer: hostCanIntercept(host),
    serverEffect: tool === "search" ? "retrieval_events_insert" : "select",
    tool,
  };
}

function redact(value) {
  if (typeof value === "string") return value.replace(proofText, "[redacted]");
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "startup_proof" || key === "call" || key === "arguments") continue;
      const cleaned = redact(item);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function refused(body) {
  if (!body || typeof body !== "object") return false;
  if (body.isError === true || body.error) return true;
  if (body.status === "refused" || body.kernel_state === "unavailable" || body.kernel_state === "refused") return true;
  if (typeof body.reason_code === "string" && body.kernel_state !== "absent") return true;
  return false;
}

export async function executeServerCall(host, tool, args, transport) {
  const planned = serverCall(host, tool, args);
  if (!planned.admitted) return planned;
  const built = tool === "search" ? outboundSearch(args) : outboundKernelGet(args);
  if (typeof transport !== "function") throw new Error("transport_required");
  let envelope;
  try {
    envelope = await transport(built.call);
  } catch (error) {
    return redact({ admitted: true, ok: false, reason: "server_error", detail: String(error?.message ?? error) });
  }
  const body = envelope?.structuredContent ?? envelope;
  if (!body || refused(body) || refused(envelope)) {
    return redact({ admitted: true, ok: false, reason: "server_refused", body });
  }
  return redact({
    admitted: true, ok: true, interceptedBeforeServer: planned.interceptedBeforeServer,
    serverEffect: planned.serverEffect, body,
  });
}

export function executeOrchestration() {
  return { executed: false, reason: orchestrationGate.reason, orchestrationGate };
}
