import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareM365Adapter } from "./m365-adapter.mjs";
import { materializeCrossHost, copilotZipSha256 } from "./materialize-cross-host.mjs";

const zipPath = new URL("../landing-lanes/probot/omatic-server-0.1.7-mcp.zip", import.meta.url);
const ajvPath = "/Users/lucid/.openclaw/runtime/2026.11.9-release-0032b1d7ffd0-2026-11-25T00-25-41.000Z/lib/node_modules/openclaw/node_modules/ajv/dist/2020.js";

test("cross-host packages materialize and local checks refuse unsafe SQL", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "omatic-cross-host-"));
  const manifest = await materializeCrossHost(out, { copilotZip: zipPath.pathname });
  assert.equal(manifest.status, "NOT_APPROVED");
  assert.equal(manifest.universalHarness, false);
  assert.equal(manifest.packages.copilot.declarativeAgentRequired, false);
  assert.equal(manifest.packages.grok.clientEnforcement, false);
  const plugin = JSON.parse(await readFile(path.join(out, "codex/plugin.json"), "utf8"));
  const schema = JSON.parse(await readFile(new URL("./build-workspaces/platform-schema/plugin.schema.json", import.meta.url), "utf8"));
  const Ajv = createRequire(import.meta.url)(ajvPath);
  const ajv = new Ajv({ allErrors: true, strict: false });
  assert.equal(ajv.compile(schema)(plugin), true);
  const command = JSON.parse(await readFile(path.join(out, "codex/hooks/hooks.json"), "utf8")).hooks.PreToolUse[0].hooks[0].command;
  const run = (sql) => spawnSync("/bin/sh", ["-c", command], {
    input: JSON.stringify({ tool_name: "mcp__o_MATIC_Server__factory_query", tool_input: {
      conversation_key: "fixture-own-conversation", sql,
      startup_proof: "v1.2000." + "a".repeat(32) + "." + "b".repeat(64),
    } }),
    encoding: "utf8", env: { ...process.env, PLUGIN_ROOT: path.join(out, "codex") },
  });
  assert.equal(run("SELECT id FROM factory.tasks WHERE id = 1 LIMIT 1;").status, 0);
  const denied = run("SELECT 1; DELETE FROM factory.tasks");
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /exact-SQL human approval bridge/);
  const zipBytes = await readFile(path.join(out, "copilot/omatic-server-0.1.7-mcp.zip"));
  assert.equal(createHash("sha256").update(zipBytes).digest("hex"), copilotZipSha256);
  const grok = JSON.parse(await readFile(path.join(out, "grok/MCP-SETUP.json"), "utf8"));
  assert.equal(grok.clientEnforcement, false);
  assert.equal(grok.universalHarness, false);
  const connection = prepareM365Adapter({ runtimes: [{ type: "RemoteMCPServer", spec: { url: "https://factory.o-matic.ai/mcp" },
    auth: { type: "OAuthPluginVault", reference_id: "existing-reference" } }] }, {}, { acceptanceScope: "connection" });
  assert.equal(connection.requiredChecks.includes("each_existing_worker_title_id_acquired"), false);
  assert.equal(connection.guarantees.credentialsChanged, false);
});
