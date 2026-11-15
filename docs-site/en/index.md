---
layout: home

hero:
  name: AgentDock Bridge
  text: Personal Remote MCP Bridge
  tagline: Authenticates remote MCP clients via Cloudflare Workers OAuth 2.1 + PKCE, requires exact manual approval on a hardened Windows host, and executes workspace tools in a read-only Linux Docker container.
  actions:
    - theme: brand
      text: 1. Getting Started
      link: /en/docs/
    - theme: alt
      text: 2. Contracts & Boundaries
      link: /en/docs/contracts
    - theme: alt
      text: 3. Internals & Code Map
      link: /en/docs/architecture
    - theme: alt
      text: GitHub Repo
      link: https://github.com/CyberNova2333/agentdock-worker-remote

features:
  - title: Edge OAuth 2.1 & Password Generations
    details: Splits AuthCoordinator and BridgeRelay across two SQLite Durable Objects with mandatory PKCE S256, zero-script CSP consent HTML, and generation rotation on password change.
  - title: Exact Local Approval & Replay Ledger
    details: Sensitive tools bind origin, client identity, scopes, and full arguments into a canonical SHA-256 digest for Approve.cmd, consuming the grant before claiming a 24h durable receipt.
  - title: Disposable Linux Sandbox & ACL Guard
    details: Runs with --read-only, --cap-drop ALL (SETUID/SETGID only), UID/GID 1000, and --network none by default while blocking symlink escapes, lone surrogates, and NTFS DACL loss.
---

::: warning AI Translation Notice
English documentation pages are translated/synchronized from the authoritative Chinese source ([简体中文首页](/)) using inspected repository facts. Refer to the Chinese pages or source files if any subtle phrasing differs.
:::

## Quick Jump by Role & Goal

| Role / Goal | Start Here | What You Get |
| --- | --- | --- |
| Self-hosting for the first time | [Overview & Setup](/en/docs/) · [Configuration Matrix](/en/docs/configuration) | End-to-end Worker deploy, DPAPI secret setup, pinned Node/Docker install, and key rotation |
| Diagnosing 503, approval, or ACL errors | [Deployment & Runtime FAQ](/en/docs/faq) | Actionable root causes for `/healthz`, `LOCAL_APPROVAL_REQUIRED`, ACL checks, and cleanup lockouts |
| Integrating MCP clients or auditing security | [OAuth, Tools & Sandbox Contracts](/en/docs/contracts) | Exact HTTP/OAuth limits, 4 scopes, 10 tool schemas, replay ordering, and Docker flags |
| Tracing internals or changing code | [Architecture & ADRs](/en/docs/architecture) · [Walkthrough](/en/docs/walkthrough) · [Code Map](/en/docs/code-map) | Interactive diagram, security ADRs, 5-step request walkthrough, and source/test file map |

## Architecture Overview

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span>📐</span> AgentDock Bridge Topology (pan / zoom / inspect supported)
    </span>
    <a href="/diagrams/worker-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      Open Fullscreen ↗
    </a>
  </div>
  <iframe src="/diagrams/worker-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

> **Implementation Note**: The diagram visualizes the four high-level zones from client gateway to sandbox. In actual source code, client RPC uses HTTP `POST /mcp` (JSON-RPC 2.0 rather than SSE log streams), `OAuth 2.1 + PKCE (S256)`, outbound connector WebSocket `WSS /bridge`, and per-invocation `docker start --attach` after `Approve.cmd`.

## Verification & Client Endpoint Quick Check

Run static syntax checks and cross-platform tests with Node.js 24+ and `pnpm@12.6.0` (15 Windows/Docker-specific tests skip automatically on non-Windows/no-Docker hosts):

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

Configure compatible remote MCP clients with your deployed `PUBLIC_ORIGIN` endpoint:

```text
https://<your-bridge-domain>/mcp
```

Authorize OAuth consent using the password shown by `%USERPROFILE%\.agentdock-bridge\Password.cmd`, and confirm pending file/command invocations via `Approve.cmd` in the same protected directory. Proceed to [Getting Started & Deployment](/en/docs/).
