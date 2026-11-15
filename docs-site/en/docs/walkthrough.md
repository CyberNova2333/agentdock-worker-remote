---
title: End-to-End Request Walkthrough
description: Step-by-step trace of a sensitive MCP tool request from Cloudflare OAuth and relay to Approve.cmd, replay ledger, and Linux container execution.
---

::: warning AI Translation Notice
Translated/synchronized from the authoritative Chinese guide ([一次请求端到端走查](/docs/walkthrough) / `repo-docs/walkthroughs/one-real-run.md`). Refer to the Chinese pages or source code for full depth.
:::

# End-to-End Request Walkthrough

This walkthrough traces a sensitive `read_file` (or `exec_command`) call end-to-end across all three trust planes.

## Step 1: Cloud Authentication & Envelope Relay

When an MCP client posts JSON-RPC to `/mcp`, `cloud/index.mjs` validates the configured host, `MCP-Protocol-Version`, and `1 MiB` body cap, then enters `AuthCoordinator` (`owner-v2-*`) to verify the OAuth 2.1 access token and required scopes (`computer:read` for reads). `BridgeRelay` packs `{ type: "request", id, body, authorization, issuedAt, deadline }` (110s deadline) and pushes it down the active `WSS /bridge` WebSocket.

## Step 2: Local Policy Inspection & Pending Queue

`BridgeConnector` (`local/connector.mjs`) verifies the envelope via `validateRequestEnvelope` (`20,000` JSON nodes / depth `32`, 10-tool `toolScopes` whitelist) and checks `RequestReceipts.inspect` to reject duplicate bridge IDs. For sensitive tools outside `APPROVAL_EXEMPT_TOOLS` (`computer_context`, `command_status`, `stop_command`), if no valid `.approved.json` exists yet, `LocalApprovals` writes an atomic compact JSON `.request.json` (max `1,200,000 B`, 5-minute TTL, queue max `64` / `8` per client) bound to `approvalSubject` (excluding client RPC `id`) and replies `LOCAL_APPROVAL_REQUIRED`.

## Step 3: Manual `Approve.cmd` Confirmation & Retry Ordering

In a local interactive terminal, the user runs `%USERPROFILE%\.agentdock-bridge\Approve.cmd` (`local/approval-cli.mjs`), reviews the control/bidi-escaped JSON (`safeText`), and types `APPROVE <uuid>`. When the client retries with identical parameters (even with a new JSON-RPC `id`) within 5 minutes, `BridgeConnector` executes in strict order:
1. Unlinks both `.approved.json` and `.request.json` (`LocalApprovals.authorize`);
2. Writes the 24-hour receipt in `RequestReceipts.claim` (blocking future replay of the same bridge request ID with `already_attempted`);
3. Invokes `runtime.handleRpc`.

## Step 4: Container Execution & Cleanup Failure Fallback

`createSandboxRuntime` (`local/sandbox.mjs`) runs `docker create` + `docker start --attach` using the pinned `sha256:...` `node:24-trixie-slim` image (`--read-only`, `--cap-drop ALL --cap-add SETUID --cap-add SETGID`, `no-new-privileges`, `--network none|bridge`, single `/workspace` bind mount). PID 1 `runner.mjs` checks 5s host lease heartbeats (20s timeout), drops to UID/GID `1000`, and runs either `/bin/bash` or `file-worker.mjs` (`allowExec: false`, `file-safety.mjs` symlink/hardlink/stability checks, Windows DACL replacement guard). If `docker rm -f` fails, `closed = true` blocks new operations while keeping owner `command_status` and `stop_command` active.

## Step 5: Targeted Local Verification

```sh
node --test test/connector.test.mjs test/approval-budget.test.mjs test/sandbox-recovery.test.mjs
pnpm run check
```

See [Contracts & Boundaries](/en/docs/contracts) for full parameter/limit tables and [Source & Test Code Map](/en/docs/code-map) for file locations.
