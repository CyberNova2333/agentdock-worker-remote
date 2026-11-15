---
title: Contracts & Boundaries
description: Security assumptions, HTTP/OAuth 2.1 limits, 10 MCP tool contracts, local approval ordering, and container/file policy invariants.
---

::: warning AI Translation Notice
Translated/synchronized from the authoritative Chinese documentation ([接口与扩展契约](/docs/contracts)). Check source files or Chinese docs if subtle phrasing differs.
:::

# Contracts & Boundaries

This page specifies the hard protocol, approval, replay, and sandbox contracts enforced across the Cloudflare Worker, Windows host connector, and Linux container.

## Security Assumptions & Capability Boundaries

| Boundary | Code Guarantee | Explicit Non-Goal / Risk |
| --- | --- | --- |
| Identity | Single owner (`userId: "owner"`), host-locked to `PUBLIC_ORIGIN` | No multi-tenancy; password change retires all prior grants |
| Transit | HTTPS required (`PUBLIC_ORIGIN`), zero-script CSP consent page | Cloudflare and the upstream AI client provider still see `/mcp` arguments & replies |
| Local Approval | Canonical SHA-256 over full request parameters; `.approved.json` unlinked before `RequestReceipts` claim | `504` timeout after approval cannot prove no side effect occurred; no auto-replay |
| Workspace | Single explicit root bound to `/workspace`; symlinks, multi-hardlinks, and custom DACL replacement blocked | Project files inside `/workspace` are intentionally readable/writable by approved tools |
| Host OS | `loadSecrets` (DPAPI) and `createWindowsReplacementGuard` require `win32` | Non-Windows hosts support Worker deploy & cross-platform tests only |

## Cloud HTTP & OAuth 2.1 Contract

| Route | Auth / Method | Rate & Body Limits | Contract |
| --- | --- | --- | --- |
| `/` | `GET` (Public) | — | Zero-script gateway card showing `<PUBLIC_ORIGIN>/mcp` |
| `/healthz` | `GET` / `HEAD` | — | Returns `200` (`{ "ok": true, "connectorOnline": true }`) or `503` |
| `/bridge` | `GET` WS Upgrade, `Bearer BRIDGE_TOKEN` | Secret >= 32 chars | Single active socket; returns `409` if live/grace socket exists |
| `/.well-known/*` | `GET` | — | OAuth Authorization Server & Protected Resource metadata |
| `/register` | `POST` (DCR) | `20 / 3600s`, `16,384 B` | `1..10` redirect URIs, `client_name <= 120`, 90-day client TTL; CIMD also enabled |
| `/authorize` | `GET` / `POST` | `GET: 30 / 600s`, `POST: 8 / 600s`, `8,192 B` | PKCE `S256` (43 chars) required; 10-min form handle; Origin + PBKDF2-SHA256 verification |
| `/oauth/token` | `POST` form | `120 / 60s`, `16,384 B` | Access TTL `3600s`, refresh TTL `30d` (only with `offline_access`); reuse revokes whole family |
| `/oauth/token/revoke` | `POST` form | `16,384 B` | Revokes grant family using body `client_id`, Basic auth, or UTF-8 JWT `client_assertion` |
| `/mcp` | `POST` (Bearer) / `OPTIONS` | `1 MiB` RPC / `2 MiB` reply | Validates `MCP-Protocol-Version` (`2025-03-26`, `2025-06-18`, `2025-11-25`); `110s` deadline (`504`) |

- **CORS Allowed Origins**: `PUBLIC_ORIGIN`, `https://chatgpt.com`, `https://chat.openai.com` (and controlled subdomains).
- **Relay Lanes & Liveness**: `FIRST_HEARTBEAT_GRACE = 10s`, `HEARTBEAT_MAX_AGE = 65s`. Relay allows `16` ordinary concurrent RPCs and `4` `stop_command` slots (`2` max per client).

## 10 MCP Tools, Local Approval & Replay Order

Although `cloud/index.mjs` still lists legacy aliases `agentdock_context` and `get_command`, `local/request-policy.mjs` (`toolScopes`) and `local/tools.mjs` (`TOOL_DEFINITIONS`) strictly expose and enforce the following **10 tools**:

| Tool | Required Scopes | Exempt from `Approve.cmd`? | Key Limits |
| --- | --- | --- | --- |
| `computer_context` | `computer:read` | Yes | Returns container image ID, workspace mount, limits, security text |
| `list_directory` | `computer:read` | No | `limit: 1..1000` (default `200`), filesystem order, never follows symlinks |
| `read_file` | `computer:read` | No | UTF-8 char-aligned `offset`, `max_bytes: 1..262144` (default `65536`), returns `sha256` on full read |
| `search_files` | `computer:read` | No | Literal `content`/`name`, skips `.git`/`node_modules`/`.wrangler` & `>1 MiB`, caps: 128 dirs / 5000 entries / 2000 files / 16 MiB / 5s |
| `write_file` | `computer:read` + `computer:write` | No | `<= 1 MiB` UTF-8, requires `overwrite: true` on existing files, optional `expected_sha256` |
| `edit_file` | `computer:read` + `computer:write` | No | Unique literal `old_text`, `expected_sha256` CAS check, `<= 1 MiB` result |
| `delete_file` | `computer:read` + `computer:write` | No | Single regular file only (never directories/recursive), optional `expected_sha256` |
| `exec_command` | `computer:read` + `computer:execute` | No | `<= 32,768 B` cmd; `sync` `100..60,000 ms` (def `30s`), `background` `100..3,600,000 ms` (def `300s`); output `<= 131,072 B`; `network` `none`\|`outbound`; max 4 active / 64 in memory |
| `command_status` | `computer:read` + `computer:execute` | Yes | Owner `clientId` checked; active only during current connector session |
| `stop_command` | `computer:read` + `computer:execute` | Yes | Owner `clientId` checked; runs `docker rm -f` + process tree stop |

- **Approval & Ledger Invariants**: `boundedJson` caps envelopes at `20,000` nodes / depth `32`. Pending `.request.json` has `5`-minute TTL, max `64` pending (`8` per client), and `1,200,000 B` compact UTF-8 cap (`APPROVAL_RECORD_TOO_LARGE`). Retries follow `RequestReceipts.inspect` -> `LocalApprovals.authorize` (unlinks `.approved.json` + `.request.json`) -> `RequestReceipts.claim` (24h ledger, max `10,000` files) -> `runtime.handleRpc`. Control calls use `TransientReceipts` (`1000` / `120s`) and dedicated `StopReceipts` (`128` FIFO).

## Container Sandbox & File Policy Contract

Containers launch with `--pull never`, `--read-only`, `--cap-drop ALL --cap-add SETUID --cap-add SETGID`, `--security-opt no-new-privileges=true`, `--pids-limit 256`, `--memory 2g --memory-swap 2g --cpus 2`, `--log-driver none`, `--network none|bridge`, single `/workspace` bind mount, and 512m tmpfs on `/tmp` and `/home/developer`. `container/runner.mjs` drops execution to UID/GID `1000` and kills the container (`125`) if the host fails to send a `{"type":"lease"}` heartbeat within `20s`. File operations execute in `container/file-worker.mjs` (`allowExec: false`) under `file-safety.mjs` (`lstat`, `nlink === 1`, `dev:ino` stability, atomic `O_EXCL` writes) and Windows `windows-acl.mjs` preflight before any replacement. Unconfirmed `docker rm -f` transitions the sandbox to `closed = true`, blocking new operations while preserving owner `command_status` and `stop_command`.

## Extension FAQ

- **How do I disable `exec_command` or outbound container networking?** Set `allowExec: false` or `sandbox.allowOutbound: false` in `%USERPROFILE%\.agentdock-bridge\config.json` and restart via `Stop.cmd` / `Start.cmd` (note `Install-Hardened.ps1` resets both to `true`).
- **What must change when adding a new MCP tool?** Update scope classification in `cloud/index.mjs`, local whitelist & approval policy in `local/request-policy.mjs`, strict schemas (`additionalProperties: false`) in `local/tools.mjs` / `local/sandbox.mjs`, and corresponding `test/` + `cloud/` assertions.
