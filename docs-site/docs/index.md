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

- Windows x64、Windows PowerShell 和 .NET Framework，用于本机凭证和权限检查。
- Node.js 24+、pnpm 12.6.0；Docker Desktop 使用 Linux 容器引擎。
- 自己的 Cloudflare 账户和 HTTPS 域名，以及明确允许容器读写的工程目录。

---

## 快速安装与运行

先在可信检出目录中安装依赖并验证源码：

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

随后按[部署与安装说明](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.md#首次配置与安装)完成本机配置、Worker 部署、镜像构建和受保护运行副本安装。源码检查通过不代表连接器已经安装或公网可用；启动后通过私有目录的 `Status.cmd` 和自己的 `/healthz` 地址检查状态。

在支持远端 MCP 与 OAuth 的客户端中添加 `PUBLIC_ORIGIN` 下的 `/mcp` 地址。下面是需要换成自己域名的示例：

```text
https://bridge.example.test/mcp
```

授权时核对客户端回调和申请权限，再使用 `%USERPROFILE%\.agentdock-bridge\Password.cmd` 显示的密码完成网关授权。电脑、连接器和 Docker 都需保持在线。

首次读取文件或执行命令返回 `LOCAL_APPROVAL_REQUIRED` 时，在本机运行私有安装目录中的 `Approve.cmd`，核对完整参数并输入提示的批准指令，再让客户端以相同参数重试。批准在 5 分钟内有效且只能使用一次，详见[日常使用](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.md#日常使用)。

---

## 接下来探索

- 深入了解系统内部流转：查阅 [系统架构与设计](/docs/architecture)
- 探索全部配置参数与高级场景：查阅 [配置与使用指南](/docs/configuration)
- 遇到问题排错：查阅 [常见问题与排错](/docs/faq)
