import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("actual package entry preserves working legacy reads instead of loading restricted prototype", async () => {
  const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.openclaw.extensions, ["./dist-runtime/index.js"]);
  const entry = (await import(new URL(pkg.openclaw.extensions[0], import.meta.url))).default;
  const hooks = new Map(); entry.register({ on: (name, fn) => { const handlers=hooks.get(name)??[];handlers.push(fn);hooks.set(name,handlers); }, registerTool() {}, pluginConfig: { connections: ["F"],
    toolNames: { exact_startup: "startup", exact_query: "factory_query", exact_search: "search", exact_status: "db_health_snapshot" } } });
  const ctx = { agentId: "probot", sessionKey: "agent:probot:main", runId: "package-run" };
  const key = `openclaw:${createHash("sha256").update(JSON.stringify([ctx.agentId, ctx.sessionKey])).digest("hex")}`;
  const args = { connection: "F", conversation_key: key };
  const proof = "v1.2000." + "c".repeat(32) + "." + "a".repeat(64);
  const start = { toolName: "exact_startup", toolCallId: "start", params: args };
  const before = (event, context) => { for(const handler of hooks.get("before_tool_call")){const result=handler(event,context);if(result?.block)return result;} };
  before(start, ctx);
  for(const handler of hooks.get("after_tool_call")) handler({ ...start, result: { structuredContent: { state: "READY", connection: "F",
    kernel: { addressing: "conversation_key", kernel_state: "active" }, startup_proof: proof, startup_proof_expires_in_seconds: 3600 } } }, ctx);
  assert.equal(before({ toolName: "exact_query", params: { ...args, startup_proof: proof,
    sql: "SELECT id FROM factory.tasks WHERE id = 1" } }, ctx), undefined);
  assert.equal(before({ toolName: "exact_search", params: { ...args, startup_proof: proof, query: "bounded read" } }, ctx), undefined);
  assert.equal(before({ toolName: "exact_status", params: { connection: "F" } }, ctx), undefined);
  assert.equal(before({ toolName: "exact_query", params: { ...args, startup_proof: proof,
    sql: "UPDATE factory.tasks SET status = 'done'" } }, ctx).block, true);
  assert.ok(!hooks.has("before_agent_finalize"));
});

test("package preserves original ID/schema/version and accepts only original or deployed reviewed manifest", async () => {
  const read = async (path) => JSON.parse(await readFile(path, "utf8"));
  const staged = await read(new URL("./openclaw.plugin.json", import.meta.url));
  const installed = await read("/Users/lucid/.openclaw/extensions/omatic-governance/openclaw.plugin.json");
  const pkg = await read(new URL("./package.json", import.meta.url));
  const installedPkg = await read("/Users/lucid/.openclaw/extensions/omatic-governance/package.json");
  const baseline = await read(new URL("./native-loop-repair/original/openclaw.plugin.json", import.meta.url));
  assert.equal(staged.id, installed.id);
  const stagedEnum = staged.configSchema.properties.toolNames.additionalProperties.enum;
  const installedEnum = installed.configSchema.properties.toolNames.additionalProperties.enum;
  for (const name of ["db_health_snapshot", "module_status", "ocr_result_get", "vision_page_get", "ladder_status"]) {
    assert.ok(stagedEnum.includes(name));
    assert.equal(installedEnum.includes(name), false);
  }
  assert.equal(baseline.id, installed.id);
  assert.notDeepEqual(staged.configSchema, installed.configSchema);
  assert.deepEqual(staged.contracts.gatewayMethodDispatch,['authenticated-request']);
  assert.equal(staged.name, "o-MATIC Server Connection"); assert.equal(pkg.version, installedPkg.version);
});
