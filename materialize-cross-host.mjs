import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCodexAdapter } from "./codex-adapter.mjs";
import { PLUGIN_ID } from "./server-contract.mjs";

export const observedCodexToolNames = {
  mcp__o_MATIC_Server__startup: "startup",
  mcp__o_MATIC_Server__search: "search",
  mcp__o_MATIC_Server__factory_query: "factory_query",
  mcp__codex_apps__o_matic_server_mcp_startup: "startup",
  mcp__codex_apps__o_matic_server_mcp_search: "search",
  mcp__codex_apps__o_matic_server_mcp_factory_query: "factory_query",
};
export const codexVersion = "1.0.1-candidate.6";
export const candidateVersion = "1.0.1-candidate.4";
export const copilotZipSha256 = "0182aba3f9fed95ad1a9ab8e1d6bb0983d552c4903f8173ade5d8d89cb1fcc44";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));

async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  const { readdir, stat } = await import("node:fs/promises");
  for (const name of await readdir(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if ((await stat(from)).isDirectory()) await copyTree(from, to);
    else await cp(from, to);
  }
}

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

  await copyTree(path.join(here, "hosts", "cursor"), path.join(outDir, "cursor"));
  await copyTree(path.join(here, "hosts", "hermes"), path.join(outDir, "hermes"));
  await copyTree(path.join(here, "hosts", "openclaw"), path.join(outDir, "openclaw"));
  await copyTree(path.join(here, "hosts", "agents"), path.join(outDir, "agents"));
  await cp(path.join(here, "hosts", "PLUGIN-IDENTITY.json"), path.join(outDir, "PLUGIN-IDENTITY.json"));

  const copilotDir = path.join(outDir, "copilot");
  await mkdir(copilotDir, { recursive: true });
  await cp(copilotZip, path.join(copilotDir, "omatic-server-0.1.7-mcp.zip"));
  await cp(path.join(here, "hosts", "copilot", "HOST.json"), path.join(copilotDir, "HOST.json"));

  const grok = {
    host: "grok",
    pluginId: PLUGIN_ID,
    candidateVersion,
    samePluginAs: ["openclaw", "hermes", "cursor", "m365-copilot", "codex"],
    agentsIncluded: true,
    skillsIncluded: true,
    status: "NOT_APPROVED",
    mcpUrl: "https://factory.o-matic.ai/mcp",
    urlSource: "existing Copilot connector manifest remoteMcpServer.mcpServerUrl",
    clientEnforcement: false,
    universalHarness: false,
    limits: [
      "No local plugin, hook, or proof cache is included.",
      "A turn that never calls the Server is not governed.",
      "Server authentication remains the Server's own check.",
      "Agent/skill text still projects from DB gold — not a Grok-only fork.",
    ],
  };
  const grokPath = path.join(outDir, "grok", "MCP-SETUP.json");
  await mkdir(path.dirname(grokPath), { recursive: true });
  await writeFile(grokPath, JSON.stringify(grok, null, 2) + "\n");

  const identity = JSON.parse(await readFile(path.join(here, "hosts", "PLUGIN-IDENTITY.json"), "utf8"));
  const files = {};
  for (const [name, body] of Object.entries(codex.files)) files[`codex/${name}`] = sha256(Buffer.from(body));
  files["copilot/omatic-server-0.1.7-mcp.zip"] = sha256(zipBytes);
  files["copilot/HOST.json"] = sha256(await readFile(path.join(copilotDir, "HOST.json")));
  files["grok/MCP-SETUP.json"] = sha256(Buffer.from(JSON.stringify(grok, null, 2) + "\n"));
  files["PLUGIN-IDENTITY.json"] = sha256(await readFile(path.join(outDir, "PLUGIN-IDENTITY.json")));
  files["agents/DOC-STANDARDS.json"] = sha256(await readFile(path.join(outDir, "agents", "DOC-STANDARDS.json")));
  files["agents/PROJECTION.json"] = sha256(await readFile(path.join(outDir, "agents", "PROJECTION.json")));
  files["cursor/HOST.json"] = sha256(await readFile(path.join(outDir, "cursor", "HOST.json")));
  files["hermes/HOST.json"] = sha256(await readFile(path.join(outDir, "hermes", "HOST.json")));
  files["openclaw/HOST.json"] = sha256(await readFile(path.join(outDir, "openclaw", "HOST.json")));

  const shared = {
    pluginId: PLUGIN_ID,
    candidateVersion,
    agentsIncluded: true,
    skillsIncluded: true,
    doctrine: identity.doctrine,
    acceptance: "pending",
  };
  const manifest = {
    product: "o-MATIC Server Connector",
    pluginId: PLUGIN_ID,
    status: "NOT_APPROVED",
    universalHarness: false,
    installed: false,
    onePlugin: true,
    agentsIncluded: true,
    skillsIncluded: true,
    doctrine: identity.doctrine,
    packages: {
      openclaw: { ...shared, agentDocStandard: "openclaw", artifact: "native openclaw.plugin.json + dist-runtime" },
      hermes: { ...shared, agentDocStandard: "hermes", artifact: "hosts/hermes context-file projection" },
      cursor: { ...shared, agentDocStandard: "cursor", artifact: "hosts/cursor hooks + agent/skill projection" },
      copilot: {
        ...shared,
        host: "m365-copilot",
        agentDocStandard: "m365-copilot",
        artifact: "omatic-server-0.1.7-mcp.zip",
        authorization: "existing OAuthPluginVault reference preserved; not rewritten",
        declarativeAgentRequired: false,
      },
      codex: { ...shared, version: codexVersion, coverage: codex.coverage },
      grok: { ...shared, clientEnforcement: false },
    },
    files,
    externalGates: [
      "OpenClaw/Hermes/Cursor/Copilot: agent-doc projections filled from DB gold (no host-unique forks)",
      "Codex: owner hook trust, install, and a live refusal that stops multistatement SQL before the Server",
      "Copilot: signed-in tenant connector acceptance; no new app or auth",
      "Grok: live MCP connection check; no client enforcement exists to install",
      "Cursor: Desktop beforeMCPExecution intercept on a Desktop agent path (Project agent MCP bypasses hooks)",
    ],
  };
  const manifestPath = path.join(outDir, "CROSS-HOST-BUNDLE.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
