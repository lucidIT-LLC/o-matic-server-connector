import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { prepareCodexAdapter } from "./codex-adapter.mjs";

export const observedCodexToolNames = {
  mcp__o_MATIC_Server__startup: "startup",
  mcp__o_MATIC_Server__search: "search",
  mcp__o_MATIC_Server__factory_query: "factory_query",
  mcp__codex_apps__o_matic_server_mcp_startup: "startup",
  mcp__codex_apps__o_matic_server_mcp_search: "search",
  mcp__codex_apps__o_matic_server_mcp_factory_query: "factory_query",
};
export const codexVersion = "1.0.1-candidate.6";
export const copilotZipSha256 = "0182aba3f9fed95ad1a9ab8e1d6bb0983d552c4903f8173ade5d8d89cb1fcc44";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function materializeCrossHost(outDir, { copilotZip }) {
  const zipBytes = await readFile(copilotZip);
  if (sha256(zipBytes) !== copilotZipSha256) throw new Error("Copilot zip hash does not match the recorded connector");
  const codex = await prepareCodexAdapter({ toolNames: observedCodexToolNames, version: codexVersion });
  if (codex.status !== "prepared_not_validated") throw new Error("Codex package was not prepared");
  const codexDir = path.join(outDir, "codex");
  for (const [name, body] of Object.entries(codex.files)) {
    const target = path.join(codexDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  const copilotDir = path.join(outDir, "copilot");
  await mkdir(copilotDir, { recursive: true });
  await cp(copilotZip, path.join(copilotDir, "omatic-server-0.1.7-mcp.zip"));
  const grok = {
    host: "grok",
    status: "NOT_APPROVED",
    mcpUrl: "https://factory.o-matic.ai/mcp",
    urlSource: "existing Copilot connector manifest remoteMcpServer.mcpServerUrl",
    clientEnforcement: false,
    universalHarness: false,
    limits: [
      "No local plugin, hook, or proof cache is included.",
      "A turn that never calls the Server is not governed.",
      "Server authentication remains the Server's own check.",
    ],
  };
  const grokPath = path.join(outDir, "grok", "MCP-SETUP.json");
  await mkdir(path.dirname(grokPath), { recursive: true });
  await writeFile(grokPath, JSON.stringify(grok, null, 2) + "\n");
  const files = {};
  for (const [name, body] of Object.entries(codex.files)) files[`codex/${name}`] = sha256(Buffer.from(body));
  files["copilot/omatic-server-0.1.7-mcp.zip"] = sha256(zipBytes);
  files["grok/MCP-SETUP.json"] = sha256(Buffer.from(JSON.stringify(grok, null, 2) + "\n"));
  const manifest = {
    product: "o-MATIC cross-host connection candidate",
    status: "NOT_APPROVED",
    universalHarness: false,
    installed: false,
    packages: {
      codex: { version: codexVersion, acceptance: codex.acceptance, coverage: codex.coverage },
      copilot: { artifact: "omatic-server-0.1.7-mcp.zip", acceptance: "pending",
        authorization: "existing OAuthPluginVault reference preserved; not rewritten",
        declarativeAgentRequired: false },
      grok: { acceptance: "pending", clientEnforcement: false },
    },
    files,
    externalGates: [
      "Codex: owner hook trust, install, and a live refusal that stops multistatement SQL before the Server",
      "Copilot: signed-in tenant connector acceptance; no new app or auth",
      "Grok: live MCP connection check; no client enforcement exists to install",
      "OpenClaw: separate host plugin remains uninstalled",
    ],
  };
  const manifestPath = path.join(outDir, "CROSS-HOST-BUNDLE.json");
  const body = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(manifestPath, body);
  return manifest;
}
