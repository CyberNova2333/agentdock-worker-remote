---
layout: page
sidebar: false
title: API & Component Reference
description: Interactive reference for AgentDock Bridge OAuth 2.1 endpoints, WSS connector relay, local Approve.cmd confirmation, and all 10 hardened MCP tools.
---

<script setup lang="ts">
import { apiSpecEn } from '../../.vitepress/data/api-spec'
</script>

<ApiExplorer :spec="apiSpecEn">

### Health Probe & Reverse Connector Relay (`GET /healthz` / `WSS /bridge`) {#edge-health-bridge}

Reports connector liveness against a 65s heartbeat limit and maintains one active `BRIDGE_TOKEN` reverse WebSocket.

### OAuth 2.1 + PKCE Authorization & Password Generations (`/authorize` / `/oauth/token`) {#edge-oauth21}

Enforces PKCE S256, zero-script CSP consent HTML, family replay revocation, and generation-scoped owner password resets.

### Remote MCP JSON-RPC Ingress (`POST /mcp`) {#edge-mcp-endpoint}

Routes 1 MiB JSON-RPC calls over `BridgeRelay` with pre-claimed `RequestReceipts` and a 110s HTTP 504 deadline.

### Workspace Read & Search MCP Tools (`computer_context` / `list_directory` / `read_file` / `search_files`) {#mcp-read-tools}

Provides read-only context inspection, symlink-blocking listings, UTF-8 chunk reads, and bounded workspace searches.

### CAS File Writes & Hardened Container Execution (`write_file` / `edit_file` / `exec_command` / `stop_command`) {#mcp-write-exec-tools}

Enforces `Approve.cmd` digest approval, `expected_sha256` CAS checks, and disposable `--read-only` Linux containers.

</ApiExplorer>
