---
title: Overview & Setup Workflow
description: Scope boundaries, trust model, and end-to-end deployment flow for AgentDock Bridge.
---

::: warning AI Translation Notice
Translated/synchronized from the authoritative Chinese documentation ([简体中文文档](/docs/)). Check source files or Chinese docs if subtle phrasing differs.
:::

# Overview & Setup Workflow

AgentDock Bridge is a **single-owner personal remote MCP gateway**. It connects remote MCP clients (such as ChatGPT) over Cloudflare Workers OAuth 2.1 + PKCE to your local workstation, waits for explicit human approval of exact arguments in a local terminal, and executes file and Bash tools inside a read-only Linux Docker container.

## Runtime Scope & Platform Boundaries

| Layer | Supported Runtime | Key Boundaries |
| --- | --- | --- |
| Cloud Edge | Cloudflare Workers + two SQLite Durable Objects (`AuthCoordinator`, `BridgeRelay`) | Production requests require HTTPS (`127.0.0.1` / `localhost` / `[::1]` allowed for local tests) |
| Production Host | **Windows x64** (PowerShell 5.1, DPAPI `secrets.dpapi`, NTFS ACL checks, Docker Desktop) | `loadSecrets` and `windows-acl.mjs` require `win32`; Linux/macOS supports Worker deploy and JS/cloud tests only |
| Execution Sandbox | Linux container via `desktop-linux` Docker context (`node:24-trixie-slim`, UID/GID `1000`) | Mounts **one** explicit workspace at `/workspace`; approved tools can read/write project-local files |

> **Trust Notice**: Cloudflare and your upstream AI client platform still observe `/mcp` arguments and results in transit. This bridge guarantees that no local action runs without owner OAuth consent and exact `Approve.cmd` confirmation.
>
> **Interactive Reference**: Browse every OAuth endpoint, `WSS /bridge` rule, and all 10 MCP tool schemas with explicit bounds in the [API & Component Reference](/en/api-reference/).

## Prerequisites

1. A Cloudflare account with HTTPS domain routing (`PUBLIC_ORIGIN`) and authenticated `wrangler`.
2. **Windows x64** with Node.js 24+, `pnpm@12.6.0`, and Docker Desktop (`desktop-linux` context active over `npipe://`).
3. An explicit workspace directory (`<workspace-path>`) strictly separate from `%USERPROFILE%\.agentdock-bridge` and your source checkout.

## Step-by-Step Deployment Workflow

### 1. Validate Checkout & Prepare `wrangler.jsonc`

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
Copy-Item wrangler.jsonc.example wrangler.jsonc
```

Set `vars.PUBLIC_ORIGIN` in `wrangler.jsonc` to your deployed HTTPS origin (for example `https://<your-bridge-domain>` without a trailing slash). `wrangler.jsonc` is ignored by Git and must never be committed.

### 2. Initialize Protected Host Secrets & Upload to Cloudflare

```powershell
.\scripts\Setup.ps1 -Roots "<workspace-path>" -Origin "https://<your-bridge-domain>"
.\scripts\Secrets.ps1 -Action Upload
```

`Setup.ps1` generates a 32-byte URL-safe `BRIDGE_TOKEN` and a 24-byte `OWNER_PASSWORD` (stored encrypted via Windows DPAPI in `%USERPROFILE%\.agentdock-bridge\secrets.dpapi`) plus a 100,000-iteration PBKDF2-SHA256 `OWNER_PASSWORD_HASH`. `Secrets.ps1 -Action Upload` pipes only `BRIDGE_TOKEN` and `OWNER_PASSWORD_HASH` into `wrangler secret bulk`.

### 3. Build the Pinned Development Image

```powershell
docker build -f container/Dockerfile -t agentdock-dev:2026-10-28 .
```

### 4. Install the Hardened Host Copy & Deploy the Worker

```powershell
.\scripts\Install-Hardened.ps1 -Workspace "<workspace-path>"
pnpm run deploy
```

`Install-Hardened.ps1` verifies ancestor ACLs, downloads and verifies pinned Windows x64 Node `24.22.1` (SHA-256 + OpenJS Authenticode signature under `%USERPROFILE%\.agentdock-toolchains`), pins the container `sha256:...` digest, copies `local/` and `scripts/` into a versioned `runtime-*` folder with frozen production dependencies, and generates trusted `.cmd` wrappers under `%USERPROFILE%\.agentdock-bridge`.

### 5. Start Connector, Connect MCP Client, and Approve Requests

```powershell
& "$env:USERPROFILE\.agentdock-bridge\Start.cmd"
& "$env:USERPROFILE\.agentdock-bridge\Status.cmd"
```

1. Confirm `/healthz` returns `200` (`{"ok":true,"connectorOnline":true}`).
2. Add `https://<your-bridge-domain>/mcp` in your remote MCP client.
3. On the OAuth consent page, verify the client identity and callback URI, then enter the password shown by `%USERPROFILE%\.agentdock-bridge\Password.cmd` (or root `ShowPassword.cmd`).
4. When a file or command tool returns `LOCAL_APPROVAL_REQUIRED`, run `%USERPROFILE%\.agentdock-bridge\Approve.cmd`, inspect the escaped JSON arguments, type `APPROVE <uuid>`, and retry with identical arguments within 5 minutes.

## Next Steps

- Full parameter, script, and rotation matrix: [Configuration & Scripts Matrix](/en/docs/configuration)
- Error diagnosis (`503`, `APPROVAL_RECORD_TOO_LARGE`, ACL failures): [Deployment & Runtime FAQ](/en/docs/faq)
- HTTP/OAuth, MCP tool schemas, replay ordering & sandbox flags: [Contracts & Boundaries](/en/docs/contracts)
