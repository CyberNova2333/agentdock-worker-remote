<h1 align="center">AgentDock Bridge</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg" alt="License: AGPL-3.0-only" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node-%3E%3D24-339933.svg" alt="Node &gt;= 24" /></a>
  <a href="wrangler.jsonc.example"><img src="https://img.shields.io/badge/Runtime-CF%20Worker%20%2B%20Win%20x64%20%2B%20Docker-0969da.svg" alt="Runtime" /></a>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong> · <a href="https://agentdock-worker-remote.cbnv.me/en/">Live Documentation</a> · <a href="docs-site/en/index.md">Docs Source</a> · <a href="repo-docs/README.md">Source Walkthrough (ZH)</a>
</p>

Personal authenticated MCP remote bridge: routes remote MCP clients (such as ChatGPT) through Cloudflare Workers OAuth 2.1 + PKCE, enforces exact per-request manual approval on a hardened Windows connector, and executes workspace file and command tools inside a read-only Linux Docker container. Production host secret protection relies on Windows DPAPI and NTFS ACLs; non-Windows hosts support Worker deployment, image builds, and cross-platform JS/cloud regression tests.

## Core Capabilities & Flow

- **Edge OAuth 2.1 with Password-Generation Isolation**: Splits `AuthCoordinator` and `BridgeRelay` across two SQLite Durable Objects, requiring PKCE `S256`, zero-script CSP consent HTML, and refresh-token family revocation; rotating the owner password advances the generation prefix and immediately invalidates old grants.
- **Exact Local Approval & Pre-Execution Replay Ledger**: Except for context/status/stop controls, every tool invocation binds `origin`, client identity, scopes, method, and full arguments into a canonical SHA-256 digest requiring `Approve.cmd` confirmation; retries consume the approval file before claiming a 24-hour durable receipt.
- **Disposable Linux Container Sandbox & File Policy**: Commands and file operations execute under UID/GID 1000 with `--read-only`, `--cap-drop ALL` (retaining only `SETUID`/`SETGID`), `no-new-privileges`, and `--network none` by default; `file-safety` rejects symlinks, multi-hardlinks, malformed Unicode, and custom Windows DACL replacement.
- **Fail-Closed Cleanup Guard**: Any unconfirmed `docker rm -f` halts all new file or command operations while keeping `command_status`, `get_command`, and `stop_command` available to the owning client without falsely reporting cleanup success.
- **Hardened Host Copy & Pinned Toolchain**: Isolates config, secrets, and runtime files into `%USERPROFILE%\.agentdock-bridge`, checks ancestor directory ACLs, DPAPI ciphertexts, and pinned Node 24.22.1 SHA-256 checksums, and clears Node preload/TLS override variables on launch.

## Capabilities & Explicit Non-Goals

| Dimension | What AgentDock Bridge Delivers | Explicit Non-Goals & Hard Bounds |
| --- | --- | --- |
| Cloud Auth & Relay | OAuth 2.1 + PKCE S256, zero-script CSP consent HTML, generation-based password invalidation, outbound `WSS /bridge` | **No** multi-tenancy (single `owner` only) or SSE response streaming; Cloudflare & upstream AI platforms see payloads |
| Local Approval | All tools outside `computer_context`, `command_status`, `stop_command` require `Approve.cmd` over canonical SHA-256 args | `5`-minute pending TTL (`64` queue cap); **zero auto-replay** on `504`; production DPAPI/ACL requires Windows x64 |
| Tools & Sandbox | 10 MCP tools isolated in `--read-only`, `--cap-drop ALL`, UID `1000`, `--network none` Linux containers | `1 MiB` RPC / `2 MiB` reply / `110s` cap; `<= 1 MiB` file mutations; unconfirmed cleanup locks down new tasks |

```mermaid
flowchart LR
  MCPClient["MCP Client (POST /mcp)"] --> Worker["Cloudflare Worker (OAuth 2.1 + BridgeRelay)"]
  Worker --> Connector["Local Connector (Policy + Queue)"]
  Connector --> Approve["Approve.cmd Exact Review"]
  Approve --> Ledger["Consume Approval + Claim Receipt"]
  Ledger --> Container["Linux Container Sandbox (/workspace)"]
```

Tool responses and heartbeats travel back over the outbound `WSS /bridge` WebSocket initiated by the connector and resolve the pending `/mcp` HTTP call; routine start, stop, status, and password prompts invoke `%USERPROFILE%\.agentdock-bridge\{Start,Stop,Status,Password,Approve}.cmd` (root `.cmd` files simply forward there).

## Quick Start

Minimal production path on Windows x64 with Cloudflare CLI login and Docker Desktop (`desktop-linux`) ready (connect MCP clients to `https://<PUBLIC_ORIGIN>/mcp`):

```powershell
pnpm install --frozen-lockfile && pnpm run check && pnpm test
Copy-Item wrangler.jsonc.example wrangler.jsonc   # Set PUBLIC_ORIGIN to your domain
.\scripts\Setup.ps1 -Roots "<workspace-path>" -Origin "https://<your-bridge-domain>"
.\scripts\Secrets.ps1 -Action Upload
docker build -f container/Dockerfile -t agentdock-dev:2026-10-28 .
.\scripts\Install-Hardened.ps1 -Workspace "<workspace-path>"
pnpm run deploy
& "$env:USERPROFILE\.agentdock-bridge\Start.cmd"
```

Other deployment modes and platform guides:

| Scenario / Mode | Scope & Behavior Summary | Detailed Docs |
| --- | --- | --- |
| Cloud Worker & Local Dev (`8797`) | `wrangler.jsonc`, `BRIDGE_TOKEN` / `OWNER_PASSWORD_HASH`, `wrangler dev --ip 127.0.0.1 --port 8797` | [Getting Started](docs-site/en/docs/index.md) · [Configuration](docs-site/en/docs/configuration.md) |
| Hardened Windows Host & Rotation | Protected `%USERPROFILE%\.agentdock-bridge`, pinned Node 24.22.1 SHA-256 verification, two-step rotation | [Configuration Guide](docs-site/en/docs/configuration.md) |
| Container Image & Sandbox Contracts | 10 MCP tool limits, `network: "outbound"` opt-in, `file-worker` `allowExec: false` boundary | [Contracts & Boundaries](docs-site/en/docs/contracts.md) |
| Public & Lifecycle Verification | Explicit CLI runs of `acceptance-v2.mjs` / `verify-lifecycle.mjs` against live `/healthz` and `/mcp` | [Configuration](docs-site/en/docs/configuration.md) · [Security Fixes](SECURITY-FIXES.md) |
| Linux / macOS Development & Tests | Run `pnpm run check` and `pnpm test` (15 Windows/Docker-specific tests skip automatically) | [Troubleshooting FAQ](docs-site/en/docs/faq.md) · [Source Guide (ZH)](repo-docs/README.md) |

## Pre-Adoption FAQ

- **Why route through Cloudflare Workers instead of connecting straight to my workstation?**

  Remote MCP clients require a public trusted-HTTPS `/mcp` and OAuth 2.1 callback endpoint; the Worker provides edge TLS and OAuth state while the connector dials out over WSS without opening inbound router ports.

- **Can multiple users or teams share one gateway?**

  No. Every grant resolves to a single `owner` identity and mounts a single explicit workspace directory; deploy separate Workers and host connectors per owner.

- **Is traffic hidden from Cloudflare or the upstream AI client platform?**

  No. Cloudflare terminates TLS and routes OAuth and `/mcp` JSON-RPC envelopes, and tool arguments/outputs pass through your AI client provider. This bridge enforces owner authorization and per-action local approval, not blind E2E encryption.

- **Does Docker isolation protect secrets stored inside the mounted workspace?**

  No. The workspace mount is intentionally readable and writable inside `/workspace`; approved tools can read project-local files, and prompt injection inside untrusted repository text remains a risk you must review during `Approve.cmd`.

- **Can I run the production host connector natively on Linux or macOS?**

  Not out of the box. `loadSecrets`, `windows-acl.mjs`, and `scripts/*.ps1` enforce Windows DPAPI and NTFS ACLs; Linux/macOS currently supports Worker deployment, image builds, and cross-platform unit tests.

## Reading Paths

| Goal | Docs Site | Source Guide (`repo-docs/`, ZH) |
| --- | --- | --- |
| Deploy Worker, configure host, troubleshoot errors | [Getting Started](docs-site/en/docs/index.md) · [Config](docs-site/en/docs/configuration.md) · [FAQ](docs-site/en/docs/faq.md) | [Overview & Verification](repo-docs/README.md) |
| Inspect OAuth 2.1, tool schemas, approval & sandbox contracts | [Contracts & Boundaries](docs-site/en/docs/contracts.md) · [API & Component Reference](docs-site/en/api-reference/index.md) | [Cloud](repo-docs/modules/cloud-oauth-and-relay.md) · [Local Approval](repo-docs/modules/local-approval-and-replay.md) · [Container Policy](repo-docs/modules/container-sandbox-and-file-policy.md) |
| Follow end-to-end execution, architecture & ADRs | [Architecture & ADRs](docs-site/en/docs/architecture.md) · [Walkthrough](docs-site/en/docs/walkthrough.md) · [Code Map](docs-site/en/docs/code-map.md) | [One Real Run](repo-docs/walkthroughs/one-real-run.md) · [Code Map](repo-docs/code-map.md) · [Glossary](repo-docs/glossary.md) |
| Audit security fixes, reporting & contributions | [ADRs & Migration](docs-site/en/docs/architecture.md#security-adrs-and-migration) | [Security Fixes](SECURITY-FIXES.md) · [Evidence Audit](repo-docs/references/source-evidence.md) · [Security](SECURITY.md) |

## License & Acknowledgements

Licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Built on `@cloudflare/workers-oauth-provider` for OAuth 2.1 edge handling and VitePress for static documentation; source guides in `repo-docs/` are kept in sync with behavior changes (see `repo-docs/change-log.md`). Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before modifying or distributing changes.
