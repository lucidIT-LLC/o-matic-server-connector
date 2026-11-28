#!/usr/bin/env python3
"""Build Claude and Cursor core-crew packages from public gold + role skills.

The gold record and SKILL.md files in source/core-crew/ are inputs.
Generated host trees and root marketplace manifests are outputs.

    python3 -B scripts/build_core_crew.py
    python3 -B scripts/build_core_crew.py --marketplace fallback
    python3 -B scripts/build_core_crew.py --check
    python3 -B scripts/build_core_crew.py --extract-gold /path/to/roster_gold.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "source" / "core-crew"
VERSION = "1.1.0"
DEFAULT_MCP_URL = "https://factory.o-matic.ai/mcp"
CLAUDE_MCP_NAME = "o-matic-server"
CURSOR_MCP_NAME = "omatic-server"  # matches hosts/cursor/hooks/preflight.py default
PLUGIN_CONNECTION = "omatic-server-connection"
PLUGIN_CREW = "omatic-core-crew"
OWNER_NAME = "LucidIT, LLC"
OWNER_EMAIL = "info@lucidit.io"
HOMEPAGE = "https://o-matic.ai"
REPOSITORY = "https://github.com/lucidIT-LLC/o-matic-server-connector"
LICENSE = "BUSL-1.1"
CORE_AGENTS = ("probot", "fred", "data")
SKILLS = {
    "probot": "probot-orchestrator",
    "fred": "fred-storage",
    "data": "data-analyst",
}
REPLY_PREFIX = {"probot": "Probot:", "fred": "Fred:", "data": "Data:"}

# Public-safe keys allowed in gold.public.json agent records.
GOLD_AGENT_KEYS = frozenset({
    "agent_name", "callsign", "lifecycle_state", "factory_type", "primary_domain",
    "tone_descriptor", "voice_anchor", "personality_tags", "trigger_phrases",
    "persona_status", "gold_persona_current_version", "published_version",
    "archetypes", "voice", "character_bible", "lane",
})
GOLD_VERSION_KEYS = frozenset({
    "id", "version", "review_status", "identity_signature", "role",
    "one_liner", "summary", "source_skill_version", "trigger_phrases",
})


def dump(data) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def copy_tree(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)


def load_gold() -> dict:
    path = SOURCE / "gold.public.json"
    gold = json.loads(path.read_text())
    if gold.get("schema") != "omatic-core-crew-gold-public-v1":
        raise SystemExit(f"unexpected gold schema in {path}")
    agents = gold.get("agents") or {}
    missing = [name for name in CORE_AGENTS if name not in agents]
    if missing:
        raise SystemExit(f"gold.public.json missing agents: {missing}")
    for name, rec in agents.items():
        unknown = set(rec) - GOLD_AGENT_KEYS
        if unknown:
            raise SystemExit(f"gold.public.json agent {name} has non-public keys: {sorted(unknown)}")
        ver = rec.get("published_version") or {}
        extra = set(ver) - GOLD_VERSION_KEYS
        if extra:
            raise SystemExit(f"gold.public.json {name}.published_version has extra keys: {sorted(extra)}")
    return gold


def extract_gold(roster_path: Path) -> dict:
    raw = roster_path.read_text()
    start, end = raw.find("{"), raw.rfind("}")
    gold = json.loads(raw[start:end + 1], strict=False)
    core = set(CORE_AGENTS)
    identity = {r["agent_name"]: r for r in gold["agent_identity"] if r["agent_name"] in core}
    persona = {r["agent_name"]: r for r in gold["persona"] if r["agent_name"] in core}
    latest: dict[str, dict] = {}
    for ver in gold["persona_version"]:
        if ver["agent_name"] not in core:
            continue
        cur = latest.get(ver["agent_name"])
        if cur is None or ver["version"] > cur["version"]:
            latest[ver["agent_name"]] = ver

    def related(table: str, version_id: int) -> list[dict]:
        return [row for row in gold[table] if row.get("version_id") == version_id]

    def strip_row(row: dict) -> dict:
        skip = {"id", "version_id", "created_at", "updated_at", "tenant_id"}
        return {k: v for k, v in row.items() if k not in skip}

    agents = {}
    for name in CORE_AGENTS:
        ident, pers, ver = identity[name], persona[name], latest[name]
        vid = ver["id"]
        voice_rows = related("persona_voice_contract", vid)
        bible_rows = related("persona_character_bible", vid)
        lane_rows = related("persona_lane_contract", vid)
        arch = related("persona_archetype", vid)
        agents[name] = {
            "agent_name": name,
            "callsign": ident.get("callsign"),
            "lifecycle_state": ident.get("lifecycle_state"),
            "factory_type": ident.get("factory_type"),
            "primary_domain": ident.get("primary_domain"),
            "tone_descriptor": ident.get("tone_descriptor"),
            "voice_anchor": ident.get("voice_anchor"),
            "personality_tags": ident.get("personality_tags") or [],
            "trigger_phrases": ident.get("trigger_phrases") or [],
            "persona_status": pers.get("status"),
            "gold_persona_current_version": pers.get("current_version"),
            "published_version": {
                "id": ver["id"],
                "version": ver["version"],
                "review_status": ver["review_status"],
                "identity_signature": ver.get("identity_signature"),
                "role": ver.get("role"),
                "one_liner": ver.get("one_liner"),
                "summary": ver.get("summary"),
                "source_skill_version": ver.get("source_skill_version"),
                "trigger_phrases": ver.get("trigger_phrases") or [],
            },
            "archetypes": [
                {
                    "layer": item.get("layer"),
                    "name": item.get("archetype_name") or item.get("name"),
                    "description": item.get("description"),
                    "sort_order": item.get("sort_order"),
                }
                for item in sorted(
                    arch,
                    key=lambda item: (
                        item.get("sort_order") is None,
                        item.get("sort_order") or 0,
                        item.get("layer") or "",
                    ),
                )
            ],
            "voice": strip_row(voice_rows[0]) if voice_rows else {},
            "character_bible": strip_row(bible_rows[0]) if bible_rows else {},
            "lane": strip_row(lane_rows[0]) if lane_rows else {},
        }
    return {
        "schema": "omatic-core-crew-gold-public-v1",
        "extracted_from": {
            "repository": "lucidIT-LLC/o-matic-server",
            "path": "tools/roster_gold.json",
            "exported_at": gold.get("exported_at"),
            "note": (
                "Public-safe extract only. Catalog embeddings, tool inventories, "
                "evaluation criteria, provenance, assets, and runtime-contract "
                "deployment evidence were omitted."
            ),
        },
        "agents": agents,
    }


def yaml_escape(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def agent_markdown(name: str, rec: dict) -> str:
    skill = SKILLS[name]
    display = name.capitalize() if name != "probot" else "Probot"
    role = (rec.get("published_version") or {}).get("role") or rec.get("primary_domain") or display
    one = (rec.get("published_version") or {}).get("one_liner") or ""
    summary = (rec.get("published_version") or {}).get("summary") or rec.get("tone_descriptor") or ""
    description = f"{display}, o-MATIC {role}."
    if one:
        description = f"{description} {one}"
    triggers = rec.get("trigger_phrases") or rec.get("published_version", {}).get("trigger_phrases") or []
    layers = rec.get("archetypes") or []
    layer_lines = "\n".join(
        f"- {item['name']}: {item['description']}" for item in layers if item.get("name")
    )
    trigger = ", ".join(triggers) if triggers else display
    prefix = REPLY_PREFIX[name]
    return "\n".join([
        "---",
        f"name: {name}",
        f"description: {yaml_escape(description)}",
        "skills:",
        f"  - {skill}",
        "---",
        "",
        "<!-- GENERATED by scripts/build_core_crew.py from source/core-crew. Do not hand-edit. -->",
        "",
        f"You are {display}, {role} from o-MATIC.",
        f"The `{skill}` skill is preloaded: it is your full role guide, so follow it from your first token.",
        f'Begin every reply with "{prefix}". Write in US English.',
        "",
        summary,
        "",
        "Who you are, layer by layer:" if layer_lines else "",
        layer_lines,
        "",
        f"People call on you with: {trigger}.",
        "",
        "If this host has an o-MATIC Server connection configured, use it for factory memory, rules, and records.",
        "If it does not, say so plainly and work from the conversation.",
        "Never search for, guess, or ask for a server address.",
        "Never request, enter, store, or relay raw passwords or tokens.",
        "",
        rec.get("voice_anchor") or "",
        "",
    ]).replace("\n\n\n", "\n\n")


def claude_plugin_manifest(name: str, description: str, *, with_mcp: bool, with_skills: bool, dependency: str | None) -> dict:
    manifest = {
        "name": name,
        "displayName": "o-MATIC Server Connection" if name == PLUGIN_CONNECTION and with_mcp and with_skills
        else ("o-MATIC Server Connection" if name == PLUGIN_CONNECTION else "o-MATIC Core Crew"),
        "version": VERSION,
        "description": description,
        "author": {"name": OWNER_NAME, "url": HOMEPAGE},
        "homepage": HOMEPAGE,
        "repository": REPOSITORY,
        "license": LICENSE,
        "keywords": ["o-matic", "mcp", "factory", "probot", "fred", "data"],
    }
    if with_skills:
        manifest["skills"] = "./skills/"
        manifest["agents"] = [f"./agents/{name}.md" for name in CORE_AGENTS]
    if with_mcp:
        manifest["privacyPolicyUrl"] = "https://www.o-matic.ai/privacy-policy/"
        manifest["userConfig"] = {
            "server_url": {
                "type": "string",
                "title": "o-MATIC Server URL",
                "description": (
                    "Cloud default: https://factory.o-matic.ai/mcp. "
                    "For on-premises, enter the HTTPS MCP URL for that Server."
                ),
                "default": DEFAULT_MCP_URL,
            }
        }
        manifest["mcpServers"] = {
            CLAUDE_MCP_NAME: {"type": "http", "url": "${user_config.server_url}"}
        }
    if dependency:
        manifest["dependencies"] = [dependency]
    return manifest


def cursor_plugin_manifest(name: str, description: str, *, with_mcp: bool, with_skills: bool, with_hooks: bool) -> dict:
    manifest = {
        "name": name,
        "displayName": "o-MATIC Server Connection" if with_mcp and with_skills
        else ("o-MATIC Server Connection" if with_mcp else "o-MATIC Core Crew"),
        "version": VERSION,
        "description": description,
        "author": {"name": OWNER_NAME, "email": OWNER_EMAIL},
        "homepage": HOMEPAGE,
        "repository": REPOSITORY,
        "license": LICENSE,
        "keywords": ["o-matic", "mcp", "factory", "probot", "fred", "data"],
    }
    if with_skills:
        manifest["skills"] = "./skills/"
        manifest["agents"] = "./agents/"
    if with_hooks:
        manifest["hooks"] = "./hooks/hooks.json"
    if with_mcp:
        manifest["mcpServers"] = "./mcp.json"
        manifest["variables"] = {
            "type": "object",
            "properties": {
                "SERVER_URL": {
                    "type": "string",
                    "title": "o-MATIC Server URL",
                    "description": (
                        "Cloud default: https://factory.o-matic.ai/mcp. "
                        "For on-premises, enter the HTTPS MCP URL for that Server."
                    ),
                    "default": DEFAULT_MCP_URL,
                }
            },
        }
    return manifest


def cursor_hooks() -> dict:
    return {
        "version": 1,
        "hooks": {
            "beforeMCPExecution": [
                {
                    "command": "python3 hooks/preflight.py cursor",
                    "failClosed": True,
                }
            ]
        },
    }


def cursor_mcp() -> dict:
    return {
        "mcpServers": {
            CURSOR_MCP_NAME: {
                "url": "${SERVER_URL}",
            }
        }
    }


def write_skills_and_agents(plugin_root: Path, gold: dict) -> None:
    for name in CORE_AGENTS:
        skill_dir = SKILLS[name]
        src = SOURCE / "skills" / skill_dir
        if not (src / "SKILL.md").is_file():
            raise SystemExit(f"missing skill source {src / 'SKILL.md'}")
        copy_tree(src, plugin_root / "skills" / skill_dir)
        write(plugin_root / "agents" / f"{name}.md", agent_markdown(name, gold["agents"][name]))


def write_cursor_hooks(plugin_root: Path) -> None:
    write(plugin_root / "hooks" / "hooks.json", dump(cursor_hooks()))
    src = REPO / "hosts" / "cursor" / "hooks" / "preflight.py"
    dest = plugin_root / "hooks" / "preflight.py"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)


def bundled_connection_description() -> str:
    return (
        "o-MATIC Server Connection plus the core crew. One install configures the "
        "existing o-MATIC Server MCP connection (cloud default, or an operator-entered "
        "on-prem URL) and loads Probot, Fred, and Data. It does not create a Server, "
        "dispatch agents, or change authentication."
    )


def connection_only_description() -> str:
    return (
        "o-MATIC Server Connection: reuses the host's OAuth/SSO to reach an existing "
        "o-MATIC Server over MCP (cloud default, or an operator-entered on-prem URL). "
        "It does not create a Server, dispatch agents, or change authentication."
    )


def crew_only_description() -> str:
    return (
        "o-MATIC core crew: Probot, Fred, and Data, generated from the gold record. "
        "Depends on the o-MATIC Server Connection plugin for the Server MCP connection. "
        "Ships no MCP server of its own."
    )


def write_claude_bundled(root: Path, gold: dict) -> Path:
    plugin = root / "hosts" / "claude" / "bundled" / PLUGIN_CONNECTION
    if plugin.exists():
        shutil.rmtree(plugin)
    write(
        plugin / ".claude-plugin" / "plugin.json",
        dump(claude_plugin_manifest(
            PLUGIN_CONNECTION, bundled_connection_description(),
            with_mcp=True, with_skills=True, dependency=None,
        )),
    )
    write_skills_and_agents(plugin, gold)
    return plugin


def write_claude_fallback(root: Path, gold: dict) -> tuple[Path, Path]:
    base = root / "hosts" / "claude" / "fallback"
    if base.exists():
        shutil.rmtree(base)
    connection = base / PLUGIN_CONNECTION
    crew = base / PLUGIN_CREW
    write(
        connection / ".claude-plugin" / "plugin.json",
        dump(claude_plugin_manifest(
            PLUGIN_CONNECTION, connection_only_description(),
            with_mcp=True, with_skills=False, dependency=None,
        )),
    )
    write(
        crew / ".claude-plugin" / "plugin.json",
        dump(claude_plugin_manifest(
            PLUGIN_CREW, crew_only_description(),
            with_mcp=False, with_skills=True, dependency=PLUGIN_CONNECTION,
        )),
    )
    write_skills_and_agents(crew, gold)
    return connection, crew


def write_cursor_bundled(root: Path, gold: dict) -> Path:
    plugin = root / "hosts" / "cursor" / "bundled"
    if plugin.exists():
        shutil.rmtree(plugin)
    write(
        plugin / ".cursor-plugin" / "plugin.json",
        dump(cursor_plugin_manifest(
            PLUGIN_CONNECTION, bundled_connection_description(),
            with_mcp=True, with_skills=True, with_hooks=True,
        )),
    )
    write(plugin / "mcp.json", dump(cursor_mcp()))
    write_cursor_hooks(plugin)
    write_skills_and_agents(plugin, gold)
    return plugin


def write_cursor_fallback(root: Path, gold: dict) -> tuple[Path, Path]:
    base = root / "hosts" / "cursor" / "fallback"
    if base.exists():
        shutil.rmtree(base)
    connection = base / PLUGIN_CONNECTION
    crew = base / PLUGIN_CREW
    write(
        connection / ".cursor-plugin" / "plugin.json",
        dump(cursor_plugin_manifest(
            PLUGIN_CONNECTION, connection_only_description(),
            with_mcp=True, with_skills=False, with_hooks=True,
        )),
    )
    write(connection / "mcp.json", dump(cursor_mcp()))
    write_cursor_hooks(connection)
    write(
        crew / ".cursor-plugin" / "plugin.json",
        dump(cursor_plugin_manifest(
            PLUGIN_CREW, crew_only_description(),
            with_mcp=False, with_skills=True, with_hooks=False,
        )),
    )
    write_skills_and_agents(crew, gold)
    return connection, crew


def claude_marketplace(marketplace: str) -> dict:
    if marketplace == "fallback":
        plugins = [
            {
                "name": PLUGIN_CONNECTION,
                "displayName": "o-MATIC Server Connection",
                "source": f"./hosts/claude/fallback/{PLUGIN_CONNECTION}",
                "version": VERSION,
                "description": connection_only_description(),
                "author": {"name": OWNER_NAME, "url": HOMEPAGE},
                "homepage": HOMEPAGE,
                "license": LICENSE,
                "category": "Productivity",
                "keywords": ["o-matic", "mcp", "factory"],
            },
            {
                "name": PLUGIN_CREW,
                "displayName": "o-MATIC Core Crew",
                "source": f"./hosts/claude/fallback/{PLUGIN_CREW}",
                "version": VERSION,
                "description": crew_only_description(),
                "author": {"name": OWNER_NAME, "url": HOMEPAGE},
                "homepage": HOMEPAGE,
                "license": LICENSE,
                "category": "Productivity",
                "keywords": ["o-matic", "probot", "fred", "data"],
            },
        ]
    else:
        plugins = [
            {
                "name": PLUGIN_CONNECTION,
                "displayName": "o-MATIC Server Connection",
                "source": f"./hosts/claude/bundled/{PLUGIN_CONNECTION}",
                "version": VERSION,
                "description": bundled_connection_description(),
                "author": {"name": OWNER_NAME, "url": HOMEPAGE},
                "homepage": HOMEPAGE,
                "license": LICENSE,
                "category": "Productivity",
                "keywords": ["o-matic", "mcp", "factory", "probot", "fred", "data"],
            }
        ]
    return {
        "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
        "name": "o-matic-server-connector",
        "owner": {"name": OWNER_NAME, "email": OWNER_EMAIL},
        "metadata": {
            "description": bundled_connection_description(),
            "version": VERSION,
        },
        "plugins": plugins,
    }


def cursor_marketplace(marketplace: str) -> dict:
    if marketplace == "fallback":
        plugins = [
            {
                "name": PLUGIN_CONNECTION,
                "source": f"./hosts/cursor/fallback/{PLUGIN_CONNECTION}",
                "description": connection_only_description(),
                "version": VERSION,
                "displayName": "o-MATIC Server Connection",
                "category": "productivity",
            },
            {
                "name": PLUGIN_CREW,
                "source": f"./hosts/cursor/fallback/{PLUGIN_CREW}",
                "description": crew_only_description(),
                "version": VERSION,
                "displayName": "o-MATIC Core Crew",
                "category": "productivity",
            },
        ]
    else:
        plugins = [
            {
                "name": PLUGIN_CONNECTION,
                "source": "./hosts/cursor/bundled",
                "description": bundled_connection_description(),
                "version": VERSION,
                "displayName": "o-MATIC Server Connection",
                "category": "productivity",
            }
        ]
    return {
        "name": "o-matic-server-connector",
        "owner": {"name": OWNER_NAME},
        "metadata": {
            "description": bundled_connection_description(),
            "version": VERSION,
        },
        "plugins": plugins,
    }


def collect_files(root: Path, rels: list[str]) -> dict[str, str]:
    files = {}
    for rel in rels:
        path = root / rel
        if path.is_file():
            files[rel] = sha256_bytes(path.read_bytes())
            continue
        if not path.is_dir():
            raise SystemExit(f"expected generated path missing: {rel}")
        for child in sorted(path.rglob("*")):
            if child.is_file():
                files[str(child.relative_to(root))] = sha256_bytes(child.read_bytes())
    return files


GENERATED_TREES = [
    f"hosts/claude/bundled/{PLUGIN_CONNECTION}",
    f"hosts/claude/fallback/{PLUGIN_CONNECTION}",
    f"hosts/claude/fallback/{PLUGIN_CREW}",
    "hosts/cursor/bundled",
    f"hosts/cursor/fallback/{PLUGIN_CONNECTION}",
    f"hosts/cursor/fallback/{PLUGIN_CREW}",
    ".claude-plugin/marketplace.json",
    ".cursor-plugin/marketplace.json",
    "hosts/CORE-CREW-MANIFEST.json",
]


def write_manifest(root: Path, gold: dict, marketplace: str) -> dict:
    files = collect_files(root, [p for p in GENERATED_TREES if p != "hosts/CORE-CREW-MANIFEST.json"])
    skill_headers = {}
    for name, skill in SKILLS.items():
        text = (SOURCE / "skills" / skill / "SKILL.md").read_text()
        skill_headers[name] = {
            "skill": skill,
            "sha256": sha256_bytes((SOURCE / "skills" / skill / "SKILL.md").read_bytes()),
        }
        for line in text.splitlines():
            if "identity_signature" in line or "persona source" in line or line.startswith("<!-- version:"):
                skill_headers[name].setdefault("headers", []).append(line.strip())
    gold_sigs = {
        name: gold["agents"][name]["published_version"].get("identity_signature")
        for name in CORE_AGENTS
    }
    doc = {
        "product": "o-MATIC Server Connection",
        "version": VERSION,
        "status": "draft",
        "released": False,
        "marketplace": marketplace,
        "layouts": {
            "bundled": "One plugin per host: MCP connection plus Probot, Fred, and Data.",
            "fallback": (
                "Two plugins per host: the connection plugin declares MCP, and the "
                "crew plugin depends on it. Switch the published marketplace with "
                "--marketplace fallback if a hosted Claude host skips MCP-declaring plugins."
            ),
        },
        "hosts": ["claude", "cursor"],
        "agents": list(CORE_AGENTS),
        "skills": [SKILLS[name] for name in CORE_AGENTS],
        "gold": {
            "schema": gold.get("schema"),
            "extracted_from": gold.get("extracted_from"),
            "identity_signatures": gold_sigs,
        },
        "skill_headers": skill_headers,
        "mcp": {
            "defaultUrl": DEFAULT_MCP_URL,
            "claudeServerName": CLAUDE_MCP_NAME,
            "cursorServerName": CURSOR_MCP_NAME,
        },
        "files": files,
    }
    write(root / "hosts" / "CORE-CREW-MANIFEST.json", dump(doc))
    return doc


def build(root: Path, marketplace: str) -> dict:
    gold = load_gold()
    write_claude_bundled(root, gold)
    write_claude_fallback(root, gold)
    write_cursor_bundled(root, gold)
    write_cursor_fallback(root, gold)
    write(root / ".claude-plugin" / "marketplace.json", dump(claude_marketplace(marketplace)))
    write(root / ".cursor-plugin" / "marketplace.json", dump(cursor_marketplace(marketplace)))
    return write_manifest(root, gold, marketplace)


def assert_no_release_key(root: Path) -> None:
    for path in list((root / ".claude-plugin").rglob("*.json")) + list((root / ".cursor-plugin").rglob("*.json")) + list((root / "hosts" / "claude").rglob("*.json")) + list((root / "hosts" / "cursor" / "bundled").rglob("*.json")) + list((root / "hosts" / "cursor" / "fallback").rglob("*.json")):
        data = json.loads(path.read_text())

        def walk(node, trail: str) -> None:
            if isinstance(node, dict):
                if "release" in node:
                    raise SystemExit(f"forbidden 'release' key in {path} at {trail}")
                for key, value in node.items():
                    walk(value, f"{trail}.{key}")
            elif isinstance(node, list):
                for i, value in enumerate(node):
                    walk(value, f"{trail}[{i}]")

        walk(data, "$")


def check(root: Path, marketplace: str) -> None:
    first = Path(tempfile.mkdtemp(prefix="core-crew-a-"))
    second = Path(tempfile.mkdtemp(prefix="core-crew-b-"))
    # Copy sources and hook inputs into a fake repo root for isolated generation.
    for temp in (first, second):
        (temp / "scripts").mkdir()
        copy_tree(SOURCE, temp / "source" / "core-crew")
        hook = REPO / "hosts" / "cursor" / "hooks" / "preflight.py"
        dest = temp / "hosts" / "cursor" / "hooks" / "preflight.py"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(hook, dest)
        build(temp, marketplace)
    files_a = collect_files(first, GENERATED_TREES)
    files_b = collect_files(second, GENERATED_TREES)
    if files_a != files_b:
        raise SystemExit("builder is not deterministic: two isolated runs differed")
    committed = collect_files(root, GENERATED_TREES)
    if committed != files_a:
        only_repo = sorted(set(committed) - set(files_a))
        only_gen = sorted(set(files_a) - set(committed))
        changed = sorted(k for k in committed.keys() & files_a.keys() if committed[k] != files_a[k])
        raise SystemExit(
            "generated outputs are stale or dirty. Re-run the builder.\n"
            f"  only in repo: {only_repo}\n"
            f"  only in regen: {only_gen}\n"
            f"  checksum diffs: {changed}"
        )
    assert_no_release_key(root)
    print(f"check ok: {len(committed)} generated files, deterministic, no release key, marketplace={marketplace}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--marketplace", choices=("bundled", "fallback"), default="bundled",
                        help="Which layout the root Claude and Cursor marketplace manifests publish.")
    parser.add_argument("--check", action="store_true",
                        help="Regenerate twice in isolation and require a match with committed outputs.")
    parser.add_argument("--extract-gold", metavar="ROSTER_GOLD_JSON",
                        help="Write source/core-crew/gold.public.json from a roster_gold.json file.")
    args = parser.parse_args(argv)
    if args.extract_gold:
        doc = extract_gold(Path(args.extract_gold))
        write(SOURCE / "gold.public.json", dump(doc))
        print(f"wrote {SOURCE / 'gold.public.json'}")
        return 0
    if args.check:
        check(REPO, args.marketplace)
        return 0
    manifest = build(REPO, args.marketplace)
    assert_no_release_key(REPO)
    print(f"built core-crew {VERSION} marketplace={args.marketplace} files={len(manifest['files'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
