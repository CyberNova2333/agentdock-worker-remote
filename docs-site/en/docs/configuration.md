---
title: Configuration & Scripts Matrix
description: Reference for wrangler.jsonc, Cloudflare Secrets, local config.json, environment variables, and PowerShell scripts.
---

::: warning AI Translation Notice
Translated/synchronized from the authoritative Chinese documentation ([配置矩阵与运维脚本](/docs/configuration)). Check source files or Chinese docs if subtle phrasing differs.
:::

# Configuration & Scripts Matrix

Configuration is separated cleanly into **Cloudflare Worker configuration** and the **protected local state directory** (default `%USERPROFILE%\.agentdock-bridge`). Never commit `wrangler.jsonc`, `.dev.vars`, or `secrets.dpapi`.

## 1. Cloudflare Worker (`wrangler.jsonc` & Secrets)

| Setting | Example / Binding | Purpose |
| --- | --- | --- |
| `main` | `cloud/index.mjs` | Edge entrypoint exporting default `fetch`, `BridgeRelay`, and `AuthCoordinator` |
| `compatibility_date` / flags | `2026-10-28`, `nodejs_compat`, `global_fetch_strictly_public` | Enables Node compatibility and restricts Worker fetches to public endpoints |
| `preview_urls` | `false` | Disables ephemeral preview hostnames that bypass `PUBLIC_ORIGIN` checks |
| `vars.PUBLIC_ORIGIN` | `https://bridge.example.test` | Required HTTPS origin checked against request host, CORS, and consent POST origin |
| `durable_objects.bindings` | `RELAY` (`BridgeRelay`), `AUTH` (`AuthCoordinator`) | SQLite-backed DOs initialized via migrations `v1` and `v2` |
| Secret `BRIDGE_TOKEN` | Min 32-char URL-safe random secret | Shared bearer token for `WSS /bridge` and IP rate-limit key salt |
| Secret `OWNER_PASSWORD_HASH` | `pbkdf2-sha256$100000$<salt>$<hash>` | Verifies owner login; SHA-256 shifts `AUTH` generation `owner-v2-<hash>` |

## 2. Protected State Directory (`%USERPROFILE%\.agentdock-bridge`)

Protected by NTFS ACLs restricting FullControl to the current Windows user SID and `SYSTEM` (`S-1-5-18`):

- `secrets.dpapi`: CurrentUser DPAPI ciphertext (entropy `cbnv.agentdock-bridge.secrets.v1`).
- `config.json`: Connector configuration (see table below).
- `runtime-<timestamp>-<id>/` & `installation.json`: Isolated copy of `local/`, `scripts/`, `package.json`, `pnpm-lock.yaml`, production deps, and SHA-256 manifest.
- `Start.cmd`, `Stop.cmd`, `Status.cmd`, `Password.cmd`, `Approve.cmd`: Trusted entrypoints (note root `ShowPassword.cmd` forwards to `%USERPROFILE%\.agentdock-bridge\Password.cmd`).
- `approvals/` & `request-receipts/`: 5-minute TTL queue files and 24-hour replay receipts.

| `config.json` Field | Writer | Meaning & Constraint |
| --- | --- | --- |
| `origin` | `Setup.ps1` | Matches Worker `PUBLIC_ORIGIN` (HTTPS required outside loopback tests) |
| `roots` / `defaultCwd` | `Install-Hardened.ps1 -Workspace` | Exactly **one** explicit directory mounted at `/workspace` (must not contain `stateDir` or `sourceRoot`) |
| `sourceRoot` | `Install-Hardened.ps1` | Must equal running script root; blocks launching from unhardened folders |
| `nodePath` / `nodeRoot` / `nodeSha256` | `Install-NodeRuntime.ps1` | Pinned Node `24.22.1` under `%USERPROFILE%\.agentdock-toolchains`, verified on every start/approval |
| `allowExec` | `Setup.ps1` (`false`) -> `Install-Hardened.ps1` (`true`) | Enables `exec_command`, `command_status`, `stop_command` on the sandbox (`file-worker.mjs` keeps `false`) |
| `requireLocalApproval` | `true` | Required by `Manage.ps1 Start` |
| `sandbox.enabled` / `image` / `dockerPath` / `context` / `allowOutbound` | `Install-Hardened.ps1` | Pinned `sha256:<64-hex>` image, `nlink === 1` `docker.exe`, `desktop-linux` context, outbound toggle (`true`) |

## 3. Environment Variables, npm/pnpm & PowerShell Scripts

| Variable / Script | Scope & Notes |
| --- | --- |
| `HTTPS_PROXY` / `HTTP_PROXY` | Optional proxies probed alongside Windows WinINet registry settings and direct route |
| `AGENTDOCK_DOCKER_TEST` | Enables real container integration tests in `test/sandbox.test.mjs` |
| `AGENTDOCK_BRIDGE_TOKEN` | Explicitly deleted from `process.env` at connector startup |
| `NODE_OPTIONS`, `NODE_PATH`, `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS` | Cleared by `Clear-NodeOverrides` before launching Node |
| `pnpm run dev` | Starts `wrangler dev --ip 127.0.0.1 --port 8797` for loopback testing |
| `pnpm run check` / `pnpm test` | Syntax check across modules & Node test runner (`test/*.test.mjs cloud/*.test.mjs`) |
| `scripts/Manage.ps1` | `-Action Start\|Stop\|Status\|Run\|Password` using process start-time verification & mutex |
| `scripts/Rotate-Secrets.ps1` | Two-step rotation (`secrets.next.dpapi` -> `wrangler secret bulk` -> promote to `secrets.dpapi`) while stopped |
| `scripts/acceptance-v2.mjs` / `verify-lifecycle.mjs` | Explicit maintainer live verification against public `/healthz` and `/mcp` |

## 4. Rotating Credentials Safely

1. Run `%USERPROFILE%\.agentdock-bridge\Stop.cmd` and verify both supervisor and connector exited.
2. Run `.\scripts\Rotate-Secrets.ps1`. If Cloudflare upload fails, `secrets.next.dpapi` remains so retries are idempotent; once committed, old OAuth tokens fail immediately due to the shifted `owner-v2-*` DO generation.
3. Re-authenticate MCP clients using the new password shown by `Password.cmd`.
