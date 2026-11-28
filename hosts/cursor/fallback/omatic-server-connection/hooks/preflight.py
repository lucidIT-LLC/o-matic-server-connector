#!/usr/bin/env python3
"""Thin local validation only. It neither grants access nor caches proofs."""
import json
import os
import re
import sys

GOVERNED = {
    "startup", "search", "factory_query", "factory_owner_ddl", "work_claim_acquire",
    "work_claim_release", "kernel_session_open", "kernel_session_get",
    "kernel_plan_update", "kernel_delegate", "kernel_return", "kernel_session_close",
}
SECRET_FORMAT = re.compile(r"v1\.\d{1,12}\.[0-9a-f]{32}\.[0-9a-f]{64}\Z")
KEY_FORMAT = re.compile(r"[^\x00-\x1f\x7f]{1,200}\Z")


def evaluate(host, item, server):
    name = item.get("tool_name", "")
    args = item.get("tool_input")
    if host == "cursor":
        if item.get("mcp_server_name") != server:
            return None
        if not isinstance(name, str):
            return "o-MATIC: invalid tool name"
        name = name.removeprefix("MCP:")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except (ValueError, TypeError):
                return "o-MATIC: invalid MCP arguments"
    else:
        prefix = f"mcp__{server}__"
        if not isinstance(name, str) or not name.startswith(prefix):
            return None
        name = name.removeprefix(prefix)
    if name not in GOVERNED:
        return None
    if not isinstance(args, dict):
        return "o-MATIC: invalid MCP arguments"
    key = args.get("conversation_key")
    if not isinstance(key, str) or key.strip() != key or not KEY_FORMAT.fullmatch(key):
        return "o-MATIC: supply this conversation's stable conversation_key"
    if name != "startup":
        proof = args.get("startup_proof")
        if not isinstance(proof, str) or not SECRET_FORMAT.fullmatch(proof):
            return "o-MATIC: pass this factory's current READY startup proof"
    return None


def main():
    host, = sys.argv[1:]
    server = os.environ.get("OMATIC_MCP_SERVER_NAME", "omatic-server")
    try:
        raw = sys.stdin.read(2_000_001)
        payload = json.loads(raw) if len(raw) < 2_000_001 else None
        if not isinstance(payload, dict):
            raise ValueError
    except (ValueError, UnicodeError):
        print("o-MATIC: invalid hook input", file=sys.stderr)
        return 2
    reason = evaluate(host, payload, server)
    if not reason:
        # No allow decision or rewritten payload: preserve each host's normal
        # execution rules, approval flow and competing hooks.
        return 0
    if host == "cursor":
        print(json.dumps({"permission": "deny", "user_message": reason, "agent_message": reason}))
        return 0
    print(reason, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
