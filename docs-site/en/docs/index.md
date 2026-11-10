---
title: Quick Start
description: AgentDock Bridge orchestrates remote commands and bridges secure tunnels for AI agent execution environments.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/) as the authoritative reference.
:::

# Quick Start

AgentDock Bridge orchestrates remote commands and bridges secure tunnels for AI agent execution environments.

## Core Problems Solved

- **Pain Point 1**: Complex NAT and firewall traversal when commanding isolated agent sandboxes.
- **Pain Point 2**: Risk of credential leakage over persistent insecure reverse tunnels.
- **Pain Point 3**: High connection maintenance overhead and cold-start latency across edge networks.

---

## Prerequisites

- Windows x64, Windows PowerShell and .NET Framework for host credentials and permission checks.
- Node.js 24+, pnpm 12.6.0 and Docker Desktop with its Linux container engine.
- Your own Cloudflare account, an HTTPS domain and a workspace that containers may read and write.

---

## Quick Installation & Launch

Install dependencies and verify the source from a trusted checkout:

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

Then follow the [deployment and installation instructions](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.en.md#first-configuration-and-installation) to initialize local configuration, deploy the Worker, build the image and install the protected runtime. Passing source checks does not establish that the connector is installed or publicly reachable. After starting it, check the private installation's `Status.cmd` and your own `/healthz` endpoint.

In a client that supports remote MCP and OAuth, add `/mcp` under your `PUBLIC_ORIGIN`. Replace the example domain below with your own:

```text
https://bridge.example.test/mcp
```

Review the callback and requested permissions, then authorize with the password shown by `%USERPROFILE%\.agentdock-bridge\Password.cmd`. Keep the computer, connector and Docker online.

When a file request or command returns `LOCAL_APPROVAL_REQUIRED`, run `Approve.cmd` from the private installation directory on your computer. Review all arguments, enter the displayed approval command and retry with the same arguments. Each approval expires after 5 minutes and can be used once. See [Daily use](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.en.md#daily-use).

---

## Next Steps

- Explore internal mechanics: [Architecture & Design](/en/docs/architecture)
- Comprehensive configuration reference: [Configuration Guide](/en/docs/configuration)
- Troubleshooting & FAQ: [FAQ & Diagnostics](/en/docs/faq)
