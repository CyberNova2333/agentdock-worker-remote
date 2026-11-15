---
title: Deployment & Runtime FAQ
description: Diagnostics for /healthz 503, LOCAL_APPROVAL_REQUIRED, ACL rejections, cleanup lockouts, and OAuth token reuse errors.
---

::: warning AI Translation Notice
Translated/synchronized from the authoritative Chinese documentation ([部署与运行排错 FAQ](/docs/faq)). Check source files or Chinese docs if subtle phrasing differs.
:::

# Deployment & Runtime FAQ

This page covers concrete runtime errors and operational diagnostics. For pre-adoption architecture/selection questions, see `README.en.md`. Always redact secrets, host paths, file contents, and command outputs before sharing logs.

## Connector Connectivity & `503` Errors

- **`Status.cmd` shows the local connector running, yet `/healthz` or `/mcp` returns `503`?**
  `BridgeRelay` enforces `FIRST_HEARTBEAT_GRACE` (`10s`) and `HEARTBEAT_MAX_AGE` (`65s`). Check `connector-status.json` in `%USERPROFILE%\.agentdock-bridge`, verify proxy reachability (`HTTPS_PROXY` / Windows WinINet), and confirm `BRIDGE_TOKEN` matches between DPAPI storage and Cloudflare Secrets.
- **`409 A connector is already online or completing its heartbeat`?**
  Only one live `/bridge` socket is allowed at a time. Wait up to 65s for the dropped socket's heartbeat window to expire, or stop the existing host process via `Stop.cmd`.

## Local Approvals & Replay Protection

- **Why does every retry still return `LOCAL_APPROVAL_REQUIRED`?**
  Approvals expire after **5 minutes** and bind exact `origin`, client identity, scopes, method, and all arguments (excluding only client JSON-RPC `id`). Changing path, offset, content, or `network: "outbound"` invalidates the match and queues a new pending record (caps: `64` global / `8` per client).
- **What triggers `APPROVAL_RECORD_TOO_LARGE`?**
  `approval-store.mjs` enforces a `1,200,000`-byte UTF-8 ceiling on the compact JSON `.request.json` record before creating any temp file. Split large writes/edits or trim excessive client metadata.
- **Why does retrying after a `504` timeout fail with `already_attempted`?**
  Sensitive calls unlink `.approved.json` and claim a 24-hour entry in `RequestReceipts` **before** running the container. A `110s` timeout cannot prove nothing executed, so replay is blocked by design. Inspect workspace/command state via read-only tools or `command_status`, then submit a fresh RPC if needed.

## Windows Host ACLs & Docker Failures

- **`Assert-PrivateState` or `Assert-WriteProtectedPath` blocks startup or installation?**
  `State-Safety.ps1` inspects `%USERPROFILE%\.agentdock-bridge`, `%USERPROFILE%\.agentdock-toolchains`, and **every ancestor directory**, rejecting symlinks/junctions, multiple hard links (`Links !== 1`), or unexpected write/modify ACEs (such as leftover sandbox user ACEs). Inspect ancestor permissions and remove unexpected principals.
- **Why do `edit_file` and `write_file(overwrite=true)` refuse certain files on Windows?**
  Container-side `rename` over a Windows bind mount can strip custom NTFS DACLs. `local/windows-acl.mjs` blocks replacement whenever explicit non-inherited ACEs, protected ACLs, or a different file owner are detected; edit those files natively on Windows.
- **What does `cleanup_confirmed: false` mean and why are new commands rejected afterward?**
  When `docker rm -f` fails with anything other than `No such container/object`, the sandbox sets `closed = true`, blocking all new file and command calls while keeping `command_status` and `stop_command` open for the owning client. Inspect `docker ps -a`, fix Docker Desktop, and restart via `Stop.cmd` then `Start.cmd`.

## OAuth Sessions & Cross-Platform Tests

- **`Refresh credential reuse detected. Connect again.`?**
  Submitting a previously rotated (`spent`) refresh token revokes the entire grant family in `AuthStore`. Reconnect the MCP client using `Password.cmd` (or whenever `Rotate-Secrets.ps1` updates `OWNER_PASSWORD_HASH`).
- **Why does `pnpm test` skip 15 tests on Linux or macOS?**
  Windows DPAPI (`secret-process.test.mjs`), NTFS ACL (`windows-acl.test.mjs`), PowerShell supervisor checks (`management-safety.test.mjs`), and real Docker integration (`sandbox.test.mjs` without `AGENTDOCK_DOCKER_TEST`) auto-skip when host prerequisites are absent.
