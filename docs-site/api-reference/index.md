---
layout: page
sidebar: false
title: API 与组件参考
description: AgentDock Bridge Cloudflare Worker OAuth 2.1 + PKCE 网关端点、WSS 设备桥、Approve.cmd 与 10 个只读/读写 MCP 工作区工具交互式参考。
---

<script setup lang="ts">
import { apiSpecZh } from '../.vitepress/data/api-spec'
</script>

<ApiExplorer :spec="apiSpecZh">

### 服务体检与连接器长连接桥 (`GET /healthz` / `WSS /bridge`) {#edge-health-bridge}

检查连接器 65 秒心跳在线态，并以至少 32 字符 `BRIDGE_TOKEN` 维持单一反向长连接。

### OAuth 2.1 + PKCE 授权与令牌轮换 (`/register` / `/authorize` / `/oauth/token`) {#edge-oauth21}

基于 `AuthCoordinator` DO 的单人属主鉴权、零脚本同意书、`S256` 校验与刷新令牌家族防重放。

### 远程 MCP JSON-RPC 网关入口 (`POST /mcp`) {#edge-mcp-endpoint}

校验 `MCP-Protocol-Version` 与代次令牌，在 `110s` 内经 `BridgeRelay` 与 `Approve.cmd` 调度执行。

### 工作区只读与检索 MCP 工具 (`computer_context` / `list_directory` / `read_file` / `search_files`) {#mcp-read-tools}

提供工作区上下文、不跟随符号链接的目录遍历、UTF-8 分块读写校验与带时间/条数熔断的全文检索。

### CAS 文件写入与受限容器命令 (`write_file` / `edit_file` / `exec_command` / `stop_command`) {#mcp-write-exec-tools}

强制 `Approve.cmd` 逐参数确认、CAS `expected_sha256` 与 `--read-only` / `--network none` 一次性容器执行。

</ApiExplorer>
