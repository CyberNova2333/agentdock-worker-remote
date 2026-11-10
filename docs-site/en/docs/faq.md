---
title: FAQ & Troubleshooting
description: Frequently asked questions and troubleshooting steps for AgentDock Bridge.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/faq) as the authoritative reference.
:::

# FAQ & Troubleshooting

Common questions and answers regarding daily usage and integration:

### Q: What transport protocols are supported?

**A**: MCP clients connect to the Worker's HTTPS `/mcp` endpoint. The protected Windows connector opens an outbound WebSocket connection to relay tool requests and results. The cloud relay can see those inputs and outputs and is part of the trust boundary.

### Q: How does authentication work?

**A**: Clients use OAuth authorization with PKCE. Review the client callback and requested permissions, then authorize with the password shown by the private installation's `Password.cmd`. File operations and commands also require approval of the exact request through the trusted `Approve.cmd`; client authorization alone does not approve execution.

### Q: Are files removed when a container exits?

**A**: Files written to the mounted workspace remain. Temporary HOME and temporary directories disappear when the container is removed. If a result reports `cleanup_confirmed: false`, inspect Docker on the host. The connector rejects new commands and file operations while cleanup is unconfirmed, while existing tasks can still be queried or stopped.


---

## General Troubleshooting Steps

1. **Verify Runtime Versions**: Ensure Node.js, Python, Rust, or browser versions meet minimum compatibility requirements.
2. **Check Diagnostic Logs**: Review console output and error logs for informative stack traces and line numbers.
3. **Submit Issue Feedback**: If you discover an underlying bug, please open an issue on the GitHub repository with a reproducible test case.
