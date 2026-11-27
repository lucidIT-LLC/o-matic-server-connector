// Shared description of what each host can enforce. This does not call the Server.
// Durable memory, grants, and delegation authority stay on the Server.
// One plugin id everywhere: host packaging projects agents/skills from DB gold — no host-unique forks.
export const PLUGIN_ID = "omatic-governance";

export const hostEnforcement = Object.freeze({
  openclaw: Object.freeze({
    hooks: true, package: PLUGIN_ID, clientEnforcement: "optional-plugin",
    pluginId: PLUGIN_ID, agentDocStandard: "openclaw", agentsIncluded: true,
  }),
  hermes: Object.freeze({
    hooks: false, package: PLUGIN_ID, clientEnforcement: "none",
    pluginId: PLUGIN_ID, agentDocStandard: "hermes", agentsIncluded: true,
  }),
  cursor: Object.freeze({
    hooks: true, package: PLUGIN_ID, clientEnforcement: "optional-hook",
    pluginId: PLUGIN_ID, agentDocStandard: "cursor", agentsIncluded: true,
  }),
  codex: Object.freeze({
    hooks: true, package: PLUGIN_ID, clientEnforcement: "optional-hook",
    pluginId: PLUGIN_ID, agentDocStandard: "codex", agentsIncluded: true,
  }),
  "m365-copilot": Object.freeze({
    hooks: false, package: PLUGIN_ID, clientEnforcement: "none",
    pluginId: PLUGIN_ID, agentDocStandard: "m365-copilot", agentsIncluded: true,
  }),
  grok: Object.freeze({
    hooks: false, package: PLUGIN_ID, clientEnforcement: "none",
    pluginId: PLUGIN_ID, agentDocStandard: "grok", agentsIncluded: true,
  }),
});

export function hostCanIntercept(host) {
  const row = hostEnforcement[host];
  if (!row) throw new Error("unknown host");
  return row.hooks === true;
}

export const serverBacked = Object.freeze({
  durableDelegationRecord: "server-ledger",
  localProcessMemoryIsDurable: false,
  proofCheck: "server",
  sqlAuthority: "server-classify-and-postgresql-grants",
  agentGold: "factory.persona-version",
});
