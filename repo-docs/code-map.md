# 代码地图

先沿[一次真实操作的阶段交接](walkthroughs/one-real-run.md)建立端到端概念，再按本页的目录与职责定位具体实现、测试及运维脚本。关键机制的原理说明拆分在三篇模块文档中，本页只提供目录对照与修改入口。

| 路径 | 职责 | 关键代码 | 与主流程的关系 |
| --- | --- | --- | --- |
| `cloud/` | 云端 OAuth 2.1、中继与活性判定 | `index.mjs`、`relay.mjs`、`auth-store.mjs` | 承载公网接入、代次授权与 WebSocket 信封派发，详见[云端网关与中继模块](modules/cloud-oauth-and-relay.md) |
| `local/` | 连接器、本机批准、防重放与沙箱文件策略 | `connector.mjs`、`approvals.mjs`、`sandbox.mjs`、`file-safety.mjs` | 把关二审、一次批准、账本登记和容器策略，详见[本地批准与防重放模块](modules/local-approval-and-replay.md)及[容器沙箱与文件策略模块](modules/container-sandbox-and-file-policy.md) |
| `container/` | 容器镜像与内部命令/文件执行入口 | `runner.mjs`、`file-worker.mjs`、`Dockerfile` | 以 UID/GID 1000 隔离执行命令或禁用命令的文件工具 |
| `scripts/` | Windows 受保护安装、DPAPI 凭据、审批与公网验收 | `Install-Hardened.ps1`、`Secrets.ps1`、`Manage.ps1`、`acceptance-v2.mjs` | 管理私有状态目录、固定 Node 校验、轮换和显式验收 |
| `test/` | 本地批准、文件安全、ACL、管理与沙箱故障回归 | `connector.test.mjs`、`sandbox-recovery.test.mjs`、`file-hardening.test.mjs` | 覆盖连接器、预算、Unicode、ACL 与清理故障逻辑 |

## `cloud/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [云端入口](../cloud/index.mjs) | 路由 OAuth、`/mcp`、`/bridge` 与 `/healthz`，实现所有者密码登录 | `AuthCoordinator` / `route` / `authorize` | Worker 请求；[云端集成测试](../cloud/integration.test.mjs) |
| [中继对象](../cloud/relay.mjs) | 独占单连接器 WebSocket、派发信封、隔离停止通道并执行限流 | `BridgeRelay` | 云端入口；[传输与重连测试](../cloud/transport.test.mjs) |
| [状态存储与事务](../cloud/auth-store.mjs) | 以 SQLite 保存 OAuth 状态、跟踪刷新令牌家族并协调并发通道 | `AuthStore` / `AuthTransactions` / `AuthQueue` | 云端入口与 `auth-transactions.mjs`、`auth-queue.mjs`；[事务并发测试](../cloud/auth-transactions.test.mjs) |
| [协议校验与活性](../cloud/security.mjs) | 校验 RPC 上限、CORS 来源、CSP 头、密码哈希与心跳窗口 | `validateRpc` / `verifyOwnerPassword` / `connectionLiveness` | 云端入口与 `liveness.mjs`；[安全边界测试](../cloud/security.test.mjs) |

## `local/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [连接器主流程](../local/connector.mjs) | 探测代理、建立 WSS、调用 DPAPI 导出密钥并串行驱动批准/账本/运行器 | `BridgeConnector` / `loadSecrets` / `proxyCandidates` | `Manage.ps1`；[连接器测试](../test/connector.test.mjs)与[密钥子进程测试](../test/secret-process.test.mjs) |
| [请求策略](../local/request-policy.mjs) | 信封过期与深度预算校验、10 工具白名单及参数规范化摘要 | `validateRequestEnvelope` / `approvalSubject` / `APPROVAL_EXEMPT_TOOLS` | 连接器与批准模块；[连接器测试](../test/connector.test.mjs) |
| [批准与预算存储](../local/approvals.mjs) | 管理 5 分钟待批队列、按紧凑 UTF-8 字节上限原子发布并清理孤儿临时文件 | `LocalApprovals` / `atomicJson` / `validRequest` | 连接器与 `approval-store.mjs`；[批准预算测试](../test/approval-budget.test.mjs) |
| [本机批准 CLI](../local/approval-cli.mjs) | 控制字符与 bidi 字符转义展示参数，校验口令并写入一次性批准标记 | `safeText` / `approveRequest` | 受保护的 `Approve.ps1`；[连接器测试](../test/connector.test.mjs) |
| [三类防重放账本](../local/receipts.mjs) | 提供 24 小时持久请求账本与控制/停止内存防重放限额 | `RequestReceipts` / `TransientReceipts` / `StopReceipts` | 连接器；[控制账本测试](../test/control-receipts.test.mjs) |
| [沙箱运行接线](../local/sandbox.mjs) | 管理单工作区隔离容器参数、租约心跳、归属检查与清理故障关闭状态 | `createSandboxRuntime` | 连接器；[故障恢复测试](../test/sandbox-recovery.test.mjs)与[真实 Docker 回归](../test/sandbox.test.mjs) |
| [工具协议与文件策略](../local/tools.mjs) | 定义 7 项文件工具和 3 项命令工具，结合逐级 `lstat`、版本检查和原子替换 | `TOOL_DEFINITIONS` / `createToolRuntime` / `createFilePolicy` | 容器文件入口与 `file-safety.mjs`；[工具回归](../test/tools.test.mjs)与[文件加固测试](../test/file-hardening.test.mjs) |
| [Windows 替换与 Docker 查询](../local/windows-acl.mjs) | 拒绝覆盖含自定义显式 NTFS ACL 的文件，仅对只读初始探针提供单次超时重试 | `createWindowsReplacementGuard` / `queryDockerState` | 沙箱与 `docker-query.mjs`；[ACL 测试](../test/windows-acl.test.mjs)与[查询测试](../test/docker-query.test.mjs) |

## `container/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [容器监督与文件入口](../container/runner.mjs) | 监控 20 秒宿主租约、降权为 UID/GID 1000 启动 Bash 或只禁用命令的文件工作器 | `runner.mjs` / `readJsonInput` | `local/sandbox.mjs` 与 `container/file-worker.mjs`；[容器输入测试](../test/container-input.test.mjs) |
| [容器构建清单](../container/Dockerfile) | 固定 `node:24-trixie-slim` 摘要与开发工具链并设置只读 `/opt/bridge` | `ENTRYPOINT` | 维护者构建本地开发镜像前导输入 |

## `scripts/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [初始化与受保护安装](../scripts/Install-Hardened.ps1) | 初始化配置与凭据、校验并安装私有固定 Node，生成受保护副本与 `.cmd` 入口 | `Setup.ps1` / `Install-NodeRuntime.ps1` / `Install-Hardened.ps1` | 维护者显式安装；[管理安全测试](../test/management-safety.test.mjs) |
| [状态守护与进程管理](../scripts/Manage.ps1) | 检查完整祖先路径与所有者 ACL、生成防 PID 复用的托管进程并响应停机标记 | `Assert-PrivateState` / `Assert-PinnedNode` / `OwnedProcess` | 根目录与状态目录下的 `.cmd` 入口、`State-Safety.ps1`、`Approve.ps1` |
| [凭据加密与轮换](../scripts/Secrets.ps1) | 通过 Windows DPAPI 生成、导出、弹窗展示、上传与双步安全轮换本地与云端密钥 | `Secrets.ps1` / `Rotate-Secrets.ps1` | 连接器启动、`ShowPassword.cmd` 与运维轮换；[凭据子进程测试](../test/secret-process.test.mjs) |
| [公网与生命周期验收](../scripts/acceptance-v2.mjs) | 验证 OAuth/容器/刷新/停止重启及录制部署元数据（仅显式命令行执行） | `acceptance-v2.mjs` / `verify-lifecycle.mjs` | 维护者发布与变更核验，历史结果见[修复与验证快照](../SECURITY-FIXES.md) |

## `test/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [核心安全与策略回归](../test/connector.test.mjs) | 覆盖批准/账本顺序、记录字节上限、异常 Unicode、符号链接、Windows ACL 与凭据子进程隔离 | `connector.test.mjs` / `approval-budget.test.mjs` / `unicode-policy.test.mjs` | `pnpm test` 主体套件（ACL 与管理测试按平台自适应运行或跳过） |
| [沙箱与控制面回归](../test/sandbox-recovery.test.mjs) | 覆盖清理失败退守与归属保留、控制/停止账本互不干扰、Docker 查询与管理路径安全 | `sandbox-recovery.test.mjs` / `control-receipts.test.mjs` / `management-safety.test.mjs` | `pnpm test` 及显式开启 `AGENTDOCK_DOCKER_TEST` 后的 `sandbox.test.mjs` |

## 修改入口与验证

涉及客户端认证、CORS、OAuth 作用域或刷新家族时，先查看[云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md)与 `cloud/*.test.mjs`；修改批准字段、摘要结构或防重放语义时，需同步核对 `local/request-policy.mjs`、`LocalApprovals` 与 `RequestReceipts` 的顺序不变量。变动容器挂载参数、文件策略或清理故障逻辑前，先对照[容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md)确认属主控制与工作区边界不会被绕过。

改动本地源码并不会自动更新已安装运行副本或已固定 Docker 镜像。核心专有名词与状态码释义集中在[术语表](glossary.md)。

## 覆盖范围

上述导航覆盖生产运行时、构建定义与配套测试，未将非运行时辅助目录纳入主链：独立文档站与本地开发配置位于根目录 `docs-site/`（含静态结构图）与 `wrangler.jsonc.example`；维护安全钩子脚本位于 `tools/repo_maintenance_guard.py`；本地审计报告与运行时凭据、快照材料留在被忽略的私有或本机目录中，不随代码或文档站发布。过往版本的公网验收与镜像核对结果请参照[修复与验证快照](../SECURITY-FIXES.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
