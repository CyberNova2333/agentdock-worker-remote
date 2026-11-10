---
title: Configuration Guide
description: Wrangler configuration, secrets management, and routing rules for AgentDock Bridge.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/configuration) as the authoritative reference.
:::

# Configuration Guide

### Primary Configuration

Cloud deployment configuration and local runtime configuration are managed separately. Start with the [installation instructions](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.en.md#first-configuration-and-installation) and the repository's `wrangler.jsonc.example`:

| Location | Field | Purpose and management |
| :--- | :--- | :--- |
| Local deployment file `wrangler.jsonc` | `vars.PUBLIC_ORIGIN` | Your HTTPS gateway origin; clients connect to `/mcp` under it. The Worker entrypoint is `cloud/index.mjs` |
| Private installation's `config.json` | `origin` | The connector's gateway address, initialized by `Setup.ps1 -Origin`; keep it consistent with `PUBLIC_ORIGIN` |
| Private installation's `config.json` | `roots`, `defaultCwd` | The workspace containers may read and write; the installer pins one directory through `-Workspace` |
| Private installation's `config.json` | `sandbox.image` | The installer verifies `-Image` and pins its SHA-256. Changing a tag does not update the running image |
| Local DPAPI storage and Worker secrets | Connection credentials | Create, upload or rotate credentials through the deployment scripts; clients connect through OAuth authorization |

The installer also pins the host Node path and digest and the Docker context, then creates trusted launchers in `%USERPROFILE%\.agentdock-bridge`. Follow the [update procedure](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.en.md#development-and-updates), preserving protected directories and permission checks.

File operations and commands require approval of the exact request through `Approve.cmd`. Commands have no network by default; outbound networking is also an approval parameter. See [Daily use](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.en.md#daily-use) for permissions and execution boundaries.

---

## Production Recommendations

1. **Environment Variable Protection**: Never commit real API keys or sensitive credentials into Git repositories.
2. **Graceful Shutdown & Timeouts**: Set appropriate timeout constraints on long-running processes to prevent orphan executions.
3. **Runtime Status**: Check the trusted `Status.cmd` and your own `/healthz` endpoint. Remove credentials, private file contents and sensitive command output before sharing diagnostics.
