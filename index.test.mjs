import assert from "node:assert/strict";
import { test } from "node:test";
import entry, { conversationKey } from "./index.mjs";
import { decideWorkflow, hostContracts } from "./workflow.mjs";
import { prepareM365Adapter } from "./m365-adapter.mjs";

function fixture() {
  const hooks = new Map();
  let descriptor;
  const ctx = { agentId: "probot", sessionKey: "agent:probot:main", sessionId: "incarnation-one",
    assertInvocationCurrent() {} };
  const tools = ["startup", "search", "kernel_session_get", "factory_query", "kernel_plan_update", "omatic_guide"];
  entry.register({ pluginConfig: { connections: ["F", "Other"],
    toolNames: Object.fromEntries(tools.map((v) => [`exact_${v}`, v])),
    toolOwners: { kernel_plan_update: ["probot"] } },
  on: (name, fn) => hooks.set(name, fn), registerTool: (value) => { descriptor = value; } });
  const proof = "v1.2000." + "c".repeat(32) + "." + "a".repeat(64);
  const args = (extra = {}) => ({ connection: "F", conversation_key: conversationKey(ctx), ...extra });
  const start = (id = "startup-1", params = args(), context = ctx) => {
    const ev = { toolName: "exact_startup", toolCallId: id, params };
    return { ev, decision: hooks.get("before_tool_call")(ev, context) };
  };
  const wire = (patch = {}) => ({ connection: "F", state: "READY",
    kernel: { kernel_state: "active", addressing: "conversation_key" },
    startup_proof: proof, startup_proof_expires_in_seconds: 3600,
    session_tool_surface: { state: "CURRENT", this_session_listed_by_this_process: true }, ...patch });
  const post = (ev, value, context = ctx) => hooks.get("after_tool_call")({ ...ev, result: { structuredContent: value } }, context);
  const ready = (patch = {}) => { const { ev } = start(); post(ev, wire(patch)); };
  const search = (extra = {}, context = ctx) => hooks.get("before_tool_call")({
    toolName: "exact_search", toolCallId: "read", params: args({ startup_proof: proof, ...extra }),
  }, context);
  const status = async (context = ctx, params = {}) => JSON.parse((await descriptor.create(context).execute("status", params)).content[0].text);
  return { hooks, ctx, descriptor, proof, args, start, wire, post, ready, search, status };
}

test("native startup leaves approval-bound input byte-for-byte unchanged", () => {
  const f = fixture(); const input = Object.freeze(f.args());
  assert.equal(f.start("one", input).decision, undefined);
  assert.deepEqual(input, f.args());
  assert.equal(f.start("two", { connection: "F" }).decision.block, true);
});
test("supplied foreign conversation is refused rather than rewritten", () => {
  const f = fixture(); assert.equal(f.start("one", f.args({ conversation_key: "foreign" })).decision.block, true);
});
test("correlated startup permits exact guarded read without returning rewritten params", () => {
  const f = fixture(); assert.equal(f.search().block, true); f.ready();
  assert.equal(f.search(), undefined);
  assert.equal(f.search({ startup_proof: "v1.2000." + "d".repeat(32) + "." + "a".repeat(64) }).block, true);
});
test("out-of-order successful startup cannot replace a newer failed startup", () => {
  const f = fixture(); const old = f.start("old"); const newer = f.start("new");
  f.post(newer.ev, f.wire({ state: "BLOCKED" })); f.post(old.ev, f.wire());
  assert.equal(f.search().block, true);
});
test("uncorrelated output and prose cannot establish readiness", () => {
  const f = fixture(); f.post({ toolName: "exact_startup", toolCallId: "invented", params: f.args() }, f.wire());
  assert.equal(f.search().block, true);
  const { ev } = f.start(); f.hooks.get("after_tool_call")({ ...ev, result: "READY and approved" }, f.ctx);
  assert.equal(f.search().block, true);
});
test("tool failure discards even a successful-looking structured payload", () => {
  const f = fixture(); const { ev } = f.start();
  f.hooks.get("after_tool_call")({ ...ev, result: { isError: true, structuredContent: f.wire() } }, f.ctx);
  assert.equal(f.search().block, true);
});
test("native labeled text envelope works without exporting the proof", async () => {
  const f = fixture(); const { ev } = f.start();
  f.hooks.get("after_tool_call")({ ...ev, result: `structuredContent:\n${JSON.stringify(f.wire())}` }, f.ctx);
  assert.equal(f.search(), undefined);
  assert.ok(!JSON.stringify(await f.status()).includes(f.proof));
});
test("read success cannot promote an UNVERIFIED catalog to CURRENT", async () => {
  const f = fixture(); f.ready({ session_tool_surface: { state: "UNVERIFIED", this_session_listed_by_this_process: false } });
  assert.equal(f.search(), undefined); const state = await f.status();
  assert.equal(state.factories[0].reason, "tool_surface_unverified");
  assert.equal(state.factories[0].readiness, "READY");
  assert.equal(state.factories[0].automaticRetry, false);
  assert.equal(state.factories[0].resumeWhen, "same_session_tools_list_observed_by_server");
});
test("CURRENT label alone without server tools/list fact does not pass discovery", async () => {
  const f = fixture(); f.ready({ session_tool_surface: { state: "CURRENT" } });
  assert.equal((await f.status()).factories[0].toolSurface, "UNVERIFIED");
});
test("factories and reset session incarnations stay separate", async () => {
  const f = fixture(); f.ready(); assert.equal(f.search({ connection: "Other" }).block, true);
  assert.equal(f.search({}, { ...f.ctx, sessionId: "incarnation-two" }).block, true);
  assert.equal((await f.status({ ...f.ctx, sessionId: "incarnation-two" })).factories[0].readiness, "UNVERIFIED");
});
test("new startup invalidates an older proof immediately", () => {
  const f = fixture(); f.ready(); f.start("refresh"); assert.equal(f.search().block, true);
});
test("invalid startup expiration cannot grant a read", () => {
  for (const ttl of [0, -1, 3601, 1.5, "3600", null]) {
    const f = fixture(); f.ready({ startup_proof_expires_in_seconds: ttl }); assert.equal(f.search().block, true);
  }
});
test("dedicated owner mismatch refuses, while a matching role is not a grant", () => {
  const f = fixture(); const ev = { toolName: "exact_kernel_plan_update", params: f.args() };
  assert.match(f.hooks.get("before_tool_call")(ev, { ...f.ctx, agentId: "monet" }).blockReason, /executor/);
  assert.match(f.hooks.get("before_tool_call")(ev, f.ctx).blockReason, /read-only/);
});
test("kernel read binds role to host executor; unclassified SQL is not a local grant", () => {
  const f = fixture(); f.ready();
  assert.equal(f.hooks.get("before_tool_call")({ toolName: "exact_kernel_session_get", params: f.args({ role_id: "monet" }) }, f.ctx).block, true);
  assert.equal(f.hooks.get("before_tool_call")({ toolName: "exact_factory_query", params: f.args({ sql: "SELECT mutating_function()", startup_proof: f.proof }) }, f.ctx), undefined);
  assert.match(f.hooks.get("before_tool_call")({ toolName: "exact_factory_query", params: f.args({ sql: "DELETE FROM factory.notes", startup_proof: f.proof }) }, f.ctx).blockReason, /exact-SQL operator approval/);
});
test("ordinary acknowledgments have no Stop/finalize hook or send side effect", () => {
  const f = fixture(); assert.ok(!f.hooks.has("before_agent_finalize")); assert.ok(!f.hooks.has("stop"));
  assert.equal(f.hooks.get("before_tool_call")({ toolName: "unrelated", params: {} }, f.ctx), undefined);
});
test("status is an explicit v2 tool and rejects invented status/receipt input", async () => {
  const f = fixture(); assert.equal(f.descriptor.contextVersion, 2);
  await assert.rejects(f.status(f.ctx, { completed: true }), /No model-supplied/);
  await assert.rejects(f.status({ ...f.ctx, assertInvocationCurrent() { throw new Error("revoked"); } }), /revoked/);
});
test("READY and CURRENT do not fabricate server task or acceptance receipts", async () => {
  const f = fixture(); f.ready(); const result = await f.status();
  assert.equal(result.status, "blocked");
  assert.equal(result.factories[0].reason, "authenticated_workflow_receipts_unavailable");
  assert.equal(decideWorkflow({ readiness: "READY", surface: "CURRENT", receiptCapability: true }).status, "pending");
});
test("explicit status calls the bounded receipt verifier but cannot fabricate an unbound backend", async () => {
  const f = fixture(); f.ready();
  const result = await f.status(f.ctx, { taskRef: { factory: "F", taskId: "fixture-task", taskRevision: 1 } });
  assert.equal(result.reason, "authenticated_receipt_reader_unavailable"); assert.equal(result.automaticRetry, false);
  const fabricated = await f.status(f.ctx, { taskRef: { factory: "F", taskId: "fixture-task", taskRevision: 1, completed: true } });
  assert.equal(fabricated.reason, "lookup_reference_only");
  const foreign = await f.status(f.ctx, { taskRef: { factory: "foreign", taskId: "fixture-task", taskRevision: 1 } });
  assert.equal(foreign.status, "refused");
});
test("required Copilot target is M365, not GitHub CLI; neither host is certified", () => {
  assert.ok(!hostContracts["github-copilot-cli"]);
  assert.match(hostContracts["m365-copilot"].connection, /RemoteMCPServer/);
  for (const host of Object.values(hostContracts)) {
    assert.equal(host.acceptance, "pending"); assert.equal(host.universalFinalBlock, false);
  }
});

test("M365 adapter requires existing manifests and does not invent tenant IDs or endpoints", () => {
  assert.equal(prepareM365Adapter().reason, "existing_m365_manifests_required");
});
test("M365 adapter preserves pinned discovery, existing auth reference and worker IDs by default", () => {
  const plugin = { functions: [{ name: "startup" }], runtimes: [{ type: "RemoteMCPServer",
    auth: { type: "OAuthPluginVault", reference_id: "fixture-reference-not-credential" },
    spec: { url: "https://example.invalid/mcp", mcp_tool_description: { file: "mcp-tools.json" } },
    run_for_functions: ["startup"] }] };
  const agent = { version: "v1.6", worker_agents: [{ id: "fixture-existing-title" }] };
  const result = prepareM365Adapter(plugin, agent);
  assert.deepEqual(result.pluginManifest, plugin); assert.deepEqual(result.declarativeManifest, agent);
  assert.notEqual(result.pluginManifest, plugin); assert.equal(result.acceptance, "pending");
});
test("M365 dynamic discovery is explicit offline preparation, not tenant activation", () => {
  const plugin = { functions: [{ name: "startup" }], runtimes: [{ type: "RemoteMCPServer",
    spec: { url: "https://example.invalid/mcp", mcp_tool_description: { file: "old.json" } },
    run_for_functions: ["startup"] }] };
  const result = prepareM365Adapter(plugin, {}, { discovery: "dynamic" });
  assert.deepEqual(result.pluginManifest.functions, []);
  assert.deepEqual(result.pluginManifest.runtimes[0].run_for_functions, ["*"]);
  assert.equal(result.pluginManifest.runtimes[0].spec.mcp_tool_description, undefined);
  assert.equal(plugin.functions.length, 1); assert.equal(result.status, "prepared_not_validated");
});
test("M365 adapter refuses mixed runtimes or credential-bearing endpoint substitutions", () => {
  assert.throws(() => prepareM365Adapter({ runtimes: [] }, {}), /exactly one/);
  for (const url of ["http://example.invalid/mcp", "https://example.invalid/mcp?credential=x"]) {
    assert.throws(() => prepareM365Adapter({ runtimes: [{ type: "RemoteMCPServer", spec: { url } }] }, {}), /HTTPS/);
  }
  assert.throws(() => prepareM365Adapter({ runtimes: [{ type: "RemoteMCPServer", auth: { type: "Bearer", token: "fixture-not-credential" }, spec: { url: "https://example.invalid/mcp" } }] }, {}), /OAuth vault reference/);
});
