---
title: 快速入门
description: AgentDock Bridge 是一套专为 Model Context Protocol (MCP) 设计的**跨云端与本地受控连接器与安全隔离沙箱**。
---

# 快速入门

AgentDock Bridge 是一套专为 Model Context Protocol (MCP) 设计的**跨云端与本地受控连接器与安全隔离沙箱**。

## 解决的核心痛点

- **痛点 1**：大模型直接拥有宿主机命令执行或文件读写权限容易导致灾难性误操作
- **痛点 2**：传统 MCP 缺少细粒度的本地人工复核与二次确认防线
- **痛点 3**：敏感运维任务无法在物理隔离的短暂容器沙箱中安全执行并自动回收

---

## 环境准备

Node.js 20+，Docker 或兼容的容器运行时（用于安全执行隔离容器任务）。

---

## 快速安装与运行

```bash
# 1. 安装依赖
pnpm install

# 2. 本地连通性与配置检查
pnpm test

# 3. 接入 MCP 客户端（如 claude_desktop_config.json 或 mcp_config.json）
{
  "mcpServers": {
    "agentdock-bridge": {
      "command": "node",
      "args": ["C:/path/to/agentdock-worker-remote/dist/index.js"],
      "env": {
        "AGENTDOCK_GATEWAY_URL": "https://gateway.example.com",
        "AGENTDOCK_TOKEN": "your-hmac-secret-token"
      }
    }
  }
}
```

---

## 接下来探索

- 深入了解系统内部流转：查阅 [系统架构与设计](/docs/architecture)
- 探索全部配置参数与高级场景：查阅 [配置与使用指南](/docs/configuration)
- 遇到问题排错：查阅 [常见问题与排错](/docs/faq)
