---
title: Source & Test Code Map
description: Directory-by-directory map of cloud/, local/, container/, scripts/, and test/ files, key symbols, and verification targets.
---

::: warning AI Translation Notice
Translated/synchronized from the authoritative Chinese guide ([源码目录与测试地图](/docs/code-map) / `repo-docs/code-map.md`). Refer to the Chinese guide or actual files before editing.
:::

# Source & Test Code Map

Start with [End-to-End Request Walkthrough](/en/docs/walkthrough) to understand the phase handoffs, then locate implementation and test files below.

## Directory Overview

| Directory | Responsibility | Key Entrypoints |
| --- | --- | --- |
| `cloud/` | Cloudflare Worker OAuth 2.1, rate limits, Durable Objects & WSS relay | `index.mjs`, `relay.mjs`, `auth-store.mjs`, `auth-transactions.mjs`, `security.mjs`, `liveness.mjs` |
| `local/` | Host WebSocket connector, envelope policy, approvals, replay receipts, Docker broker & file safety | `connector.mjs`, `request-policy.mjs`, `approvals.mjs`, `approval-store.mjs`, `approval-cli.mjs`, `receipts.mjs`, `sandbox.mjs`, `tools.mjs`, `file-safety.mjs`, `windows-acl.mjs`, `docker-query.mjs` |
| `container/` | Hardened container image, PID 1 lease supervisor, and isolated file worker | `Dockerfile`, `runner.mjs`, `file-worker.mjs` |
| `scripts/` | Windows DPAPI setup, ACL checks, pinned Node install, hardened runtime install, rotation & live acceptance | `Setup.ps1`, `Secrets.ps1`, `Rotate-Secrets.ps1`, `Install-NodeRuntime.ps1`, `Install-Hardened.ps1`, `State-Safety.ps1`, `Manage.ps1`, `Approve.ps1`, `acceptance-v2.mjs`, `verify-lifecycle.mjs` |
| `test/` | Host, approval budget, file hardening, Windows ACL, management safety & sandbox recovery tests | `connector.test.mjs`, `approval-budget.test.mjs`, `control-receipts.test.mjs`, `sandbox-recovery.test.mjs`, `sandbox.test.mjs`, `file-hardening.test.mjs`, `windows-acl.test.mjs`, `management-safety.test.mjs` |

## Change Entrypoints

- **Auth, scopes, CORS, or refresh revocation**: inspect `cloud/index.mjs`, `cloud/auth-store.mjs`, `cloud/auth-transactions.mjs`, and run `node --test cloud/*.test.mjs`.
- **Approval digest, budgets, or replay ledger ordering**: inspect `local/request-policy.mjs`, `local/approvals.mjs`, `local/approval-store.mjs`, `local/receipts.mjs`, and `local/connector.mjs`; verify with `test/connector.test.mjs`, `test/approval-budget.test.mjs`, `test/control-receipts.test.mjs`.
- **Container flags, tool limits, or cleanup failure behavior**: inspect `local/sandbox.mjs`, `local/tools.mjs`, `local/file-safety.mjs`, `local/windows-acl.mjs`, and `container/runner.mjs`; verify with `test/sandbox-recovery.test.mjs`, `test/file-hardening.test.mjs`, `test/unicode-policy.test.mjs` (plus `AGENTDOCK_DOCKER_TEST=1` for `test/sandbox.test.mjs`).

> Editing source files does not update an already-installed `%USERPROFILE%\.agentdock-bridge\runtime-*` host copy or pinned Docker image; rebuild and re-run `Install-Hardened.ps1` / `wrangler deploy` explicitly. Non-runtime paths (`docs-site/`, `tools/repo_maintenance_guard.py`, `wrangler.jsonc.example`) are outside the request execution path.
