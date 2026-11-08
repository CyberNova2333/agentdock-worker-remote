---
title: 配置与使用指南
description: AgentDock Bridge 的参数配置详解、典型使用场景与最佳实践
---

# 配置与使用指南

### 核心配置项

| 配置字段 | 环境变量 | 说明 |
| :--- | :--- | :--- |
| `gatewayUrl` | `AGENTDOCK_GATEWAY_URL` | Cloudflare Edge Worker 网关地址 |
| `authToken` | `AGENTDOCK_AUTH_TOKEN` | 用于 HMAC 签名的对称密钥 |
| `sandboxDriver`| `AGENTDOCK_SANDBOX` | 隔离驱动类型，可选 `docker`、`podman` 或 `mock`（仅测试） |
| `autoApprove` | `AGENTDOCK_AUTO_APPROVE`| 自动批准的低危命令正则白名单，非白名单一律弹窗审批 |
| `timeoutMs` | `AGENTDOCK_TIMEOUT` | 容器沙箱最长执行超时（毫秒），超时强制 kill 回收 |

---

## 生产部署建议

1. **环境变量保护**：切勿将包含真实密钥或 Token 的配置提交至版本库；
2. **优雅停机与超时**：建议将关键长任务的超时时限设置为合理范围，避免僵尸进程驻留；
3. **日志监控**：结合控制台输出建立定期检查机制，捕获潜在异常。
