---
title: Architecture & Security ADRs
description: Three-tier isolation model, interactive topology diagram, diagram-vs-source protocol notes, and key security ADRs.
---

::: warning AI Translation Notice
Translated/synchronized from the authoritative Chinese documentation ([架构全景与安全决策](/docs/architecture)). Check source files or Chinese docs if subtle phrasing differs.
:::

# Architecture & Security ADRs

AgentDock Bridge enforces three strict separation planes: **no persisted workspace secrets on Cloudflare**, **no direct host command/file execution in the connector process**, and **no host tokens or default outbound networking inside the Linux container**.

## Interactive Topology Diagram

<DiagramFrame
  src="/diagrams/worker-architecture.html"
  title="AgentDock Bridge Topology (pan / zoom / inspect supported)"
  aspect="940 / 448"
  new-tab-label="Open Fullscreen ↗"
/>

> **Diagram vs. Source Note**: The visual diagram summarizes the four zones at a conceptual level. In actual code, client RPCs use stateless HTTP `POST /mcp` (JSON-RPC 2.0 rather than SSE log streams), `OAuth 2.1 + PKCE (S256)`, an outbound `WSS /bridge` WebSocket from the host connector, and per-call `docker create` + `docker start --attach` after `Approve.cmd`.

## Core Subsystem Handoff

- **Cloudflare Worker (`cloud/`)**: Routes public traffic, runs `AuthCoordinator` (`owner-v2-*` SQLite DO) for OAuth 2.1 + PKCE + refresh rotation, and forwards validated JSON-RPC envelopes via `BridgeRelay` (`primary` DO).
- **Windows Host Connector (`local/` + `scripts/`)**: Decrypts `secrets.dpapi` in a sanitized PowerShell subprocess, re-validates envelopes (`validateRequestEnvelope`), enforces exact canonical SHA-256 approvals (`Approve.cmd`) and pre-execution `RequestReceipts`, checks NTFS DACLs before file replacement, and drives the Docker CLI.
- **Linux Sandbox (`container/`)**: Runs PID 1 `runner.mjs` (20s host lease watchdog, UID/GID 1000) dispatching either `bash --noprofile --norc` or `file-worker.mjs` (`allowExec: false` + `file-safety.mjs`).

Follow a single call end-to-end in [End-to-End Request Walkthrough](/en/docs/walkthrough) or locate files in [Source & Test Code Map](/en/docs/code-map).

## Security ADRs and Migration {#security-adrs-and-migration}

### ADR-01: Password-Hash Generation Isolation (`owner-v2-*`) & CIMD Metadata Repair

To prevent downgraded CIMD or legacy grants from surviving re-authorization or password changes (`R4-01`), `AuthStore.completeMetadata` reconstructs canonical `grant:*` metadata on every write/list, and `cloud/index.mjs` namespaces `AuthCoordinator` as `owner-v2-${sha256(OWNER_PASSWORD_HASH)}`. Any password rotation invalidates all prior grants immediately; clients must re-authorize.

### ADR-02: Out-of-Lock Preparation & Optimistic Revision Commits

To keep slow HTTP uploads or external CIMD/JWKS fetches from blocking all OAuth and MCP traffic (`R4-03`), `cloud/index.mjs` buffers bounded request bodies before entering `AuthCoordinator`, and `AuthTransactions` executes preparation outside `AuthQueue`, checking `revision` before synchronous SQLite commits with lane caps (`authorization: 4`, `mcp: 32`, `stop: 4`) and 4 retries.

### ADR-03: Dedicated Stop Lane & Cleanup-Failure Fallback

To ensure a saturated control receipt cache or failed `docker rm -f` never prevents an owner from stopping active jobs (`R4-04` / `FINAL-01`), `stop_command` has dedicated concurrency limits and `StopReceipts` (128 FIFO), and `sandbox.mjs` evaluates owner-scoped `command_status`/`get_command`/`stop_command` **before** rejecting new operations under `closed = true`.

### ADR-04: Compact JSON Approval Budget, Merged CSP & Host Hardening

`approval-store.mjs` validates compact UTF-8 size (`1,200,000 B`) before temp-file creation; `/authorize` merges rather than overwrites zero-script CSP headers; `Install-NodeRuntime.ps1` pins Node `24.22.1` (SHA-256 + OpenJS signature) inside ACL-verified private toolchains; `windows-acl.mjs` refuses atomic Linux `rename` over files with custom explicit NTFS DACLs.

### Upgrade Checklist

1. Run `pnpm install --frozen-lockfile && pnpm run check && pnpm test` in the updated checkout.
2. Run `Stop.cmd`, rebuild `container/Dockerfile`, and re-run `.\scripts\Install-Hardened.ps1 -Workspace "<workspace-path>"` (preserves `%USERPROFILE%\.agentdock-bridge` DPAPI secrets and receipts).
3. Run `pnpm run deploy` if `cloud/` or `wrangler.jsonc` changed, then restart with `Start.cmd` and verify `Status.cmd`.

## Evidence & Verification Boundaries

Verification logs for real Windows ACLs, pinned Docker runs, and live Cloudflare endpoints belong to the specific commit snapshots in `SECURITY-FIXES.md`. Cross-platform doc/test checks on Linux automatically skip the 15 Windows/Docker-specific cases.
