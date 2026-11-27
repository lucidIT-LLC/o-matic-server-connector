import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareCodexAdapter } from "./codex-adapter.mjs";
import { prepareM365Adapter } from "./m365-adapter.mjs";

const toolNames = { mcp__o_MATIC_Server__startup: "startup",
  mcp__o_MATIC_Server__search: "search", mcp__o_MATIC_Server__factory_query: "factory_query",
  mcp__codex_apps__o_matic_server_mcp_startup: "startup",
  mcp__codex_apps__o_matic_server_mcp_search: "search",
  mcp__codex_apps__o_matic_server_mcp_factory_query: "factory_query" };
const version = "1.0.1-candidate.6";

test("Codex native loader overlay declares one plugin-root hook path and preserves portable root", async () => {
  const result = await prepareCodexAdapter({ toolNames, version });
  const portable = JSON.parse(result.files["plugin.json"]);
  const native = JSON.parse(result.files[".codex-plugin/plugin.json"]);
  assert.deepEqual(native, { name: portable.name, version: portable.version, hooks: "./hooks/hooks.json" });
  assert.equal(portable.version, version);
  assert.equal(portable.extensions["com.openai"].hooks, "./hooks/hooks.json");
  assert.equal(path.posix.normalize(native.hooks), "hooks/hooks.json");
  assert.ok(Object.hasOwn(result.files, path.posix.normalize(native.hooks)));
  const hooks = JSON.parse(result.files[path.posix.normalize(native.hooks)]);
  assert.deepEqual(Object.keys(hooks.hooks), ["PreToolUse"]);
  assert.equal(hooks.hooks.PreToolUse.length, 1);
  assert.equal(hooks.hooks.PreToolUse[0].hooks.length, 1);
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, 'python3 "${PLUGIN_ROOT}/hooks/preflight.py"');
  assert.ok(result.requiredChecks.includes("native_hooks_installed_count_observed"));
  assert.equal(result.files["mcp.json"], undefined);
  assert.deepEqual(Object.keys(result.files).sort(), [".codex-plugin/plugin.json", "hooks/hooks.json", "hooks/preflight.py", "hooks/tool-names.json", "plugin.json"]);
});

test("Codex requires actual names and version; prepares no connection or authentication replacement", async () => {
  assert.equal((await prepareCodexAdapter()).status, "blocked");
  assert.equal((await prepareCodexAdapter({ toolNames })).reason, "source_version_required");
  assert.equal((await prepareCodexAdapter({ toolNames: { ...toolNames, "mcp__bad.*__search": "search" }, version })).status, "blocked");
  const result = await prepareCodexAdapter({ toolNames, version });
  assert.equal(result.acceptance, "pending");
  assert.equal(result.files["mcp.json"], undefined);
  assert.deepEqual(Object.values(result.changes), [false, false, false, false]);
  const hooks = JSON.parse(result.files["hooks/hooks.json"]).hooks;
  assert.deepEqual(Object.keys(hooks), ["PreToolUse"]);
  assert.match(hooks.PreToolUse[0].hooks[0].command, /"\$\{PLUGIN_ROOT\}\/hooks\/preflight.py"/);
  const matcher = new RegExp(hooks.PreToolUse[0].matcher);
  assert.ok(matcher.test("mcp__o_MATIC_Server__startup"));
  for (const name of Object.keys(toolNames)) assert.ok(matcher.test(name), name);
  assert.ok(!matcher.test("mcp__foreign__startup"));
  assert.ok(!matcher.test("mcp__o_MATIC_Server__startup_extra"));
});

test("Codex native app aliases preserve legacy coverage and refuse malformed or multistatement read input", async () => {
  const result = await prepareCodexAdapter({ toolNames, version });
  const base = new URL("./build-workspaces/", import.meta.url);
  const root = await mkdtemp(path.join(base.pathname, "codex native alias test "));
  for (const [name, body] of Object.entries(result.files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), body);
  }
  const hook = JSON.parse(result.files["hooks/hooks.json"]).hooks.PreToolUse[0];
  const matcher = new RegExp(hook.matcher);
  const args = { conversation_key: "fixture-own-conversation",
    startup_proof: "v1.2000." + "a".repeat(32) + "." + "b".repeat(64), sql: "SELECT 1 LIMIT 1;" };
  const run = payload => spawnSync("/bin/sh", ["-c", hook.hooks[0].command], {
    input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, PLUGIN_ROOT: root },
  });
  const original = JSON.stringify(args);
  for (const [name, method] of Object.entries(toolNames)) {
    assert.ok(matcher.test(name));
    assert.ok(!matcher.test(name + "_extra"));
    const allowed = run({ tool_name: name, tool_input: args });
    assert.equal(allowed.status, 0, allowed.stderr); assert.equal(allowed.stdout, "");
    const denied = run({ tool_name: name, tool_input: {} });
    assert.equal(denied.status, 2, name); assert.equal(denied.stdout, "");
    assert.ok(!denied.stderr.includes(args.startup_proof));
    if (method === "factory_query") {
      const multiple = run({ tool_name: name, tool_input: { ...args, sql: "SELECT 1; SELECT 2" } });
      assert.equal(multiple.status, 2, name); assert.equal(multiple.stdout, "");
      assert.match(multiple.stderr, /exact-SQL human approval bridge/);
    }
  }
  assert.ok(!matcher.test("mcp__codex_apps__foreign_startup"));
  assert.equal(JSON.stringify(args), original);
  for (const [name, body] of Object.entries(result.files)) assert.equal(await readFile(path.join(root, name), "utf8"), body);
});

test("Codex packaged source executes from a spaced plugin root: denies malformed input without rewrite or proof state", async () => {
  const result = await prepareCodexAdapter({ toolNames, version });
  const base = new URL("./build-workspaces/", import.meta.url);
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base.pathname, "codex adapter test "));
  for (const [name, body] of Object.entries(result.files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), body);
  }
  const command = JSON.parse(result.files["hooks/hooks.json"]).hooks.PreToolUse[0].hooks[0].command;
  const run = input => spawnSync("/bin/sh", ["-c", command], {
    input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, PLUGIN_ROOT: root },
  });
  const startup = { tool_name: "mcp__o_MATIC_Server__startup", tool_input: { conversation_key: "fixture-own-conversation" } };
  const query = { tool_name: "mcp__o_MATIC_Server__factory_query", tool_input: {
    conversation_key: "fixture-own-conversation", sql: "SELECT 1",
    startup_proof: "v1.2000." + "a".repeat(32) + "." + "b".repeat(64),
  } };
  const original = JSON.stringify(query);
  for (const input of [startup, query, { tool_name: "mcp__foreign__search" }]) {
    const output = run(input); assert.equal(output.status, 0, output.stderr); assert.equal(output.stdout, "");
  }
  for (const input of [{ ...startup, tool_input: {} }, { ...query, tool_input: { conversation_key: "fixture-own-conversation" } }, null]) {
    const output = run(input); assert.equal(output.status, 2); assert.equal(output.stdout, "");
    assert.ok(!output.stderr.includes(query.tool_input.startup_proof));
  }
  assert.equal(JSON.stringify(query), original);
  for (const [name, body] of Object.entries(result.files)) assert.equal(await readFile(path.join(root, name), "utf8"), body);
});

test("M365 connection scope does not require disabled receipts; existing worker requirements remain explicit", () => {
  const plugin = { runtimes: [{ type: "RemoteMCPServer", auth: { type: "OAuthPluginVault", reference_id: "fixture-vault-reference" },
    spec: { url: "https://example.invalid/mcp" } }] };
  const connection = prepareM365Adapter(plugin, {}, { acceptanceScope: "connection" });
  assert.ok(!connection.requiredChecks.includes("authenticated_workflow_receipt_backend"));
  assert.ok(connection.requiredChecks.includes("installable_m365_app_package_validated"));
  assert.ok(!connection.requiredChecks.includes("each_existing_worker_title_id_acquired"));
  assert.equal(connection.acceptance, "pending");
  assert.deepEqual(connection.disabledFeatures, ["workflow_receipt_enforcement"]);
  assert.deepEqual(connection.pluginManifest, plugin);
  const workers = prepareM365Adapter(plugin, { worker_agents: [{ id: "fixture-title" }] }, { acceptanceScope: "connection" });
  assert.ok(workers.requiredChecks.includes("actual_existing_worker_task_and_response"));
  assert.ok(prepareM365Adapter(plugin, {}).requiredChecks.includes("authenticated_workflow_receipt_backend"));
  assert.throws(() => prepareM365Adapter(plugin, {}, { acceptanceScope: "other" }), /scope/);
});

test("Codex SQL baseline refuses well-shaped generic writes and permits the narrow bounded read without rewriting", async () => {
  const result = await prepareCodexAdapter({ toolNames, version });
  const base = new URL("./build-workspaces/", import.meta.url);
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base.pathname, "codex sql refusal test "));
  for (const [name, body] of Object.entries(result.files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), body);
  }
  const command = JSON.parse(result.files["hooks/hooks.json"]).hooks.PreToolUse[0].hooks[0].command;
  const args = { conversation_key: "fixture-own-conversation",
    startup_proof: "v1.2000." + "a".repeat(32) + "." + "b".repeat(64) };
  const run = sql => spawnSync("/bin/sh", ["-c", command], {
    input: JSON.stringify({ tool_name: "mcp__o_MATIC_Server__factory_query", tool_input: { ...args, sql } }),
    encoding: "utf8", env: { ...process.env, PLUGIN_ROOT: root },
  });
  const original = JSON.stringify(args);
  const allowed = run("SELECT id FROM factory.tasks WHERE id = 1 LIMIT 1;");
  assert.equal(allowed.status, 0, allowed.stderr); assert.equal(allowed.stdout, "");
  for (const sql of ["DELETE FROM factory.tasks WHERE id = 1", "INSERT INTO factory.tasks (id) VALUES (1)",
    "UPDATE factory.tasks SET status = 'done' WHERE id = 1", "DROP TABLE factory.tasks",
    "SELECT 1; DELETE FROM factory.tasks", "SELECT id INTO temporary_copy FROM factory.tasks",
    "SELECT id FROM factory.tasks WHERE id = 1 FOR UPDATE", "SELECT id FROM factory.tasks WHERE id = 1 FOR SHARE"]) {
    const denied = run(sql); assert.equal(denied.status, 2, sql); assert.equal(denied.stdout, "");
    assert.match(denied.stderr, /exact-SQL human approval bridge/);
    assert.ok(!denied.stderr.includes(args.startup_proof));
  }
  assert.equal(JSON.stringify(args), original);
});
