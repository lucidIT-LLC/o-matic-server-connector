import assert from "node:assert/strict";
import { test } from "node:test";
import { executeOrchestration, executeServerCall, serverCall } from "./shared-host-adapter.mjs";

const proof = "v1.2000." + "a".repeat(32) + "." + "b".repeat(64);

test("guarded search requires both key and proof, and no planning result contains the proof", async () => {
  let seen;
  const planned = serverCall("codex", "search", {
    connection: "F", query: "SOP-026", conversation_key: "own-key", startup_proof: proof,
    tenant_id: "omatic", limit: 5, tier: "semantic",
  });
  assert.equal(planned.admitted, true);
  assert.equal(JSON.stringify(planned).includes(proof), false);
  const result = await executeServerCall("codex", "search", {
    connection: "F", query: "SOP-026", conversation_key: "own-key", startup_proof: proof,
    tenant_id: "omatic", limit: 5, tier: "semantic",
  }, async (call) => {
    seen = call;
    return { isError: false, structuredContent: { rows: [], startup_proof: proof, note: `kept ${proof} in text` } };
  });
  assert.equal(seen.arguments.conversation_key, "own-key");
  assert.equal(seen.arguments.startup_proof, proof);
  assert.equal(seen.arguments.tenant_id, "omatic");
  assert.equal(seen.arguments.limit, 5);
  assert.equal(seen.arguments.tier, "semantic");
  assert.equal(JSON.stringify(result).includes(proof), false);
  const transport = async () => { throw new Error("must not send"); };
  assert.equal((await executeServerCall("grok", "search", { connection: "F", query: "x", conversation_key: "own-key" }, transport)).reason, "startup_proof_required");
  assert.equal((await executeServerCall("grok", "search", { connection: "F", query: "x", startup_proof: proof }, transport)).reason, "conversation_key_required");
});

test("refusal envelopes and embedded proof text do not return the proof", async () => {
  const refused = await executeServerCall("openclaw", "search", {
    connection: "F", query: "SOP-026", conversation_key: "own-key", startup_proof: proof,
  }, async () => ({ isError: false, structuredContent: { kernel_state: "unavailable", reason_code: "role_not_admitted", detail: proof } }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "server_refused");
  assert.equal(JSON.stringify(refused).includes(proof), false);
  const thrown = await executeServerCall("openclaw", "kernel_session_get", {
    connection: "F", role_id: "carver", conversation_key: "own-key",
  }, async () => { throw new Error(`boom ${proof}`); });
  assert.equal(thrown.ok, false);
  assert.equal(JSON.stringify(thrown).includes(proof), false);
  assert.match(thrown.detail, /\[redacted\]/);
});

test("orchestration execution stays closed without an explicit approval", () => {
  let called = false;
  const result = executeOrchestration("kernel_delegate", { connection: "F" }, () => { called = true; });
  assert.equal(called, false);
  assert.equal(result.executed, false);
  assert.equal(result.reason, "explicit_server_write_approval_required");
  assert.equal(result.orchestrationGate.complete, false);
});
