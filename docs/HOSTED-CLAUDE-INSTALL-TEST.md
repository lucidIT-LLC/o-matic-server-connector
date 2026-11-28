# Hosted Claude install test (core-crew 1.1.0)

This is the single test that decides whether the bundled plugin (MCP plus crew) is visible on a hosted Claude host, or whether we must switch the published marketplace to the two-plugin fallback.

A local CLI install is useful, but it is **not** this test. Decision #333 recorded that hosted hosts (Cowork, Claude desktop, and other hosted marketplace hosts) skipped plugins that declared an `mcpServers` block. This test checks that finding against the 1.1.0 bundled plugin.

## Marketplace source

| Field | Value |
|---|---|
| Repository | https://github.com/lucidIT-LLC/o-matic-server-connector |
| Branch | `carver/core-crew-bundle-1.1.0` |
| Marketplace file | `.claude-plugin/marketplace.json` at the repo root |
| Marketplace name | `o-matic-server-connector` |
| Plugin to install (bundled, default) | `omatic-server-connection` |
| Selector | `omatic-server-connection@o-matic-server-connector` |

Do not install from `main`. `main` does not yet have this marketplace.

## What to do on a hosted Claude host

Use a hosted surface (Claude Cowork, Claude desktop, or another hosted marketplace host — not only the local Claude Code CLI).

1. Add the marketplace from this branch. Official Claude Code syntax pins a branch with `#ref` (or `@ref`):
   ```
   claude plugin marketplace add lucidIT-LLC/o-matic-server-connector#carver/core-crew-bundle-1.1.0
   ```
   In a Claude session:
   ```
   /plugin marketplace add lucidIT-LLC/o-matic-server-connector#carver/core-crew-bundle-1.1.0
   ```
   In-app: **Manage plugins → Marketplaces → Add** the GitHub repo `lucidIT-LLC/o-matic-server-connector` and pin branch `carver/core-crew-bundle-1.1.0`. Do not add `main`; it does not have this marketplace yet.
2. Refresh the marketplace, then install the plugin:
   ```
   claude plugin install omatic-server-connection@o-matic-server-connector
   ```
   or, in a session:
   ```
   /plugin install omatic-server-connection --marketplace lucidIT-LLC/o-matic-server-connector
   ```
3. If prompted, leave the Server URL at the cloud default `https://factory.o-matic.ai/mcp`, or enter a reachable on-prem HTTPS MCP URL. Sign in with the host's existing OAuth/SSO if asked. Do not paste a token into chat.

## Pass

All of the following:

- The plugin `omatic-server-connection` is listed as installed (not omitted).
- The skills `probot-orchestrator`, `fred-storage`, and `data-analyst` are present and loadable.
- The agents `probot`, `fred`, and `data` are present, or the host says it loaded those agent definitions.
- An MCP connector named `o-matic-server` is shown, or the plugin asked for `server_url` and accepted it. The test does **not** require a successful `startup` READY card; connection success is a later step.

## Skip (fallback)

Any of the following:

- The hosted catalog or installer omits `omatic-server-connection` while other skill-only plugins from the same marketplace would install.
- The plugin installs but no crew skills or agents appear.
- The plugin installs but the MCP / `server_url` entry is stripped and that is the reason the crew never loads.

If the result is skip, switch the published marketplace to the approved two-plugin fallback (no new product decision needed):

```
python3 -B scripts/build_core_crew.py --marketplace fallback
```

Then install `omatic-server-connection` first and `omatic-core-crew` second. The crew plugin declares `dependencies: ["omatic-server-connection"]` and has no `mcpServers` block.

## Local CLI (not the hosted test)

On a machine with the Claude Code CLI, this only proves local packaging:

```
claude plugin marketplace add lucidIT-LLC/o-matic-server-connector#carver/core-crew-bundle-1.1.0
claude plugin install omatic-server-connection@o-matic-server-connector
claude plugin validate .
claude plugin validate hosts/claude/bundled/omatic-server-connection
```
A local path also works if you have this checkout: `claude plugin marketplace add /path/to/o-matic-server-connector`.

A local pass does not override a hosted skip.
