import { readFile } from "node:fs/promises";

// Offline source preparation only. Caller supplies observed canonical hook tool
// names, not a guessed connector alias. No MCP definition or credentials copied.
export async function prepareCodexAdapter({ toolNames, version } = {}) {
  const methods = ["startup", "search", "factory_query"];
  if (!toolNames || typeof toolNames !== "object" || Array.isArray(toolNames)
      || methods.some(method => !Object.values(toolNames).includes(method))
      || Object.entries(toolNames).some(([name, method]) =>
        !/^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(name) || !methods.includes(method))) {
    return { status: "blocked", reason: "observed_canonical_hook_tool_names_required" };
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) {
    return { status: "blocked", reason: "source_version_required" };
  }
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hooks = { hooks: { PreToolUse: [{
    matcher: `^(?:${Object.keys(toolNames).sort().map(escapeRegex).join("|")})$`,
    hooks: [{ type: "command", command: 'python3 "${PLUGIN_ROOT}/hooks/preflight.py"' }],
  }] } };
  const manifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "omatic-governance", version,
    description: "Existing o-MATIC connection argument/read guards; generic SQL mutations refused; no workflow enforcement.",
    extensions: { "com.openai": { hooks: "./hooks/hooks.json" } },
  };
  const json = value => JSON.stringify(value, null, 2) + "\n";
  return {
    status: "prepared_not_validated", acceptance: "pending",
    files: {
      "plugin.json": json(manifest), "hooks/hooks.json": json(hooks),
      ".codex-plugin/plugin.json": json({ name: manifest.name, version, hooks: "./hooks/hooks.json" }),
      "hooks/tool-names.json": json(toolNames),
      "hooks/preflight.py": await readFile(new URL("./codex-preflight.py", import.meta.url), "utf8"),
    },
    requiredChecks: ["canonical_hook_names_confirmed_on_target", "python3_available_on_target",
      "plugin_schema_validated", "native_hooks_installed_count_observed", "user_reviewed_current_hook_trust",
      "existing_connection_authenticated_startup_and_guarded_read", "live_hook_refusal_and_unchanged_arguments"],
    coverage: "Declared startup/search/factory_query argument shape and existing narrow SELECT classifier only. Generic SQL mutations refused: no exact-SQL approval bridge exists. SELECT-function purity is not proven. Server validates proof authenticity, expiry and scope. No proof cache or identity inference. Other tool aliases, including owner DDL, are uncovered and remain subject to actual host/Server policy.",
    disabledFeatures: ["workflow_receipt_enforcement", "global_chat_finalization"],
    connection: "reuse_host_managed_unchanged",
    changes: { authentication: false, configuration: false, installation: false, agentDispatch: false },
  };
}
