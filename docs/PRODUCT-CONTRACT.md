# o-MATIC Factory package — candidate contract

Operator direction, November 26, 2026: launch o-MATIC Server with platform
plugins and downloadable, installable agents as one full factory package.
Bundle MCP setup where the host supports it. Preserve existing full agents and
their conversations rather than silently substituting child sessions.

## Installation experience

Install the platform package → reuse or register the Server connection →
complete host-managed sign-in if needed → select an authorized factory →
install or match the selected agent definitions → verify startup, agreement,
role-specific tool access, peer execution and return → show measured status.

An existing connection is reused without copying credentials or changing its
authentication. A missing connection gets a reviewable endpoint/OAuth proposal.
Installation does not run a new Server instance. The Server remains the
separate control plane. Installation does not grant factory/database access.

## Release units

- One versioned release manifest, checksums, source provenance and rollback.
- Host-specific connection packaging, not one falsely universal plugin format.
- Native governance adapter where available, with exact coverage declared.
- Individually selectable agent profiles generated from their actual designed
  roles, plus host-specific installation adapters. Profiles are not permissions.
- Shared startup/context-isolation/memory contract and role-scoped resources.
- Explicit model policy: preserve approved host settings; do not switch models
  or providers as a side effect of installing agent files. Research-based model
  recommendations and finalized skill/tool allowlists remain a separate gate.
- Per-platform install, update, uninstall, refusal and rollback acceptance.

The local profile catalog is a source/projection candidate, not proof that an
agent has been installed or can execute on another platform. In particular,
Claude Code child-agent files must not be presented as equivalent to existing
full peer agents. A peer runtime adapter and a measured return are required.

## Netbot / MoM

Jimmy clarified that Netbot has only existed in OpenClaw and is under
development with MoM. Preserve the existing agent. His package source is his
OpenClaw definition, not an invented Foundry persona row. The Netbot profile
records this separate development provenance and remains opt-in.

## Current evidence, not a percentage

The source baseline is draft PR #82 at
`87fee54f2f107b66c4f76e1936d0815d1108bb4f`. No merge or activation is implied.
The local revision has 22 passing hook/setup fixture tests, one passing test
through the installed OpenClaw hook runner, and three package-assembly tests. These are not a
Gateway run, an authenticated approved write, or cross-platform certification.

The retrieved Foundry source includes 14 non-retired current personas,
including Smith. Some current persona rows are `approved`, others `published`;
retain the actual review state rather than calling every row published.

## Release blockers

1. Trusted exact-SQL human-approval bridge and positive approved-write test.
   Role attestation and a work claim are not approval. The local candidate
   refuses generic SQL mutations until that bridge is implemented.
2. Real Gateway hook invocation, observed exact tool aliases, parameter-rewrite
   support and authenticated return using the configured connection.
3. Server turn/preflight coverage, durable retrieval/answer evidence, agreement
   loading, complete mutating-tool coverage and ledger privilege rehearsal.
4. Approved per-role tool/skill/model profiles; preserve live grants meanwhile.
5. Native full-peer installation/coordination and update/rollback tests on each
   target platform. No platform becomes supported because its manifest parses.
   The server draft's strict-hand return path still requires reconciliation
   with distinct-conversation peer returns; the adapter's synthetic peer test
   does not establish that the server accepts those returns.
6. Release signing, packaging gates and exact-change deployment approval.

The finalize hook requests a bounded revision. The host may skip it after a
retry budget, on timeout, or on an unsupported harness. Do not call it a universal
hard answer block. Grok/Copilot server-only enforcement cannot intercept an
answer that never invokes the Server. No credentials, recurring automation,
host configuration, factory policies, database rows or live services were
changed by producing this candidate.
