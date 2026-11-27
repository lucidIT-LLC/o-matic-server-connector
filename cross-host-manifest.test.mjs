import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { hostContracts } from "./workflow.mjs";

test("cross-host manifest names every requested host and does not treat one archive as the product", async () => {
  const manifest = JSON.parse(await readFile(new URL("./CROSS-HOST-RELEASE.json", import.meta.url), "utf8"));
  assert.equal(manifest.status, "NOT_APPROVED");
  assert.deepEqual(Object.keys(manifest.hosts).sort(), ["codex", "grok", "m365-copilot", "openclaw"]);
  assert.equal(manifest.hosts.grok.localAdapter, false);
  assert.equal(manifest.hosts.grok.component, null);
  assert.match(manifest.wholeProductIsNot, /OpenClaw tarball/);
  assert.equal(hostContracts.grok.localAdapter, false);
  assert.equal(hostContracts.codex.acceptance, "pending");
  assert.equal(hostContracts["m365-copilot"].acceptance, "pending");
  const index = await readFile(new URL("./index.mjs", import.meta.url));
  assert.equal(createHash("sha256").update(index).digest("hex"), manifest.files["index.mjs"]);
});
