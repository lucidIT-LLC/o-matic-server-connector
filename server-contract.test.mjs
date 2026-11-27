import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { hostCanIntercept, hostEnforcement, serverBacked, PLUGIN_ID } from "./server-contract.mjs";

test("host interception matrix matches declared enforcement", async () => {
  assert.equal(PLUGIN_ID, "omatic-governance");
  assert.equal(hostCanIntercept("grok"), false);
  assert.equal(hostCanIntercept("hermes"), false);
  assert.equal(hostCanIntercept("m365-copilot"), false);
  assert.equal(hostCanIntercept("openclaw"), true);
  assert.equal(hostCanIntercept("cursor"), true);
  assert.equal(hostCanIntercept("codex"), true);
  for (const host of Object.keys(hostEnforcement)) {
    assert.equal(hostEnforcement[host].pluginId, PLUGIN_ID);
    assert.equal(hostEnforcement[host].package, PLUGIN_ID);
    assert.equal(hostEnforcement[host].agentsIncluded, true);
  }
  assert.equal(serverBacked.localProcessMemoryIsDurable, false);
  assert.equal(serverBacked.durableDelegationRecord, "server-ledger");
  assert.equal(serverBacked.agentGold, "factory.persona-version");
  const manifest = JSON.parse(
    await readFile(new URL("./hosts/CROSS-HOST-BUNDLE.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.universalHarness, false);
  assert.equal(manifest.status, "NOT_APPROVED");
  assert.equal(manifest.onePlugin, true);
  assert.equal(manifest.pluginId, PLUGIN_ID);
  assert.equal(manifest.agentsIncluded, true);
  assert.equal(manifest.doctrine.aiIsAi, true);
  assert.equal(manifest.packages.grok.clientEnforcement, false);
  assert.equal(manifest.packages.cursor.pluginId, PLUGIN_ID);
  assert.equal(manifest.packages.copilot.pluginId, PLUGIN_ID);
  assert.equal(manifest.packages.hermes.agentDocStandard, "hermes");
  assert.equal(manifest.packages.openclaw.agentDocStandard, "openclaw");
});
