---
title: Configuration Guide
description: Wrangler configuration, secrets management, and routing rules for AgentDock Bridge.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/configuration) as the authoritative reference.
:::

# Configuration Guide

### Primary Configuration

```json
{
  "name": "agentdock-bridge",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "vars": {
    "ALLOWED_ORIGINS": "https://dashboard.example.com",
    "HEARTBEAT_INTERVAL_SEC": 30
  }
}
```

---

## Production Recommendations

1. **Environment Variable Protection**: Never commit real API keys or sensitive credentials into Git repositories.
2. **Graceful Shutdown & Timeouts**: Set appropriate timeout constraints on long-running processes to prevent orphan executions.
3. **Continuous Monitoring**: Combine console logs and health telemetry to monitor service uptime and operational status.
