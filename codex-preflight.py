#!/usr/bin/env python3
"""Stateless argument/read guard. Server alone verifies authority and proof."""
import json
from pathlib import Path
import re
import sys


def clean_read(sql):
    # Match the existing narrow OpenClaw cleanRead policy. This classifier is
    # NOT proof that arbitrary SELECT functions are effect-free.
    return (isinstance(sql, str)
            and re.search(r"^\s*SELECT\b", sql, re.IGNORECASE) is not None
            and re.search(r";\s*\S|\b(INTO|FOR\s+(UPDATE|SHARE))\b", sql, re.IGNORECASE) is None)


def main():
    try:
        names = json.loads(Path(__file__).with_name("tool-names.json").read_text())
        raw = sys.stdin.read(2_000_001)
        payload = json.loads(raw) if len(raw) < 2_000_001 else None
        if not isinstance(payload, dict):
            raise ValueError()
        method = names.get(payload.get("tool_name"))
        if method is None:
            return 0
        args = payload.get("tool_input")
        if not isinstance(args, dict):
            raise ValueError()
        key = args.get("conversation_key")
        if not isinstance(key, str) or key.strip() != key or not re.fullmatch(r"[^\x00-\x1f\x7f]{1,200}", key):
            print("o-MATIC: supply this conversation's stable conversation_key", file=sys.stderr)
            return 2
        if method in ("search", "factory_query"):
            proof = args.get("startup_proof")
            if not isinstance(proof, str) or not re.fullmatch(r"v1\.\d{1,12}\.[0-9a-f]{32}\.[0-9a-f]{64}", proof):
                print("o-MATIC: pass this factory's current startup proof", file=sys.stderr)
                return 2
        if method == "factory_query" and not clean_read(args.get("sql")):
            print("o-MATIC: generic SQL mutations require an authenticated exact-SQL human approval bridge; unavailable", file=sys.stderr)
            return 2
        # No allow result, rewritten input, proof persistence, or finalizer.
        return 0
    except (ValueError, TypeError, OSError, UnicodeError):
        print("o-MATIC: invalid hook input or unavailable binding", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
