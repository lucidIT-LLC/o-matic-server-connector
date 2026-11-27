import guard from "./index.mjs";
import { registerConnectionStatus } from "./status-tool.mjs";
import { registerAuthenticatedReceiptRpc } from "./authenticated-request-adapter.mjs";
export { executeServerCall, executeOrchestration, serverCall } from "./shared-host-adapter.mjs";

// General native mixed hook/tool entry: public register/on/registerTool APIs.
// No private host import, MCP client, connector, token or agent-dispatch layer.
export default {
  id: "omatic-governance",
  name: "o-MATIC Server Connection",
  description: "Existing-connection argument guards, finite explicit diagnostics and honest blocked workflow capabilities.",
  register(api) {
    guard.register(api);
    registerConnectionStatus(api);
    registerAuthenticatedReceiptRpc(api);
  },
};
