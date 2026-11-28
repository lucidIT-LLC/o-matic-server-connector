<p align="center">
  <img src=".github/brand/omatic-wordmark.png" width="240" alt="o-MATIC" />
</p>

<p align="center">
  Built by <a href="https://o-matic.ai">o-MATIC</a>, the AI research division of <a href="https://lucidit.io">LucidIT, LLC</a>.
</p>

# o-MATIC Server Connector

**Candidate multi-platform connector plugin** for [o-MATIC Server](https://github.com/lucidIT-LLC/o-matic-server): one plugin id, MCP connection helpers, host governance hooks where the host allows them, and **agent/skill projections from DB gold** into every required host agent-doc standard.

| Field | Value |
|---|---|
| Plugin id | `omatic-governance` |
| Candidate version | **`1.0.1-candidate.4`** |
| Doctrine | **AI is AI** — one gold in the factory DB; this plugin projects agents/skills everywhere (not host-unique forks) |
| Release status | **Candidate** — not a production-approved full-factory package |
| License | Business Source License 1.1 (`LICENSE.md`) |

This repository is the public source for the Server **connection** plugin. It does **not** replace o-MATIC Server, invent factory grants, ship credentials, or claim workflow completion while Server workflow bindings remain unbound.

**Core-crew 1.1.0 (draft, unreleased).** Claude and Cursor packages are generated from a public-safe gold extract plus the Probot, Fred, and Data skills (`scripts/build_core_crew.py`). The default marketplace layout is one plugin, `omatic-server-connection`, that includes the Server MCP connection and the core crew. A two-plugin fallback already lives under `hosts/*/fallback/`; switch the published marketplace with `--marketplace fallback` if a hosted Claude host skips the bundled plugin. OpenClaw remains at candidate `1.0.1-candidate.4` in this cut. See [docs/HOSTED-CLAUDE-INSTALL-TEST.md](docs/HOSTED-CLAUDE-INSTALL-TEST.md). Draft install from this branch: `/plugin marketplace add lucidIT-LLC/o-matic-server-connector#carver/core-crew-bundle-1.1.0`, then `/plugin install omatic-server-connection --marketplace lucidIT-LLC/o-matic-server-connector`.

## What it does

1. **One plugin, many hosts** — Cursor, Copilot, OpenClaw, Hermes (and Codex/Grok projections) share `omatic-governance`. Packaging shapes differ; product identity does not.
2. **MCP connection** — reuse an existing configured o-MATIC Server MCP connection (cloud default `https://factory.o-matic.ai/mcp`, or an on-prem HTTPS MCP URL). Authentication stays with the host’s OAuth/SSO flow and the Server’s own grants.
3. **Agents + skills from gold** — project roster agents and skills into each host’s documented agent-doc files (OpenClaw workspace docs, Hermes context files, Copilot Agent Skills / packages, Cursor agents+skills). No host-unique personality forks.
4. **Governance / orchestration hooks** — fail-closed preflight where the host supports it (`startup`, `search`, `factory_query`, kernel tools, claims, …). Generic SQL mutations stay refused until an exact-SQL operator-approval bridge exists on that host.
5. **Peer memory** — local peer-memory helpers on hosts that load the native plugin (OpenClaw). Memory here is client-side bookkeeping; Server memory and kernel state remain on the Server.

It does **not** create a Server, mint a second agent identity per host, copy credentials, rewrite tool arguments by default, or enable unbound `omatic.workflow-receipt/2` production bindings.

## Multi-host status

One product, host-specific packaging (see `docs/PRODUCT-CONTRACT.md`, `hosts/PLUGIN-IDENTITY.json`, `hosts/agents/DOC-STANDARDS.json`):

| Host | Artifact | Agent-doc standard | Status |
|---|---|---|---|
| **OpenClaw** | Root package (`openclaw.plugin.json`, `dist-runtime/index.js`, …) | `AGENTS.md` / `SOUL.md` / `IDENTITY.md` / `USER.md` | Native install/reload verified on Jimmy’s Mac at candidate.4 (doctor may warn on archive provenance) |
| **Hermes** | `hosts/hermes/` | `AGENTS.md` / `HERMES.md` / `SOUL.md` from gold | **OF-90 packaging declared**; live packs + Hermes smoke pending (`hosts/hermes/ACCEPTANCE.md`) |
| **Claude** | `.claude-plugin/marketplace.json` + `hosts/claude/` (1.1.0 draft) | plugin skills + agents from gold | Package generated; hosted install test not yet run ([docs/HOSTED-CLAUDE-INSTALL-TEST.md](docs/HOSTED-CLAUDE-INSTALL-TEST.md)) |
| **Cursor** | `hosts/cursor/` hooks plus `hosts/cursor/bundled/` 1.1.0 plugin (draft) | Cursor agents + `SKILL.md` + method cards | Mac hooks load + MCP `startup` READY measured; Desktop `beforeMCPExecution` on Project-agent MCP path not intercepted |
| **Microsoft 365 Copilot** | `hosts/copilot/` zip + SKILL/agent projection | Agent Skills / declarative packages from gold | **Same plugin**; **OF-90 packaging declared**; tenant upload + gold packs pending (`hosts/copilot/ACCEPTANCE.md`) |
| **Codex / ChatGPT** | `hosts/codex/` | plugin + agent projection | Candidate packaging; native hook trust / live refusal pending |
| **Grok** | `hosts/grok/MCP-SETUP.json` | MCP + Bot/paste from gold | MCP URL; `clientEnforcement: false` |

Required agent-doc hosts that must not be left empty: **OpenClaw, Hermes, Copilot, Cursor** (`hosts/agents/DOC-STANDARDS.json`).

Agency / Firm / Studio remain gold projection sources consumed with this connector — they are not a second connector product. Portable Supply MCP shelf packaging stays a sibling distribution path for tools, not a Copilot-only fork of this plugin.

## OpenClaw install (candidate)

Requires an existing OpenClaw Gateway and an existing Server MCP connection in config. From a packed archive built with `python3 -B build_release.py` (or an equivalent allowlisted tarball of this package):

```bash
openclaw plugins install npm-pack:<path-to-omatic-governance-1.0.1-candidate.4.tgz> --force
```

Then enable `plugins.entries.omatic-governance`, map tool-name aliases to live Server tools, enroll connection names, and reload. Exact connection names come from Server `startup` / `connections_list` — never guess a Server address.

Diagnostic tools registered by the native plugin (when the host admits them): `omatic_connection_status`, `omatic_workflow_status`. Workflow completion stays blocked while real backend receipt capabilities are unbound (`CAPABILITIES.json`).

## Cursor / Hermes / Copilot

- **Cursor:** wire `hosts/cursor/hooks/` into `~/.cursor/hooks.json`, keep MCP `o-matic-server`, and project agents/skills from gold (same plugin as Copilot).
- **Hermes:** project `AGENTS.md` / `HERMES.md` / `SOUL.md` from the same gold; connect MCP to the Server. No Hermes-only personality fork.
- **Copilot:** upload `hosts/copilot/omatic-server-0.1.7-mcp.zip` via M365 admin center **Agents → Tools → Registry → Upload** (existing OAuth reference). Emit agent/skill packages from gold — not a separate Copilot connector product.
- **Grok:** configure the remote MCP URL from `hosts/grok/MCP-SETUP.json`. Agents still come from gold projections.

## Develop / test

```bash
node --test index.test.mjs peer-memory.test.mjs
# Optional broader suite (some tests need local build/tooling present):
npm test
```

Rebuild the OpenClaw runtime bundle (Bun required):

```bash
npm run build
```

Release packing (writes content-addressed local archives; does not install, publish, or touch a database):

```bash
python3 -B build_release.py --help
```

## Honest limits

- Candidate version **`1.0.1-candidate.4`** — reviewable build, not Spirit Gate / production clearance.
- Declaring host agent-doc coverage is not the same as a filled live pack on every host.
- Strict workflow/orchestration admission (`omatic.workflow-receipt/2`, host provenance, Rocky/PG acceptance) remains separate and unbound.
- Fixtures and local tests are not live Gateway, tenant, Hermes, or Codex acceptance.
- No secrets belong in this repository. Report security issues per `SECURITY.md`.

## Related doors

- **o-MATIC Agency** — staff who run the factory (gold projections)  
- **o-MATIC Firm** — expertise you retain  
- **o-MATIC Studio** — people who design and build  
- **o-MATIC Supply** — tools shelf (WordPress/Elementor, M365 tooling packages)  
- **This repo** — one Server connector plugin for multi-host landing, agents/skills included from gold
