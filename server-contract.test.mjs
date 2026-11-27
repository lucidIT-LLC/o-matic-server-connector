import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { hostCanIntercept, hostEnforcement, serverBacked } from "./server-contract.mjs";

test("host interception matrix matches declared enforcement", async () => {
  assert.equal(hostCanIntercept("grok"), false);
  assert.equal(hostCanIntercept("m365-copilot"), false);
  assert.equal(hostCanIntercept("openclaw"), true);
  assert.equal(hostCanIntercept("codex"), true);
  assert.equal(hostEnforcement.grok.package, null);
  assert.equal(serverBacked.localProcessMemoryIsDurable, false);
  assert.equal(serverBacked.durableDelegationRecord, "server-ledger");
  const manifest = JSON.parse(
    await readFile(new URL("./hosts/CROSS-HOST-BUNDLE.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.universalHarness, false);
  assert.equal(manifest.status, "NOT_APPROVED");
  assert.equal(manifest.packages.grok.clientEnforcement, false);
});
