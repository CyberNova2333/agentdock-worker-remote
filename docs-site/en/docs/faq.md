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

**A**: AgentDock Bridge supports bidirectional WebSocket streams as well as standard HTTP/2 chunked and streaming endpoints.

### Q: How does authentication work?

**A**: Requests must provide an Ed25519-signed authorization token or pre-shared bearer key verified at the edge before dispatch.


---

## General Troubleshooting Steps

1. **Verify Runtime Versions**: Ensure Node.js, Python, Rust, or browser versions meet minimum compatibility requirements.
2. **Check Diagnostic Logs**: Review console output and error logs for informative stack traces and line numbers.
3. **Submit Issue Feedback**: If you discover an underlying bug, please open an issue on the GitHub repository with a reproducible test case.
