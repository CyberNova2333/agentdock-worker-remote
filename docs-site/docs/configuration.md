---
title: 配置与使用指南
description: AgentDock Bridge 的参数配置详解、典型使用场景与最佳实践
---

# 配置与使用指南

### 核心配置项

云端配置与本机运行配置分别管理。首次安装从[部署说明](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.md#首次配置与安装)和仓库的 `wrangler.jsonc.example` 开始：

| 配置位置 | 字段 | 用途与管理入口 |
| :--- | :--- | :--- |
| 本机部署用 `wrangler.jsonc` | `vars.PUBLIC_ORIGIN` | 自己的 HTTPS 网关地址；客户端接入其下的 `/mcp`，Worker 入口为 `cloud/index.mjs` |
| 私有安装目录的 `config.json` | `origin` | 本机连接器使用的网关地址，由 `Setup.ps1 -Origin` 初始化，与 `PUBLIC_ORIGIN` 保持一致 |
| 私有安装目录的 `config.json` | `roots`、`defaultCwd` | 明确允许容器读写的工程目录；安装器通过 `-Workspace` 固定一个目录 |
| 私有安装目录的 `config.json` | `sandbox.image` | 安装器通过 `-Image` 核验并固定镜像 SHA-256，更新标签不会自动替换运行镜像 |
| 本机 DPAPI 加密存储与 Worker secrets | 连接凭证 | 使用部署和凭证管理脚本创建、上传或轮换；客户端通过 OAuth 授权接入 |

安装器还固定宿主 Node 路径、摘要和 Docker context，并生成 `%USERPROFILE%\.agentdock-bridge` 中的可信管理入口。更新按[开发和更新流程](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.md#开发和更新)执行，保留受保护目录及其权限检查。

文件操作和命令执行需要 `Approve.cmd` 对精确请求批准；命令默认无网络，出站联网也属于批准参数。权限与执行边界见[日常使用](https://github.com/CyberNova2333/agentdock-worker-remote/blob/main/README.md#日常使用)。

---

## 生产部署建议

1. **环境变量保护**：切勿将包含真实密钥或 Token 的配置提交至版本库；
2. **优雅停机与超时**：建议将关键长任务的超时时限设置为合理范围，避免僵尸进程驻留；
3. **运行状态**：通过可信 `Status.cmd` 和自己的 `/healthz` 检查连接状态；提交诊断信息前去除凭证、文件内容和命令输出中的敏感数据。
