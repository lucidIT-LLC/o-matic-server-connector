import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (rel) => JSON.parse(await readFile(path.join(here, rel), "utf8"));

test("core-crew builder outputs are committed, deterministic, and have no release key", () => {
  const result = spawnSync("python3", ["-B", "scripts/build_core_crew.py", "--check"], {
    cwd: here, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /check ok/);
});

test("bundled Claude plugin carries crew skills, agents, and a user-set MCP URL", async () => {
  const plugin = await readJson("hosts/claude/bundled/omatic-server-connection/.claude-plugin/plugin.json");
  assert.equal(plugin.version, "1.1.0");
  assert.equal(plugin.skills, "./skills/");
  assert.deepEqual(plugin.agents, ["./agents/probot.md", "./agents/fred.md", "./agents/data.md"]);
  assert.equal(plugin.mcpServers["o-matic-server"].url, "${user_config.server_url}");
  assert.equal(plugin.userConfig.server_url.default, "https://factory.o-matic.ai/mcp");
  assert.equal("release" in plugin, false);
  const market = await readJson(".claude-plugin/marketplace.json");
  assert.equal("release" in market, false);
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, "omatic-server-connection");
});

test("fallback Claude crew plugin depends on the connection plugin and declares no MCP server", async () => {
  const crew = await readJson("hosts/claude/fallback/omatic-core-crew/.claude-plugin/plugin.json");
  const connection = await readJson("hosts/claude/fallback/omatic-server-connection/.claude-plugin/plugin.json");
  assert.deepEqual(crew.dependencies, ["omatic-server-connection"]);
  assert.equal("mcpServers" in crew, false);
  assert.ok(connection.mcpServers["o-matic-server"]);
  assert.equal("skills" in connection, false);
});

test("bundled Cursor plugin carries skills, agents, hooks, and MCP", async () => {
  const plugin = await readJson("hosts/cursor/bundled/.cursor-plugin/plugin.json");
  assert.equal(plugin.version, "1.1.0");
  assert.equal(plugin.skills, "./skills/");
  assert.equal(plugin.agents, "./agents/");
  assert.equal(plugin.hooks, "./hooks/hooks.json");
  assert.equal(plugin.mcpServers, "./mcp.json");
  const mcp = await readJson("hosts/cursor/bundled/mcp.json");
  assert.equal(mcp.mcpServers["omatic-server"].url, "${SERVER_URL}");
});
