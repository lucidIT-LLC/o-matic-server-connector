import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { hostContracts } from "./workflow.mjs";
import { PLUGIN_ID } from "./server-contract.mjs";

test("cross-host manifest names every required host and one plugin projects agents from gold", async () => {
  const manifest = JSON.parse(await readFile(new URL("./CROSS-HOST-RELEASE.json", import.meta.url), "utf8"));
  assert.equal(manifest.status, "NOT_APPROVED");
  assert.equal(manifest.pluginId, PLUGIN_ID);
  assert.equal(manifest.onePlugin, true);
  assert.equal(manifest.doctrine.aiIsAi, true);
  assert.deepEqual(
    Object.keys(manifest.hosts).sort(),
    ["codex", "cursor", "grok", "hermes", "m365-copilot", "openclaw"],
  );
  assert.equal(manifest.hosts.hermes.agentDocStandard, "hermes");
  assert.equal(manifest.hosts.hermes.acceptance, "packaging_declared");
  assert.equal(manifest.hosts.cursor.agentDocStandard, "cursor");
  assert.equal(manifest.hosts["m365-copilot"].agentDocStandard, "m365-copilot");
  assert.equal(manifest.hosts["m365-copilot"].acceptance, "packaging_declared");
  assert.equal(manifest.hosts.openclaw.agentDocStandard, "openclaw");
  // workflow hostContracts.acceptance remains pending = live host acceptance, not packaging declaration
  assert.equal(hostContracts["m365-copilot"].acceptance, "pending");
  assert.equal(manifest.hosts.grok.localAdapter, false);
  assert.equal(manifest.hosts.grok.component, null);
  assert.match(manifest.wholeProductIsNot, /host projections of the same plugin/);
  assert.equal(hostContracts.grok.localAdapter, false);
  assert.equal(hostContracts.codex.acceptance, "pending");
  assert.equal(hostContracts["m365-copilot"].acceptance, "pending");
  assert.equal(hostContracts.cursor.pluginId, PLUGIN_ID);
  assert.equal(hostContracts.hermes.agentsFromGold, true);
  for (const host of Object.values(hostContracts)) {
    assert.equal(host.pluginId, PLUGIN_ID);
    assert.equal(host.agentsFromGold, true);
  }
  const index = await readFile(new URL("./index.mjs", import.meta.url));
  assert.equal(createHash("sha256").update(index).digest("hex"), manifest.files["index.mjs"]);
});

test("agent-doc standards cover OpenClaw Hermes Copilot Cursor without host-unique forks", async () => {
  const identity = JSON.parse(await readFile(new URL("./hosts/PLUGIN-IDENTITY.json", import.meta.url), "utf8"));
  const docs = JSON.parse(await readFile(new URL("./hosts/agents/DOC-STANDARDS.json", import.meta.url), "utf8"));
  const projection = JSON.parse(await readFile(new URL("./hosts/agents/PROJECTION.json", import.meta.url), "utf8"));
  assert.deepEqual(identity.requiredHostAgentDocStandards, ["openclaw", "hermes", "m365-copilot", "cursor"]);
  assert.equal(identity.doctrine.aiIsAi, true);
  assert.equal(identity.doctrine.notHostUniqueForks, true);
  assert.equal(projection.doctrine.noHostUniqueForks, true);
  for (const host of identity.requiredHostAgentDocStandards) {
    const key = host === "m365-copilot" ? "m365-copilot" : host;
    assert.ok(docs.standards[key], `missing doc standard for ${host}`);
  }
  assert.equal(docs.doctrine.includes("one gold"), true);
});
