// index.mjs
import { createHash as createHash2 } from "node:crypto";

// workflow.mjs
function decideWorkflow({ readiness, surface, receiptCapability = false }) {
  if (readiness !== "READY")
    return {
      status: "blocked",
      reason: "ready_startup_required",
      automaticRetry: false,
      next: "Run one startup for an explicit factory operation; ordinary acknowledgments need no factory call."
    };
  if (surface !== "CURRENT")
    return {
      status: "blocked",
      reason: "tool_surface_unverified",
      automaticRetry: false,
      resumeWhen: "same_session_tools_list_observed_by_server",
      next: "Connection owner must diagnose or reconnect the existing MCP session. Repeating startup/search or CLI reload does not repair this measurement."
    };
  if (!receiptCapability)
    return {
      status: "blocked",
      reason: "authenticated_workflow_receipts_unavailable",
      automaticRetry: false,
      resumeWhen: "authenticated_receipt_reader_bound",
      next: "Bind verified server task/evidence/coordinator-acceptance operations before enabling completion."
    };
  return { status: "pending", reason: "verified_completion_receipt_required", automaticRetry: false };
}
var hostContracts = Object.freeze({
  codex: Object.freeze({
    acceptance: "pending",
    connection: "existing host-managed MCP connection",
    argumentMode: "explicit-before-approval",
    universalFinalBlock: false
  }),
  "m365-copilot": Object.freeze({
    acceptance: "pending",
    connection: "RemoteMCPServer with existing Entra connection",
    coordination: "worker_agents referencing acquired registered title IDs; IDs not supplied",
    argumentMode: "explicit-server-tools",
    universalFinalBlock: false
  }),
  grok: Object.freeze({
    acceptance: "pending",
    connection: "remote MCP URL only",
    localAdapter: false,
    argumentMode: "server-request",
    universalFinalBlock: false
  })
});

// receipt-contract.mjs
import { createHash } from "node:crypto";
var CONTRACT = "omatic.workflow-receipt/2";
var PROVENANCE = ["hostId", "sessionId", "sessionIncarnation", "runId", "correlationId"];
var EVIDENCE_FIELDS = [
  "operationId",
  "receiptId",
  "principalId",
  "executorRole",
  "taskRevision",
  "artifactId",
  "artifactVersion",
  "artifactSha256",
  "readbackVersion",
  "readbackSha256",
  "execution",
  "approvalRef",
  "assignmentId",
  "acceptedInputId",
  "returnReceiptId",
  "parentRunId",
  "parentCorrelationId",
  "parentSessionIncarnation",
  ...PROVENANCE
];
var ACCEPTANCE_FIELDS = ["receiptId", "principalId", "executorRole", "taskRevision", "stateVersion", "decision", "evidenceDigest", "approvalRef", ...PROVENANCE];
var COMPLETION_FIELDS = ["receiptId", "principalId", "executorRole", "stateVersion", "acceptanceDigest", "approvalRef", ...PROVENANCE];
var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var text = (v) => typeof v === "string" && v.length > 0 && Array.from(v).length <= 256 && v.isWellFormed();
var revision = (v) => Number.isSafeInteger(v) && v > 0;
var sha = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var outcome = (status, reason, extra = {}) => ({ status, reason, automaticRetry: false, ...extra });
var compare = (a, b) => {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0;i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d)
      return d;
  }
  return x.length - y.length;
};
function evidenceDigest(record) {
  const requirements = record.requirements.map((r) => [r.operationId, r.ownerRole]).sort((a, b) => compare(a[0], b[0]));
  const evidence = record.evidence.map((e) => EVIDENCE_FIELDS.map((k) => e[k])).sort((a, b) => compare(a[0], b[0]));
  return createHash("sha256").update(JSON.stringify([
    "omatic.workflow-evidence/2",
    record.factory,
    record.principalId,
    record.taskId,
    record.taskRevision,
    record.policyRevision,
    record.initialApprovalRef,
    record.coordinatorRole,
    PROVENANCE.map((k) => record.origin[k]),
    requirements,
    evidence
  ])).digest("hex");
}
var acceptanceDigest = (s) => createHash("sha256").update(JSON.stringify(["omatic.workflow-acceptance/2", s.factory, s.principalId, s.taskId, s.taskRevision, s.policyRevision, ACCEPTANCE_FIELDS.map((k) => s.acceptance[k])])).digest("hex");
var completionDigest = (s) => createHash("sha256").update(JSON.stringify(["omatic.workflow-completion/2", s.factory, s.principalId, s.taskId, s.taskRevision, s.policyRevision, COMPLETION_FIELDS.map((k) => s.completion[k])])).digest("hex");
function evaluateVerifiedSnapshot(s, expected, now = Date.now()) {
  if (!object(s) || s.contract !== CONTRACT)
    return outcome("blocked", "unsupported_receipt_contract");
  if (s.factory !== expected.factory || s.taskId !== expected.taskId)
    return outcome("refused", "receipt_scope_mismatch");
  if (!revision(s.taskRevision) || s.taskRevision !== expected.taskRevision)
    return outcome("blocked", "stale_task_revision");
  if (!revision(s.version) || !revision(s.policyRevision))
    return outcome("blocked", "invalid_state_or_policy_revision");
  if (!Number.isSafeInteger(s.observedAt) || !Number.isSafeInteger(s.expiresAt) || s.observedAt > now || s.expiresAt <= now || s.expiresAt <= s.observedAt || s.expiresAt - s.observedAt > 60000)
    return outcome("blocked", "receipt_snapshot_not_current");
  if (s.grantState !== "current")
    return outcome("refused", "current_backend_grants_required");
  if (s.taskState === "cancelled")
    return outcome("refused", "task_cancelled");
  if (s.taskState === "failed")
    return outcome("blocked", "task_failed");
  if (!["active", "completed"].includes(s.taskState))
    return outcome("blocked", "unknown_task_state");
  if (!text(s.principalId))
    return outcome("blocked", "authenticated_principal_required");
  if (!text(s.initialApprovalRef))
    return outcome("blocked", "operation_approval_reference_required");
  if (s.executorBinding !== "verified-host-execution")
    return outcome("blocked", "executor_unverified");
  if (!text(s.coordinatorRole))
    return outcome("blocked", "coordinator_binding_required");
  if (!object(s.origin) || PROVENANCE.some((k) => !text(s.origin[k])))
    return outcome("blocked", "executor_unverified");
  if (!Array.isArray(s.requirements) || !s.requirements.length || s.requirements.length > 64 || !Array.isArray(s.evidence) || s.evidence.length > 64)
    return outcome("blocked", "invalid_operation_requirements");
  const requirements = new Map, receipts = new Set, seen = new Set;
  for (const r of s.requirements) {
    if (!object(r) || Object.keys(r).length !== 2 || !text(r.operationId) || !text(r.ownerRole) || requirements.has(r.operationId))
      return outcome("blocked", "ambiguous_operation_owner_binding");
    requirements.set(r.operationId, r.ownerRole);
  }
  for (const e of s.evidence) {
    if (!object(e) || !text(e.operationId) || !text(e.receiptId) || seen.has(e.operationId) || receipts.has(e.receiptId) || !requirements.has(e.operationId))
      return outcome("blocked", "ambiguous_evidence_receipt");
    seen.add(e.operationId);
    receipts.add(e.receiptId);
    if (e.principalId !== s.principalId || e.executorRole !== requirements.get(e.operationId))
      return outcome("refused", "wrong_operation_executor");
    if (e.taskRevision !== s.taskRevision)
      return outcome("blocked", "stale_artifact_revision");
    if (e.execution !== "succeeded")
      return outcome("pending", "operation_not_succeeded");
    if (EVIDENCE_FIELDS.some((k) => !["taskRevision", "artifactVersion", "readbackVersion"].includes(k) && !text(e[k])))
      return outcome("blocked", "executor_unverified");
    if (!revision(e.artifactVersion) || e.readbackVersion !== e.artifactVersion)
      return outcome("blocked", "artifact_version_mismatch");
    if (e.parentRunId !== s.origin.runId || e.parentCorrelationId !== s.origin.correlationId || e.parentSessionIncarnation !== s.origin.sessionIncarnation)
      return outcome("blocked", "receipt_parent_correlation_mismatch");
    if (!sha(e.artifactSha256) || e.artifactSha256 !== e.readbackSha256)
      return outcome("blocked", "artifact_readback_mismatch");
  }
  if (seen.size !== requirements.size)
    return outcome("pending", "required_operation_evidence_missing");
  const a = s.acceptance;
  if (!object(a))
    return outcome("pending", "coordinator_review_required");
  if (a.principalId !== s.principalId || a.executorRole !== s.coordinatorRole)
    return outcome("refused", "wrong_accepting_executor");
  if (PROVENANCE.some((k) => !text(a[k])))
    return outcome("blocked", "executor_unverified");
  if (a.taskRevision !== s.taskRevision || a.evidenceDigest !== evidenceDigest(s))
    return outcome("blocked", "stale_coordinator_acceptance");
  if (!revision(a.stateVersion) || a.stateVersion > s.version || !text(a.approvalRef))
    return outcome("blocked", "invalid_acceptance_fields");
  if (!text(a.receiptId))
    return outcome("blocked", "acceptance_receipt_required");
  if (Object.keys(a).some((k) => ![...ACCEPTANCE_FIELDS, "acceptanceDigest"].includes(k)) || a.acceptanceDigest !== acceptanceDigest(s))
    return outcome("blocked", "acceptance_digest_mismatch");
  if (receipts.has(a.receiptId))
    return outcome("blocked", "receipt_type_replay");
  if (a.decision === "rejected")
    return outcome("refused", "coordinator_rejected");
  if (a.decision !== "accepted")
    return outcome("pending", "coordinator_review_required");
  if (s.taskState !== "completed" || !text(s.completionReceiptId))
    return outcome("pending", "server_completion_commit_required");
  if (s.completionReceiptId === a.receiptId || receipts.has(s.completionReceiptId))
    return outcome("blocked", "receipt_type_replay");
  const c = s.completion;
  if (!object(c) || COMPLETION_FIELDS.some((k) => k !== "stateVersion" && !text(c[k])) || !revision(c.stateVersion) || c.stateVersion > s.version || c.stateVersion < a.stateVersion)
    return outcome("blocked", "invalid_completion_fields");
  if (c.receiptId !== s.completionReceiptId || c.principalId !== s.principalId || c.executorRole !== s.coordinatorRole || c.acceptanceDigest !== a.acceptanceDigest || Object.keys(c).some((k) => ![...COMPLETION_FIELDS, "completionDigest"].includes(k)) || c.completionDigest !== completionDigest(s))
    return outcome("blocked", "completion_digest_mismatch");
  const delivery = object(s.delivery) && ["delivered", "not_delivered", "ambiguous", "unverified"].includes(s.delivery.status) && (s.delivery.status !== "delivered" || text(s.delivery.receiptId)) ? s.delivery.status : "unverified";
  return outcome("completed", "verified_task_completion", {
    taskRevision: s.taskRevision,
    completionReceiptId: s.completionReceiptId,
    evidenceDigest: a.evidenceDigest,
    delivery: { status: delivery }
  });
}
function createReceiptVerifier({ readVerifiedSnapshot, assertCurrent, now = Date.now, timeoutMs = 1000 } = {}) {
  if (typeof assertCurrent !== "function")
    throw new Error("Code-owned current-invocation guard required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error("Bounded receipt-read deadline required");
  const checkCurrent = () => {
    const result = assertCurrent();
    if (result !== undefined) {
      if (result && typeof result.then === "function")
        Promise.resolve(result).catch(() => {});
      throw new Error("Current-invocation guard must synchronously return void or throw");
    }
  };
  return async function verify(expected) {
    checkCurrent();
    if (!object(expected) || !text(expected.factory) || !text(expected.taskId) || !revision(expected.taskRevision) || Object.keys(expected).some((k) => !["factory", "taskId", "taskRevision"].includes(k)))
      return outcome("refused", "lookup_reference_only");
    if (typeof readVerifiedSnapshot !== "function")
      return outcome("blocked", "authenticated_receipt_reader_unavailable");
    const controller = new AbortController, deadline = Symbol("deadline");
    let timer;
    try {
      const snapshot = await Promise.race([
        Promise.resolve().then(() => readVerifiedSnapshot(Object.freeze({ ...expected }), { signal: controller.signal })),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(deadline);
          }, timeoutMs);
        })
      ]);
      checkCurrent();
      if (snapshot === deadline)
        return outcome("pending", "receipt_read_deadline", { remoteOutcome: "unknown" });
      return evaluateVerifiedSnapshot(snapshot, expected, now());
    } catch {
      checkCurrent();
      return outcome("blocked", "authenticated_receipt_read_failed");
    } finally {
      clearTimeout(timer);
    }
  };
}

// peer-memory.mjs
var ROUTES = new Set(["same_kernel", "same_conversation", "same_principal"]);
var MAX_AGE_MS = 3600 * 1000;
function createPeerMemory({ maxOpen = 128 } = {}) {
  if (!Number.isInteger(maxOpen) || maxOpen < 1)
    throw new Error("invalid peer bound");
  const open = new Map;
  const byId = new Map;
  const order = [];
  const unresolved = [];
  let matchedReturns = 0;
  function noteUnresolved(rec, reason) {
    unresolved.push({ delegationId: rec.delegationId, connection: rec.connection, reason });
    if (unresolved.length > maxOpen)
      unresolved.shift();
  }
  function deleteRecord(id) {
    const rec = byId.get(id);
    if (!rec)
      return null;
    byId.delete(id);
    const index = order.indexOf(id);
    if (index >= 0)
      order.splice(index, 1);
    const set = open.get(rec.slot);
    if (set) {
      set.delete(id);
      if (set.size === 0)
        open.delete(rec.slot);
    }
    return rec;
  }
  function evictOldest(reason) {
    const id = order[0];
    const rec = id ? deleteRecord(id) : null;
    if (rec)
      noteUnresolved(rec, reason);
  }
  function tick(now) {
    if (!Number.isFinite(now))
      return;
    for (const id of [...order]) {
      const rec = byId.get(id);
      if (rec && now - rec.observedAt > MAX_AGE_MS) {
        deleteRecord(id);
        noteUnresolved(rec, "expired");
      }
    }
  }
  return {
    rememberDelegation(slot, connection, result, now) {
      tick(now);
      if (!result || result.reason_code || result.kernel_state !== "active")
        return false;
      if (typeof result.delegation_id !== "string" || result.delegation_id.length === 0)
        return false;
      if (typeof result.kernel_session_id !== "string" || result.kernel_session_id.length === 0)
        return false;
      if (typeof connection !== "string" || typeof slot !== "string" || !Number.isFinite(now))
        return false;
      const existing = byId.get(result.delegation_id);
      if (existing) {
        return existing.connection === connection && existing.originKernel === result.kernel_session_id && existing.slot === slot;
      }
      while (order.length >= maxOpen)
        evictOldest("evicted");
      const rec = { delegationId: result.delegation_id, connection, originKernel: result.kernel_session_id, slot, observedAt: now };
      byId.set(rec.delegationId, rec);
      order.push(rec.delegationId);
      let set = open.get(slot);
      if (!set) {
        set = new Map;
        open.set(slot, set);
      }
      set.set(rec.delegationId, rec);
      return true;
    },
    observeReturn(connection, result, now) {
      tick(now);
      if (!result || result.reason_code)
        return false;
      if (result.kernel_state !== "active" || result.delegation_state !== "returned")
        return false;
      if (typeof result.delegation_id !== "string" || result.delegation_id.length === 0)
        return false;
      const originField = result.delegation_kernel_session_id;
      const closer = result.closed_by_kernel_session_id;
      if (typeof originField !== "string" || originField.length === 0)
        return false;
      if (typeof closer !== "string" || closer.length === 0)
        return false;
      if (result.kernel_session_id !== closer)
        return false;
      if (!ROUTES.has(result.return_route))
        return false;
      if (result.return_route === "same_kernel" ? closer !== originField : closer === originField)
        return false;
      const rec = byId.get(result.delegation_id);
      if (!rec || rec.connection !== connection || rec.originKernel !== originField)
        return false;
      deleteRecord(rec.delegationId);
      matchedReturns += 1;
      return true;
    },
    invalidateSlot(slot, reason) {
      const set = open.get(slot);
      if (!set)
        return 0;
      const ids = [...set.keys()];
      for (const id of ids) {
        const rec = deleteRecord(id);
        if (rec)
          noteUnresolved(rec, reason);
      }
      return ids.length;
    },
    tick,
    openCount(slot) {
      return open.get(slot)?.size ?? 0;
    },
    unresolvedCount() {
      return unresolved.length;
    },
    matchedReturnCount() {
      return matchedReturns;
    },
    snapshot() {
      return {
        open: [...byId.values()].map((rec) => ({ ...rec })),
        unresolved: unresolved.map((rec) => ({ ...rec })),
        matchedReturns
      };
    },
    clear() {
      open.clear();
      byId.clear();
      order.length = 0;
      unresolved.length = 0;
      matchedReturns = 0;
    }
  };
}

// sql-classify.mjs
var DESTRUCTIVE = /^\s*(drop|truncate|delete\s+from|alter\s+system|drop\s+database)\b/i;
var READ = /^\s*(select|with|explain|show|table|values)\b/i;
var MUTATES_ANYWHERE = /\b(insert\s+into|update\s+\w|delete\s+from|merge\s+into|truncate\b|drop\s+\w|alter\s+\w|create\s+\w|grant\s+\w|revoke\s+\w|copy\b[^;]*\bto\s+program|do\s*\$)/i;
var DESTRUCTIVE_ANYWHERE = /\b(drop\s+\w|truncate\b|delete\s+from|alter\s+system)/i;
var OPAQUE_EXECUTOR = /^(do|call)\b/i;
var DOLLAR_TAG = /\$([A-Za-z_\u0080-\uFFEF][A-Za-z0-9_\u0080-\uFFEF]*)?\$/u;
var alnum = (ch) => typeof ch === "string" && (ch === "_" || /[\p{L}\p{N}]/u.test(ch));
function lexicalShadow(sql) {
  const out = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql.startsWith("--", i)) {
      const j = sql.indexOf(`
`, i);
      i = j < 0 ? n : j + 1;
      out.push(" ");
      continue;
    }
    if (c === "/" && sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < n && depth) {
        if (sql.startsWith("/*", i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
        } else
          i += 1;
      }
      if (depth)
        return { shadow: out.join(""), reason: "unterminated block comment" };
      out.push(" ");
      continue;
    }
    let prefix = "";
    if ((c === "e" || c === "E") && sql[i + 1] === "'")
      prefix = "E";
    else if ((c === "u" || c === "U") && sql.startsWith("&'", i + 1))
      prefix = "U&";
    if (prefix || c === "'") {
      if (prefix && i > 0 && alnum(sql[i - 1])) {
        out.push(c);
        i += 1;
        continue;
      }
      i += prefix.length + 1;
      const escapes = prefix === "E";
      for (;; ) {
        if (i >= n)
          return { shadow: out.join(""), reason: "unterminated string constant" };
        const ch = sql[i];
        if (escapes && ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "\\" && !escapes && sql[i + 1] === "'") {
          return { shadow: out.join(""), reason: "backslash before a quote in a plain string constant; its meaning depends on standard_conforming_strings" };
        }
        if (ch === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out.push("''");
      continue;
    }
    if (c === '"' || (c === "u" || c === "U") && sql.startsWith('&"', i + 1)) {
      i += c === '"' ? 1 : 3;
      for (;; ) {
        if (i >= n)
          return { shadow: out.join(""), reason: "unterminated quoted identifier" };
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out.push('"x"');
      continue;
    }
    if (c === "$") {
      const m = DOLLAR_TAG.exec(sql.slice(i));
      if (m && m.index === 0) {
        const close = m[0];
        const j = sql.indexOf(close, i + close.length);
        if (j < 0)
          return { shadow: out.join(""), reason: "unterminated dollar-quoted string" };
        out.push("$$");
        i = j + close.length;
        continue;
      }
    }
    out.push(c);
    i += 1;
  }
  return { shadow: out.join(""), reason: "" };
}
function classifySql(sql) {
  if (typeof sql !== "string")
    return "write";
  const { shadow, reason } = lexicalShadow(sql);
  if (reason)
    return "destructive";
  const s = shadow.trimStart();
  if (DESTRUCTIVE.test(s))
    return "destructive";
  if (READ.test(s))
    return MUTATES_ANYWHERE.test(s) ? "destructive" : "read";
  if (OPAQUE_EXECUTOR.test(s) || DESTRUCTIVE_ANYWHERE.test(s))
    return "destructive";
  return "write";
}

// index.mjs
var digest = (value) => createHash2("sha256").update(value).digest("hex");
var object2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function conversationKey(ctx) {
  if (!ctx?.agentId || !ctx?.sessionKey)
    return;
  return `openclaw:${digest(JSON.stringify([ctx.agentId, ctx.sessionKey]))}`;
}
function stable(value) {
  if (Array.isArray(value))
    return `[${value.map(stable).join(",")}]`;
  if (object2(value))
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function parsedText(result) {
  if (typeof result === "string")
    return result;
  const items = Array.isArray(result) ? result : result?.content;
  return items?.find((item) => item?.type === "text")?.text;
}
function packet(result) {
  if (!result || result.isError === true || object2(result.error))
    return;
  const text = parsedText(result);
  let parsed;
  if (typeof text === "string" && text.length <= 1e5) {
    try {
      const value = JSON.parse(text.replace(/^structuredContent:\s*\n/, ""));
      if (object2(value) && value.isError !== true)
        parsed = value;
    } catch {
      parsed = undefined;
    }
  }
  const structured = object2(result.structuredContent) && result.structuredContent.isError !== true ? result.structuredContent : undefined;
  if (structured && parsed && stable(structured) !== stable(parsed))
    return;
  if (structured)
    return structured;
  if (parsed)
    return parsed;
  if (typeof result === "string")
    return;
  if (object2(result) && (typeof result.state === "string" || typeof result.kernel_state === "string"))
    return result;
  return;
}
var deny = (blockReason) => ({ block: true, blockReason });
var proofShape = /^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/;
var schema = { type: "object", properties: { taskRef: {
  type: "object",
  required: ["factory", "taskId", "taskRevision"],
  additionalProperties: false,
  properties: {
    factory: { type: "string", minLength: 1, maxLength: 256 },
    taskId: { type: "string", minLength: 1, maxLength: 256 },
    taskRevision: { type: "integer", minimum: 1 }
  }
} }, additionalProperties: false };
var isolated_openclaw_current_default = {
  id: "omatic-governance",
  name: "o-MATIC Server Connection",
  register(api) {
    const config = api.pluginConfig ?? {};
    const connections = new Set(config.connections ?? []);
    const agents = config.agentIds ? new Set(config.agentIds) : undefined;
    const names = new Map(Object.entries(config.toolNames ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const owners = config.toolOwners ?? {};
    const states = new Map;
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
    const serverReads = new Set(["module_status", "observability_snapshot", "embed_query", "mom_summary", "mom_network_inventory", "mom_trends", "mom_compliance_posture"]);
    const scopedReads = new Set(["db_health_snapshot", "factory_web_status", "ladder_status", "proposal_vault_list", "proposal_vault_get", "proposal_vault_trash_list", "slate_canvas_open", "slate_asset_get", "slate_entity_search", "slate_entity_verify", "slate_proposal_list", "slate_scene_observe", "task_duplicate_check", "task_relationships", "ocr_result_get", "vision_page_get"]);
    const now = () => Date.now();
    api.on("before_prompt_build", (_event, ctx) => {
      if (!enrolled(ctx))
        return;
      return { prependContext: `For explicit o-MATIC operations, use conversation_key ${conversationKey(ctx)}. Supply all schema-supported arguments before approval; this adapter does not rewrite them. Use only your own startup proof in guarded tool arguments; never echo or persist it. READY does not establish current tool discovery or workflow completion. Ordinary acknowledgments need no factory operation. Existing full-agent coordination remains model-led.` };
    });
    api.on("before_tool_call", (event, ctx) => {
      if (!enrolled(ctx))
        return;
      const tool = names.get(event.toolName?.toLowerCase());
      if (!tool)
        return;
      if (owners[tool] && !owners[tool].includes(ctx.agentId))
        return deny("o-MATIC: dedicated operation belongs to a different configured executor");
      if (tool === "connections_list" || tool === "omatic_guide" || serverReads.has(tool))
        return;
      const args = event.params;
      if (!connections.has(args?.connection))
        return deny("o-MATIC: select an explicitly configured factory connection");
      if (!scopedReads.has(tool) && args.conversation_key !== conversationKey(ctx))
        return deny("o-MATIC: supply this host conversation's exact key before approval");
      if (mutations.has(tool))
        return;
      if (!known.has(tool) && !scopedReads.has(tool))
        return deny("o-MATIC: operation is outside this read-only candidate's verified contract");
      if (tool === "factory_query" && classifySql(args.sql) !== "read")
        return deny("o-MATIC: exact-SQL operator approval is not integrated; no database mutation is authorized by this adapter");
      const state = stateFor(ctx, args.connection);
      if (tool === "startup") {
        peers.invalidateSlot(slot(ctx, args.connection), "startup_reset");
        Object.keys(state).forEach((key) => delete state[key]);
        if (!event.toolCallId)
          return deny("o-MATIC: correlated startup invocation required");
        state.pending = event.toolCallId;
        return;
      }
      if (state.readiness !== "READY" || !(state.expires > now()))
        return deny("o-MATIC: fresh correlated READY startup required");
      if (scopedReads.has(tool))
        return;
      if ((tool === "search" || tool === "factory_query") && (!proofShape.test(args.startup_proof ?? "") || digest(args.startup_proof) !== state.proofDigest))
        return deny("o-MATIC: use the proof returned by your own startup before approval");
      if (tool === "kernel_session_get" && args.role_id !== ctx.agentId)
        return deny("o-MATIC: read the kernel as the actual host executor");
    });
    api.on("after_tool_call", (event, ctx) => {
      if (!enrolled(ctx))
        return;
      const tool = names.get(event.toolName?.toLowerCase());
      if (!connections.has(event.params?.connection) || event.params.conversation_key !== conversationKey(ctx))
        return;
      const out = event.error ? undefined : packet(event.result);
      if (tool === "kernel_delegate") {
        peers.rememberDelegation(slot(ctx, event.params.connection), event.params.connection, out, now());
        return;
      }
      if (tool === "kernel_return") {
        peers.observeReturn(event.params.connection, out, now());
        return;
      }
      if (tool !== "startup")
        return;
      const state = stateFor(ctx, event.params.connection);
      if (!state.pending || state.pending !== event.toolCallId)
        return;
      delete state.pending;
      if (out?.state !== "READY" || out.connection !== event.params.connection || out.kernel?.kernel_state !== "active" || out.kernel.addressing !== "conversation_key" || !proofShape.test(out.startup_proof ?? ""))
        return;
      const ttl = out.startup_proof_expires_in_seconds;
      if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 3600)
        return;
      state.readiness = "READY";
      state.expires = now() + ttl * 1000;
      state.proofDigest = digest(out.startup_proof);
      const surface = out.session_tool_surface;
      state.surface = surface?.state === "CURRENT" && surface.this_session_listed_by_this_process === true ? "CURRENT" : "UNVERIFIED";
    });
    api.registerTool({ contextVersion: 2, create(ctx) {
      if (!enrolled(ctx))
        return null;
      const verifyReceipt = createReceiptVerifier({ assertCurrent: () => ctx.assertInvocationCurrent() });
      return {
        name: "omatic_workflow_status",
        label: "o-MATIC workflow status",
        description: "Explicit readiness/discovery status; never creates completion evidence or sends work.",
        parameters: schema,
        execute: async (_id, args) => {
          ctx.assertInvocationCurrent();
          if (!object2(args) || Object.keys(args).some((key) => key !== "taskRef"))
            throw new Error("No model-supplied status, actor, or receipt arguments are accepted");
          if (args.taskRef !== undefined) {
            if (!object2(args.taskRef) || !connections.has(args.taskRef.factory)) {
              return { content: [{ type: "text", text: JSON.stringify({
                status: "refused",
                reason: "unconfigured_factory_reference",
                automaticRetry: false
              }) }] };
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
            return {
              connection,
              readiness,
              toolSurface: surface,
              volatileOpenDelegations: peers.openCount(slot(ctx, connection)),
              ...decideWorkflow({ readiness, surface })
            };
          });
          ctx.assertInvocationCurrent();
          return { content: [{ type: "text", text: JSON.stringify({
            status: "blocked",
            factories,
            backendReceiptBinding: "unavailable",
            universalChatEnforcement: false,
            delegationObservation: "volatile_process_only",
            durableDelegationRecord: "server_ledger_not_read_or_written_here",
            kernelMutationAdmission: "server_policy_not_local_ready",
            volatileUnresolvedDelegations: peers.unresolvedCount(),
            matchedReturnObservations: peers.matchedReturnCount()
          }) }] };
        }
      };
    } }, { name: "omatic_workflow_status" });
    api.on("gateway_stop", () => {
      states.clear();
      peers.clear();
    });
  }
};

// status-tool.mjs
import { createHash as createHash3 } from "node:crypto";
var object3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var keyFor = (ctx) => ctx?.sessionKey && `openclaw:${createHash3("sha256").update(JSON.stringify([ctx.agentId ?? "", ctx.sessionKey])).digest("hex")}`;
var slotFor = (ctx, connection) => JSON.stringify([ctx.agentId, ctx.sessionKey, ctx.sessionId ?? null, connection]);
function packet2(value) {
  if (value?.isError)
    return;
  if (object3(value?.structuredContent))
    return value.structuredContent;
  if (object3(value) && value.state)
    return value;
  const content = Array.isArray(value) ? value : value?.content;
  const text = typeof value === "string" ? value : content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string" || text.length > 1e5)
    return;
  try {
    const parsed = JSON.parse(text.replace(/^structuredContent:\s*\n/, ""));
    if (object3(parsed) && !parsed.isError)
      return parsed;
  } catch {}
}
function registerConnectionStatus(api) {
  const config = api.pluginConfig ?? {};
  const connections = new Set(config.connections ?? []);
  const agents = config.agentIds ? new Set(config.agentIds) : undefined;
  const names = new Map(Object.entries(config.toolNames ?? {}).map(([name, tool]) => [name.toLowerCase(), tool]));
  const identify = (name) => typeof name === "string" && (names.get(name.toLowerCase()) ?? name.toLowerCase().match(/^(?:mcp__o_matic_server__|mcp__codex_apps__o_matic_server_mcp__?|o-matic-server(?:__|\.))([a-z_]+)$/)?.[1]);
  const enrolled = (ctx) => Boolean(keyFor(ctx)) && (!agents || agents.has(ctx.agentId));
  const states = new Map;
  const stateFor = (ctx, connection) => {
    const slot = slotFor(ctx, connection);
    if (!states.has(slot)) {
      states.set(slot, {});
      if (states.size > 2048)
        states.delete(states.keys().next().value);
    }
    return states.get(slot);
  };
  api.on("before_tool_call", (event, ctx) => {
    if (!enrolled(ctx) || identify(event.toolName) !== "startup" || !connections.has(event.params?.connection))
      return;
    const state = stateFor(ctx, event.params.connection);
    for (const key of Object.keys(state))
      delete state[key];
    if (event.params.conversation_key === keyFor(ctx) && event.toolCallId)
      state.pending = event.toolCallId;
  });
  api.on("after_tool_call", (event, ctx) => {
    if (!enrolled(ctx) || identify(event.toolName) !== "startup" || !connections.has(event.params?.connection) || event.params.conversation_key !== keyFor(ctx))
      return;
    const state = stateFor(ctx, event.params.connection);
    if (!state.pending || state.pending !== event.toolCallId)
      return;
    delete state.pending;
    const out = event.error ? undefined : packet2(event.result);
    const ttl = out?.startup_proof_expires_in_seconds;
    if (out?.state !== "READY" || out.connection !== event.params.connection || out.kernel?.addressing !== "conversation_key" || out.kernel?.kernel_state !== "active" || typeof out.startup_proof !== "string" || !/^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(out.startup_proof) || !Number.isInteger(ttl) || ttl < 1 || ttl > 3600)
      return;
    state.readiness = "READY";
    state.expiresAt = Date.now() + ttl * 1000;
    state.surface = out.session_tool_surface?.state === "CURRENT" && out.session_tool_surface.this_session_listed_by_this_process === true ? "CURRENT" : "UNVERIFIED";
  });
  api.registerTool({ contextVersion: 2, create(ctx) {
    if (!enrolled(ctx) || typeof ctx.assertInvocationCurrent !== "function")
      return null;
    return {
      name: "omatic_connection_status",
      label: "o-MATIC Server Connection status",
      description: "Read bounded local connection observations and explicit capability limits. Does not dispatch agents, reconnect, grant authority or claim task completion.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_toolCallId, args) => {
        ctx.assertInvocationCurrent();
        if (!object3(args) || Object.keys(args).length)
          throw new Error("No actor, receipt, status or connection overrides are accepted");
        const factories = [...connections].map((connection) => {
          const state = states.get(slotFor(ctx, connection));
          const current = state?.expiresAt > Date.now();
          return {
            connection,
            readiness: current ? state.readiness : "UNVERIFIED",
            toolSurface: current ? state.surface : "UNVERIFIED"
          };
        });
        const result = {
          plugin: { id: "omatic-governance", name: "o-MATIC Server Connection" },
          status: "diagnostic_only",
          factories,
          workflow: {
            status: "blocked",
            reason: "authenticated_backend_unbound",
            executorProvenance: "executor_unverified",
            canonicalPeerReturn: "unbound",
            productionReceiptStore: "unbound",
            automaticRetry: false
          },
          agentDispatch: "not_provided",
          generalChatFinalizationHook: "not_registered",
          discovery: { automaticRetry: false, remediation: "Owning host must measure reconnect/tools-list if needed; repeated startup/search or another process's CLI reload is not repair." }
        };
        ctx.assertInvocationCurrent();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    };
  } }, { name: "omatic_connection_status" });
  api.on("gateway_stop", () => states.clear());
}

// authenticated-request-adapter.mjs
import { createHash as createHash4 } from "node:crypto";
var object4 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var text2 = (v) => typeof v === "string" && v.length > 0 && v.length <= 256 && v.isWellFormed();
var blocked = (reason) => ({ status: "blocked", reason, automaticRetry: false });
function assertRequest(options) {
  const current = typeof options.hasCurrentClientAuthority === "function" ? options.hasCurrentClientAuthority() : false;
  if (current && typeof current.then === "function")
    Promise.resolve(current).catch(() => {});
  if (!object4(options.client) || current !== true || options.signal?.aborted)
    throw new Error("authenticated_request_scope_unavailable");
}
function packet3(output) {
  if (output?.isError)
    throw new Error("receipt_backend_refused");
  if (object4(output?.structuredContent))
    return output.structuredContent;
  if (!Array.isArray(output?.content) || output.content.length !== 1 || output.content[0]?.type !== "text")
    throw new Error("receipt_backend_invalid_response");
  const value = output.content[0].text;
  if (typeof value !== "string" || value.length > 262144)
    throw new Error("receipt_backend_invalid_response");
  return JSON.parse(value);
}
async function publicDispatch(method, params, options) {
  const { dispatchGatewayMethod } = await import("openclaw/plugin-sdk/gateway-method-runtime");
  return dispatchGatewayMethod(method, params, options);
}
function registerAuthenticatedReceiptRpc(api, { dispatchGatewayMethod = publicDispatch, now = Date.now } = {}) {
  if (typeof api.registerGatewayMethod !== "function")
    return false;
  const config = api.pluginConfig ?? {}, connections = new Set(config.connections ?? []);
  const { receiptStatusTool: tool, receiptStartupTool: startupTool } = config;
  const validTool = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
  const configured = validTool(tool) && validTool(startupTool) && config.toolNames?.[tool] === "workflow_status" && config.toolNames?.[startupTool] === "startup";
  api.registerGatewayMethod("omatic.connection.workflowStatus", async (options) => {
    const respond = (result) => options.respond(true, result);
    try {
      assertRequest(options);
      const p = options.params;
      if (!object4(p) || Object.keys(p).some((k) => !["sessionKey", "taskRef"].includes(k)) || !text2(p.sessionKey) || !object4(p.taskRef) || Object.keys(p.taskRef).length !== 3 || !text2(p.taskRef.factory) || !text2(p.taskRef.taskId) || !Number.isSafeInteger(p.taskRef.taskRevision) || p.taskRef.taskRevision < 1)
        return respond({ status: "refused", reason: "lookup_reference_only", automaticRetry: false });
      if (!connections.has(p.taskRef.factory))
        return respond({ status: "refused", reason: "unconfigured_factory_reference", automaticRetry: false });
      if (!configured)
        return respond(blocked("receipt_backend_unconfigured"));
      const sessionKey = p.sessionKey, taskRef = Object.freeze({ ...p.taskRef });
      const verify = createReceiptVerifier({
        now,
        assertCurrent: () => assertRequest(options),
        readVerifiedSnapshot: async (expected) => {
          assertRequest(options);
          const resolved = await dispatchGatewayMethod("sessions.resolve", { key: sessionKey }, { timeoutMs: 1000, expectFinal: true });
          assertRequest(options);
          const facts = resolved?.payload;
          if (resolved?.ok !== true || facts?.ok !== true || facts.key !== sessionKey || !text2(facts.agentId))
            throw new Error("authenticated_session_routing_unavailable");
          const conversationKey = "openclaw:" + createHash4("sha256").update(JSON.stringify([facts.agentId, facts.key])).digest("hex");
          const started = await dispatchGatewayMethod("tools.invoke", {
            name: startupTool,
            sessionKey,
            args: { connection: expected.factory, conversation_key: conversationKey },
            confirm: false
          }, { timeoutMs: 1000, expectFinal: true });
          assertRequest(options);
          if (started?.ok !== true || started.payload?.ok !== true || started.payload.source !== "mcp")
            throw new Error("receipt_startup_unavailable");
          const startup = packet3(started.payload.output);
          const proof = startup?.startup_proof, ttl = startup?.startup_proof_expires_in_seconds;
          if (startup?.state !== "READY" || startup.connection !== expected.factory || startup.kernel?.kernel_state !== "active" || startup.kernel?.addressing !== "conversation_key" || typeof proof !== "string" || !/^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(proof) || !Number.isInteger(ttl) || ttl < 1 || ttl > 3600)
            throw new Error("receipt_ready_startup_required");
          const result = await dispatchGatewayMethod("tools.invoke", {
            name: tool,
            sessionKey,
            args: {
              factory: expected.factory,
              taskId: expected.taskId,
              conversation_key: conversationKey,
              startup_proof: proof
            },
            confirm: false
          }, { timeoutMs: 1000, expectFinal: true });
          assertRequest(options);
          if (result?.ok !== true || result.payload?.ok !== true || result.payload.source !== "mcp")
            throw new Error("receipt_backend_unavailable");
          const wire = packet3(result.payload.output);
          if (!object4(wire) || !object4(wire.snapshot))
            throw new Error("receipt_backend_unavailable");
          return wire.snapshot;
        }
      });
      const result = await verify(taskRef);
      assertRequest(options);
      return respond(result);
    } catch {
      return respond(blocked("authenticated_receipt_request_failed"));
    }
  }, { scope: "operator.write", profileAccess: "required", sessionAccess: { mode: "write" } });
  return true;
}

// release-entry.mjs
var release_entry_default = {
  id: "omatic-governance",
  name: "o-MATIC Server Connection",
  description: "Existing-connection argument guards, finite explicit diagnostics and honest blocked workflow capabilities.",
  register(api) {
    isolated_openclaw_current_default.register(api);
    registerConnectionStatus(api);
    registerAuthenticatedReceiptRpc(api);
  }
};
export {
  release_entry_default as default
};
