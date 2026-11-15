# 阅读质量审计

这是 2026-11-15 升级到 Standard 指南后的阅读质量复核，检验读者能否从零理解端到端交接链路、定位三大核心子系统边界，并严格区分当前 Linux 环境实测与 Windows/公网历史快照。

## 读者模拟

| 检查问题 | 从指南得到的答案 |
| --- | --- |
| 主路径是什么 | 远端 MCP 请求经过云端 OAuth 与中继、Windows 连接器二审与人工精确批准、防重放记账，最终进入 Linux 容器执行并返回受限结果 |
| 难点是什么 | 云端有效令牌不等于可执行权；参数批准摘要、一次性消费、持久防重放和容器清理失败退守必须跨进程严密衔接 |
| 阶段如何衔接 | `AuthCoordinator` 验权与装信封 → `BridgeRelay` WSS 转发 → `BridgeConnector` 预查与待批入队 → `Approve.cmd` 人工放行 → 先删批准后写 `RequestReceipts` → `createSandboxRuntime` 容器执行 |
| 失败和边界在哪里 | 云端仍是可信中继；宿主本地密钥强依赖 Windows DPAPI 与 ACL；工作区项目刻意对容器可读写，工程内秘密仍可被已批准操作读取；超时不能推定无副作用 |
| 清理失败后还能做什么 | `closed` 置位后拒绝一切新文件或命令请求，但属主客户端仍可查询和停止自己的在途任务；`cleanup_confirmed: false` 不会伪装成功 |
| 如何验证理解 | 运行 `pnpm run check` 与 `pnpm test`（Linux 下 86 通过 / 15 项 Windows/Docker 专属测试跳过），真实全量还须参照 Windows 与 Docker 环境条件 |
| 从哪里改 | [代码地图](../code-map.md)按 `cloud/`、`local/`、`container/`、`scripts/`、`test/` 列出全部文件、关键符号与对应回归测试 |
| 如何知道某版本已部署 | 核对[修复与验证快照](../../SECURITY-FIXES.md)中记录的提交锚点、镜像摘要与公网验收记录，文档构建成功不代表线上服务已更新 |

## 可证伪性与后续问题

证伪检查：若任一已修改参数仍命中旧 `.approved.json`、若连接器在写 `RequestReceipts` 之前执行 `runtime.handleRpc`、或若 `BridgeRelay` 允许同客户端旧代次在密码变更后继续访问 `/mcp`，则文档对应结论立即失效，应先对照 `test/connector.test.mjs`、`cloud/oauth-hardening.test.mjs` 与 `test/sandbox-recovery.test.mjs` 复查源码。

读者下一问：为何云端 `cloud/index.mjs` 枚举了 `agentdock_context` 和 `get_command`，而本地工具定义只有 10 项？指南在云端模块和代码地图明确标注了这一遗留兼容点：本地 `local/request-policy.mjs` 的 `toolScopes` 只对 10 项工具生效，云端白名单放行不会越过本地收敛边界。

## 剩余风险

- 生产宿主侧安装器（`scripts/*.ps1`）当前强耦合 Windows PowerShell 5.1、DPAPI 与 Docker Desktop `desktop-linux` 上下文；本轮在 Linux 环境校验了 `cloud/` 与纯 JS 逻辑，15 项依赖 `win32` 或开启 `AGENTDOCK_DOCKER_TEST` 的用例按预期跳过，未在本轮重新跑 Windows 实机验收。
- 文档站同时引入 `repo-docs/` 页面并在独立专题页补充配置矩阵与演进决策，后续若调整工具上限、OAuth 作用域或端口策略，须同步更新[指南变更记录](../change-log.md)并复跑 `validate_repo_docs.py` 与 `docs:build`。

证据状态：除特别标注外，本页基于当前源码已确认。
