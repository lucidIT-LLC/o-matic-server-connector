// Shared description of what each host can enforce. This does not call the Server.
// Durable memory, grants, and delegation authority stay on the Server.
export const hostEnforcement = Object.freeze({
  openclaw: Object.freeze({ hooks: true, package: "omatic-governance", clientEnforcement: "optional-plugin" }),
  codex: Object.freeze({ hooks: true, package: "codex-plugin", clientEnforcement: "optional-hook" }),
  "m365-copilot": Object.freeze({ hooks: false, package: "connector-zip", clientEnforcement: "none" }),
  grok: Object.freeze({ hooks: false, package: null, clientEnforcement: "none" }),
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
});
