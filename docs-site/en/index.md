---
layout: home

hero:
  name: AgentDock Bridge Gateway
  text: Edge Sandbox Orchestration
  tagline: Remote command scheduling and multiplexed sandbox channel gateway for autonomous agent environments.
  actions:
    - theme: brand
      text: Get Started
      link: /en/docs/
    - theme: alt
      text: Interactive Architecture
      link: /en/docs/architecture
    - theme: alt
      text: GitHub Repo
      link: https://github.com/CyberNova2333/agentdock-worker-remote

features:
  - title: Edge Relay Architecture
    details: Ultra-low latency WebSocket and HTTP command routing powered by Cloudflare Workers.
  - title: Multiplexed Sandbox Tunnel
    details: Secure bidirectional stream multiplexing between host orchestrators and isolated containers.
  - title: Zero-Trust Security
    details: Strict cryptographic token verification, ephemeral sessions, and granular permission boundaries.
---

::: warning AI Translation Notice
This site and documentation have been translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/) as the authoritative source.
:::

## Architecture Overview

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📐</span> AgentDock Bridge Architecture (Archify interactive diagram; pan / zoom / inspect supported)
    </span>
    <a href="/diagrams/agentdock-worker-remote-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      Open Fullscreen ↗
    </a>
  </div>
  <iframe src="/diagrams/agentdock-worker-remote-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

## Quick Start Demo

Validate the checkout with Node.js 24+ and pnpm 12.6.0:

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

These commands verify the source. Follow the [deployment and installation instructions](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.en.md#first-configuration-and-installation) to configure the Cloudflare Worker, build the image and install the protected Windows connector.

Add an HTTPS endpoint to a client that supports remote MCP and OAuth. For example:

```text
https://bridge.example.test/mcp
```

Replace the example domain with your deployment's `PUBLIC_ORIGIN`. Review the client callback and requested permissions, then authorize with the password shown by `Password.cmd` in the private installation directory. File operations and command execution also require approval of the exact request through `Approve.cmd` in that directory. See [Quick Start](/en/docs/) for the full flow.
