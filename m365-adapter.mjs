// Offline package preparation only. Never registers agents, signs in, edits a
// tenant, acquires worker agents, or treats a title ID as verified execution.
export function prepareM365Adapter(pluginManifest, declarativeManifest, { discovery = "preserve", acceptanceScope = "workflow" } = {}) {
  if (!["connection", "workflow"].includes(acceptanceScope)) throw new Error("Explicit supported acceptance scope required");
  if (!pluginManifest || !declarativeManifest) return {
    status: "blocked", reason: "existing_m365_manifests_required", acceptance: "pending",
  };
  const plugin = structuredClone(pluginManifest);
  const agent = structuredClone(declarativeManifest);
  const runtimes = plugin.runtimes;
  if (!Array.isArray(runtimes) || runtimes.length !== 1 || runtimes[0].type !== "RemoteMCPServer") {
    throw new Error("This bounded adapter requires exactly one existing RemoteMCPServer runtime");
  }
  const runtime = runtimes[0];
  if (runtime.auth && (runtime.auth.type !== "OAuthPluginVault"
      || typeof runtime.auth.reference_id !== "string"
      || Object.keys(runtime.auth).some((key) => !["type", "reference_id"].includes(key)))) {
    throw new Error("Reuse an existing OAuth vault reference; literal credentials or a new auth setup are not accepted");
  }
  if (runtime.headers || runtime.spec?.headers || runtime.env) {
    throw new Error("Inline credential/header/environment transport overrides are not accepted");
  }
  if (typeof runtime.spec?.url !== "string") throw new Error("Existing MCP endpoint required");
  const endpoint = new URL(runtime.spec.url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Use an existing HTTPS MCP endpoint without inline credentials");
  }
  if (!["preserve", "dynamic"].includes(discovery)) throw new Error("Unsupported discovery mode");
  if (discovery === "dynamic") {
    plugin.functions = [];
    runtime.run_for_functions = ["*"];
    // Do not ship stale pinned definitions alongside dynamic discovery.
    delete runtime.spec.mcp_tool_description;
  }
  return {
    status: "prepared_not_validated", acceptance: "pending", pluginManifest: plugin,
    declarativeManifest: agent, discovery, acceptanceScope,
    requiredChecks: ["tenant_and_schema_support", "installable_m365_app_package_validated",
      "existing_Entra_connection_authorized", "same_session_tools_list_and_startup",
      ...(acceptanceScope === "workflow" || agent.worker_agents?.length
        ? ["each_existing_worker_title_id_acquired", "actual_existing_worker_task_and_response"] : []),
      ...(acceptanceScope === "workflow" ? ["authenticated_workflow_receipt_backend"] : [])],
    disabledFeatures: acceptanceScope === "connection" ? ["workflow_receipt_enforcement"] : [],
    guarantees: { credentialsChanged: false, workersRegistered: false,
      executionOrderEnforced: false, plainChatFinalBlocked: false },
  };
}
