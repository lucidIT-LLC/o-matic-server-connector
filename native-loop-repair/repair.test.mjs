import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import original from "./original/index.mjs";
import proposed from "./proposed/index.mjs";

const key = (ctx) => `openclaw:${createHash("sha256").update(JSON.stringify([ctx.agentId, ctx.sessionKey])).digest("hex")}`;
function fixture(entry = proposed) {
  const hooks = new Map();
  entry.register({ on: (name, fn) => hooks.set(name, fn), pluginConfig: { connections: ["F"],
    agentFactoryMap: { probot: "F", monet: "F" }, toolNames: Object.fromEntries([
      "startup", "search", "factory_query", "factory_owner_ddl", "kernel_plan_update",
    ].map((name) => [`exact_${name}`, name])) } });
  const ctx = { agentId: "probot", sessionKey: "agent:probot:main", runId: "repair-contract-run" };
  const proof = "v1.2000." + "c".repeat(32) + "." + "a".repeat(64);
  const args = (context = ctx) => ({ connection: "F", conversation_key: key(context) });
  const pre = (name, params, context = ctx) => hooks.get("before_tool_call")({ toolName: `exact_${name}`, toolCallId: "call-1", params }, context);
  const ready = () => {
    pre("startup", args());
    hooks.get("after_tool_call")({ toolName: "exact_startup", toolCallId: "call-1", params: args(),
      result: { structuredContent: { state: "READY", connection: "F", kernel: { addressing: "conversation_key", kernel_state: "active" },
        startup_proof: proof, startup_proof_expires_in_seconds: 3600 } } }, ctx);
  };
  return { hooks, ctx, proof, args, pre, ready };
}
test("installed-source original reproduces generic finalization loop after acknowledgment", () => {
  const f = fixture(original); f.hooks.get("before_prompt_build")({ currentUserMessageId: "ack-only" }, f.ctx);
  const result = f.hooks.get("before_agent_finalize")({}, f.ctx);
  assert.equal(result.action, "revise"); assert.match(result.reason, /run READY startup/);
});
test("proposed surgical repair removes generic Stop/finalize retries only", () => {
  const oldHooks = fixture(original).hooks; const newHooks = fixture().hooks;
  assert.deepEqual([...newHooks.keys()].sort(), [...oldHooks.keys()].filter((name) => name !== "before_agent_finalize").sort());
});
test("actual installed-source-derived startup and search never return replacement parameters", () => {
  const f = fixture(); const args = Object.freeze(f.args()); assert.equal(f.pre("startup", args), undefined);
  f.ready(); const read = Object.freeze({ ...args, startup_proof: f.proof });
  assert.equal(f.pre("search", read), undefined); assert.equal(read.startup_proof, f.proof);
});
test("missing explicit key and missing own proof are refused before approval", () => {
  const f = fixture(); assert.equal(f.pre("startup", { connection: "F" }).block, true);
  f.ready(); assert.equal(f.pre("search", f.args()).block, true);
  assert.equal(f.pre("search", { ...f.args(), startup_proof: "not-own-proof" }).block, true);
});
test("repair does not relax READY, conversation isolation, SQL mutation or plan-owner gates", () => {
  const f = fixture(); assert.equal(f.pre("search", { ...f.args(), startup_proof: f.proof }).block, true);
  f.ready(); assert.equal(f.pre("factory_query", { ...f.args(), sql: "INSERT INTO fixture VALUES (1)", startup_proof: f.proof }).block, true);
  const other = { ...f.ctx, sessionKey: "other-conversation" };
  assert.equal(f.pre("search", { ...f.args(other), startup_proof: f.proof }, other).block, true);
  const monet = { ...f.ctx, agentId: "monet" };
  assert.match(f.pre("kernel_plan_update", f.args(monet), monet).blockReason, /only the existing Probot/);
});
test("repair context never tells native callers to omit arguments or retry discovery with reads", () => {
  const f = fixture(); const prompt = f.hooks.get("before_prompt_build")({}, f.ctx).prependContext;
  assert.match(prompt, /never rewrites/); assert.match(prompt, /Ordinary acknowledgments need no factory calls/);
  assert.ok(!prompt.includes("omit conversation_key")); assert.ok(!prompt.includes("host hook injects"));
});
test("preserved original and proposed source hashes match exact guarded review packet", async () => {
  const review = JSON.parse(await readFile(new URL("./REVIEW.json", import.meta.url), "utf8"));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(await readFile(new URL("./original/index.mjs", import.meta.url))), review.expectedOriginalSha256);
  const current = JSON.parse(await readFile(new URL("./CURRENT-SOURCE.json", import.meta.url), "utf8"));
  assert.equal(hash(await readFile(new URL("./proposed/index.mjs", import.meta.url))), current.sourceSha256);
  const observed = hash(await readFile(review.target));
  const compiled = hash(await readFile(new URL('../dist-runtime/index.js', import.meta.url)));
  assert.ok(observed === review.expectedOriginalSha256 || observed === compiled,
    'installed file must be the verified original or exact compiled candidate; unrelated drift refuses');
});
