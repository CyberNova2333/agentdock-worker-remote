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

Node.js 20+, pnpm 12.6.0, Cloudflare Wrangler CLI.

---

## Quick Installation & Launch

```bash
# 1. Install project dependencies
pnpm install

# 2. Run local tests and verification
pnpm test
```

---

## Next Steps

- Explore internal mechanics: [Architecture & Design](/en/docs/architecture)
- Comprehensive configuration reference: [Configuration Guide](/en/docs/configuration)
- Troubleshooting & FAQ: [FAQ & Diagnostics](/en/docs/faq)
