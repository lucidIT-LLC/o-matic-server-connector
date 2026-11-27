// Portable decision policy, not a substitute for server-authenticated receipts.
// No credentials, SQL, host internals, network clients, timers, or agent spawning.
export function decideWorkflow({ readiness, surface, receiptCapability = false }) {
  if (readiness !== "READY") return { status: "blocked", reason: "ready_startup_required",
    automaticRetry: false, next: "Run one startup for an explicit factory operation; ordinary acknowledgments need no factory call." };
  if (surface !== "CURRENT") return { status: "blocked", reason: "tool_surface_unverified",
    automaticRetry: false, resumeWhen: "same_session_tools_list_observed_by_server",
    next: "Connection owner must diagnose or reconnect the existing MCP session. Repeating startup/search or CLI reload does not repair this measurement." };
  if (!receiptCapability) return { status: "blocked", reason: "authenticated_workflow_receipts_unavailable",
    automaticRetry: false, resumeWhen: "authenticated_receipt_reader_bound",
    next: "Bind verified server task/evidence/coordinator-acceptance operations before enabling completion." };
  // A capability assertion is not itself an acceptance/completion receipt.
  return { status: "pending", reason: "verified_completion_receipt_required", automaticRetry: false };
}

export const hostContracts = Object.freeze({
  codex: Object.freeze({ acceptance: "pending", connection: "existing host-managed MCP connection",
    argumentMode: "explicit-before-approval", universalFinalBlock: false }),
  "m365-copilot": Object.freeze({ acceptance: "pending", connection: "RemoteMCPServer with existing Entra connection",
    coordination: "worker_agents referencing acquired registered title IDs; IDs not supplied",
    argumentMode: "explicit-server-tools", universalFinalBlock: false }),
  grok: Object.freeze({ acceptance: "pending", connection: "remote MCP URL only",
    localAdapter: false, argumentMode: "server-request", universalFinalBlock: false }),
});
