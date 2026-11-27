import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import entry, { conversationKey, toolEffect } from "./index.mjs";
import { createPeerMemory } from "./peer-memory.mjs";
import { classifySql } from "./sql-classify.mjs";

function harness() {
  const hooks = new Map();
  let descriptor;
  const ctx = { agentId: "probot", sessionKey: "agent:probot:desk", sessionId: "s1", assertInvocationCurrent() {} };
  const peer = { agentId: "data", sessionKey: "agent:data:main", sessionId: "s2", assertInvocationCurrent() {} };
  const names = ["startup", "kernel_delegate", "kernel_return", "search", "factory_query"];
  entry.register({ pluginConfig: { connections: ["F", "Other"],
    toolNames: Object.fromEntries(names.map((name) => [`exact_${name}`, name])) },
    on: (name, fn) => hooks.set(name, fn), registerTool: (value) => { descriptor = value; } });
  const proof = "v1.2000." + "c".repeat(32) + "." + "d".repeat(64);
  const args = (context, extra = {}) => ({ connection: "F", conversation_key: conversationKey(context), ...extra });
  const before = (context, tool, extra = {}) => hooks.get("before_tool_call")({
    toolName: `exact_${tool}`, toolCallId: `${tool}-${context.sessionId}`, params: args(context, extra),
  }, context);
  const after = (context, tool, result) => hooks.get("after_tool_call")({
    toolName: `exact_${tool}`, toolCallId: `${tool}-${context.sessionId}`, params: args(context), result,
  }, context);
  const ready = (context, connection = "F") => {
    const params = args(context, { connection });
    const ev = { toolName: "exact_startup", toolCallId: `start-${connection}-${context.agentId}`, params };
    assert.equal(hooks.get("before_tool_call")(ev, context), undefined);
    hooks.get("after_tool_call")({ ...ev, result: { structuredContent: { state: "READY", connection, startup_proof: proof,
      startup_proof_expires_in_seconds: 3600, kernel: { kernel_state: "active", addressing: "conversation_key" } } } }, context);
  };
  const status = async (context = ctx) => JSON.parse((await descriptor.create(context).execute("status", {})).content[0].text);
  return { hooks, ctx, peer, proof, args, before, after, ready, status, descriptor };
}

const delegated = { kernel_state: "active", delegation_id: "d1", kernel_session_id: "origin-a", target_role: "data" };
const returned = (patch = {}) => ({ kernel_state: "active", delegation_state: "returned", delegation_id: "d1",
  kernel_session_id: "closer-b", delegation_kernel_session_id: "origin-a", closed_by_kernel_session_id: "closer-b",
  return_route: "same_conversation", ...patch });
const envelope = (value, patch = {}) => ({ content: [{ type: "text", text: JSON.stringify(patch.text ?? value) }],
  structuredContent: value, isError: false, ...patch.envelope });

test("delegate and return are admitted mutations; READY is not their authorization", () => {
  const h = harness();
  assert.equal(toolEffect("kernel_delegate"), "mutation");
  assert.equal(toolEffect("kernel_return"), "mutation");
  assert.equal(toolEffect("factory_query"), "guarded_read");
  assert.equal(h.before(h.ctx, "kernel_delegate", { authorized: true, role_id: "probot" }), undefined);
  assert.equal(h.before(h.peer, "kernel_return"), undefined);
  assert.match(h.before(h.ctx, "search").blockReason, /fresh correlated READY/);
  assert.match(h.before(h.ctx, "factory_query", { sql: "DELETE FROM factory.notes" }).blockReason, /exact-SQL operator approval/);
});

test("before hook admits same-factory cross-conversation return and only the origin field closes it", async () => {
  const h = harness();
  h.ready(h.ctx); h.ready(h.peer);
  assert.equal(h.before(h.ctx, "kernel_delegate"), undefined);
  h.after(h.ctx, "kernel_delegate", envelope(delegated));
  let card = await h.status();
  assert.equal(card.factories.find((row) => row.connection === "F").volatileOpenDelegations, 1);
  assert.equal(h.before(h.peer, "kernel_return"), undefined);
  h.after(h.peer, "kernel_return", envelope(returned({ delegation_kernel_session_id: "closer-b", kernel_session_id: "origin-a",
    closed_by_kernel_session_id: "origin-a", return_route: "same_kernel" })));
  card = await h.status();
  assert.equal(card.factories.find((row) => row.connection === "F").volatileOpenDelegations, 1);
  assert.equal(card.matchedReturnObservations, 0);
  h.after(h.peer, "kernel_return", envelope(returned()));
  card = await h.status();
  assert.equal(card.factories.find((row) => row.connection === "F").volatileOpenDelegations, 0);
  assert.equal(card.matchedReturnObservations, 1);
  assert.equal(card.kernelMutationAdmission, "server_policy_not_local_ready");
});

test("server envelopes that disagree or fail do not create or close peer state", async () => {
  const h = harness();
  const bad = { content: [{ type: "text", text: JSON.stringify(delegated) }], structuredContent: { ...delegated, kernel_session_id: "other-origin" }, isError: false };
  h.after(h.ctx, "kernel_delegate", bad);
  h.after(h.ctx, "kernel_delegate", { ...envelope(delegated), isError: true });
  h.after(h.ctx, "kernel_delegate", { error: { code: -32603, message: "failed" } });
  let card = await h.status();
  assert.equal(card.factories.find((row) => row.connection === "F").volatileOpenDelegations, 0);
  h.after(h.ctx, "kernel_delegate", { content: [{ type: "text", text: JSON.stringify(delegated) }], isError: false });
  card = await h.status();
  assert.equal(card.factories.find((row) => row.connection === "F").volatileOpenDelegations, 1);
});

test("startup reset and state eviction are unresolved, not completed", async () => {
  const h = harness();
  h.ready(h.ctx);
  h.after(h.ctx, "kernel_delegate", envelope(delegated));
  assert.equal(h.before(h.ctx, "startup"), undefined);
  let card = await h.status();
  assert.equal(card.factories.find((row) => row.connection === "F").volatileOpenDelegations, 0);
  assert.equal(card.volatileUnresolvedDelegations, 1);
  assert.equal(card.matchedReturnObservations, 0);
  h.ready(h.ctx);
  h.after(h.ctx, "kernel_delegate", envelope(delegated));
  for (let i = 0; i < 512; i += 1) {
    const context = { agentId: "probot", sessionKey: "agent:probot:desk", sessionId: `fill-${i}`, assertInvocationCurrent() {} };
    assert.equal(h.before(context, "startup"), undefined);
  }
  card = await h.status(h.ctx);
  assert.equal(card.factories.find((row) => row.connection === "F").volatileOpenDelegations, 0);
  assert.ok(card.volatileUnresolvedDelegations >= 1);
  assert.equal(card.matchedReturnObservations, 0);
});

test("peer bounds, expiry, and conflicting reuse do not overwrite or complete", () => {
  const memory = createPeerMemory({ maxOpen: 1 });
  const first = { kernel_state: "active", delegation_id: "d1", kernel_session_id: "origin-a" };
  assert.equal(memory.rememberDelegation("slot-a", "F", first, 0), true);
  assert.equal(memory.rememberDelegation("slot-b", "F", { ...first, kernel_session_id: "origin-b" }, 1), false);
  assert.equal(memory.rememberDelegation("slot-a", "Other", first, 1), false);
  assert.equal(memory.rememberDelegation("slot-b", "F", first, 1), false);
  assert.equal(memory.snapshot().open[0].originKernel, "origin-a");
  assert.equal(memory.rememberDelegation("slot-c", "F", { ...first, delegation_id: "d2", kernel_session_id: "origin-c" }, 2), true);
  assert.equal(memory.snapshot().unresolved[0].reason, "evicted");
  assert.equal(memory.matchedReturnCount(), 0);
  const aged = createPeerMemory({ maxOpen: 2 });
  aged.rememberDelegation("slot-a", "F", first, 0);
  aged.tick(3600 * 1000 + 1);
  assert.equal(aged.openCount("slot-a"), 0);
  assert.equal(aged.snapshot().unresolved[0].reason, "expired");
  assert.equal(aged.matchedReturnCount(), 0);
});

test("configured factory_query alias requires own proof and the started factory", () => {
  const hooks = new Map();
  const ctx = { agentId: "probot", sessionKey: "agent:probot:desk", sessionId: "s1", assertInvocationCurrent() {} };
  entry.register({ pluginConfig: { connections: ["F", "Other"], toolNames: { host_query: "factory_query", exact_startup: "startup" } },
    on: (name, fn) => hooks.set(name, fn), registerTool() {} });
  const proof = "v1.2000." + "c".repeat(32) + "." + "d".repeat(64);
  const args = (extra = {}) => ({ connection: "F", conversation_key: conversationKey(ctx), startup_proof: proof, ...extra });
  const ev = { toolName: "exact_startup", toolCallId: "start", params: { connection: "F", conversation_key: conversationKey(ctx) } };
  hooks.get("before_tool_call")(ev, ctx);
  hooks.get("after_tool_call")({ ...ev, result: { content: [{ type: "text", text: JSON.stringify({ state: "READY", connection: "F", startup_proof: proof,
    startup_proof_expires_in_seconds: 3600, kernel: { kernel_state: "active", addressing: "conversation_key" } }) }],
    structuredContent: { state: "READY", connection: "F", startup_proof: proof, startup_proof_expires_in_seconds: 3600,
      kernel: { kernel_state: "active", addressing: "conversation_key" } }, isError: false } }, ctx);
  assert.equal(hooks.get("before_tool_call")({ toolName: "host_query", toolCallId: "q", params: args({ sql: "SELECT sop_id FROM factory.sop_registry WHERE sop_id = 'SOP-026'" }) }, ctx), undefined);
  assert.match(hooks.get("before_tool_call")({ toolName: "host_query", toolCallId: "bad", params: args({ startup_proof: "v1.2000." + "e".repeat(32) + "." + "f".repeat(64), sql: "SELECT 1" }) }, ctx).blockReason, /own startup/);
  assert.match(hooks.get("before_tool_call")({ toolName: "host_query", toolCallId: "other", params: args({ connection: "Other", sql: "SELECT 1" }) }, ctx).blockReason, /fresh correlated READY/);
  assert.equal(hooks.get("before_tool_call")({ toolName: "factory_query", toolCallId: "bare", params: args({ sql: "SELECT 1" }) }, ctx), undefined);
  assert.match(hooks.get("before_tool_call")({ toolName: "host_query", toolCallId: "mut", params: args({ sql: "WITH d AS (DELETE FROM factory.notes RETURNING *) SELECT * FROM d" }) }, ctx).blockReason, /exact-SQL operator approval/);
});

test("classifier labels narrow SELECT and mutation shapes", () => {
  // Server-source line parity lives with the Server checkout; this public connector
  // ships the client classifier cases only.
  const cases = [
    ["SELECT sop_id FROM factory.sop_registry WHERE sop_id = 'SOP-026'", "read"],
    ["SELECT mutating_function()", "read"],
    ["WITH d AS (DELETE FROM factory.notes RETURNING *) SELECT * FROM d", "destructive"],
    ["EXPLAIN ANALYZE DELETE FROM factory.notes", "destructive"],
    ["DELETE FROM factory.notes", "destructive"],
    ["INSERT INTO factory.notes VALUES (1)", "write"],
    ["SELECT 'DELETE FROM factory.notes'", "read"],
  ];
  for (const [sql, expected] of cases) assert.equal(classifySql(sql), expected, sql);
});

test("retained observation values do not contain the startup proof", async () => {
  const h = harness();
  h.ready(h.ctx);
  h.after(h.ctx, "kernel_delegate", envelope(delegated));
  const card = await h.status();
  assert.equal(JSON.stringify(card).includes(h.proof), false);
  const memory = createPeerMemory();
  memory.rememberDelegation("slot", "F", { ...delegated, startup_proof: h.proof }, 1);
  const retained = JSON.stringify(memory.snapshot().open);
  assert.equal(retained.includes(h.proof), false);
  assert.equal(retained.includes("origin-a"), true);
});
