# 代码地图

先读[一次真实操作的阶段交接](walkthroughs/one-real-run.md)，再按这里的职责定位。本页围绕一个敏感 MCP 工具请求从本机待批准到一次执行列出责任、关键代码和近处验证；OAuth 和运维脚本提供导航，不逐项展开其全部机制。

| 路径 | 职责 | 关键代码 | 与主流程的关系 |
| --- | --- | --- | --- |
| `cloud/` | 云端认证、请求中继和活性 | [中继](../cloud/relay.mjs)、`index.mjs`、`auth-store.mjs`、`auth-transactions.mjs` | 主流程仅追踪认证后的信封交接，其余 OAuth 事务未展开 |
| `local/` | 宿主连接、批准和去重 | [连接器](../local/connector.mjs)、[策略](../local/request-policy.mjs)、[批准](../local/approvals.mjs)、[账本](../local/receipts.mjs) | 请求先校验，再消费精确批准并登记 |
| `local/` 中的运行支持 | Docker 接线及文件策略 | [沙箱](../local/sandbox.mjs)、`docker-query.mjs`、`tools.mjs`、`file-safety.mjs`、`windows-acl.mjs` | 约束执行环境与文件操作 |
| `container/` | 容器内文件与命令运行 | [命令执行](../container/runner.mjs)、[文件执行](../container/file-worker.mjs)、`Dockerfile` | 接收本机 broker 已获准的任务 |
| `test/` 与 `cloud/*.test.mjs` | 主机、容器与云端回归 | [连接器测试](../test/connector.test.mjs)、[故障恢复测试](../test/sandbox-recovery.test.mjs)、`sandbox.test.mjs` | 局部测试验证对应边界，真实 Docker 测试另需环境 |
| `scripts/` | 受信安装与本机管理支持 | [安装入口](../scripts/Install-Hardened.ps1)、`Approve.ps1`、`State-Safety.ps1` | 仅作安装/批准来源索引，实际运维结果另行验收 |

## `cloud/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [云端入口](../cloud/index.mjs) | 路由 OAuth、MCP、连接器接入与健康检查 | `AuthCoordinator` / `route` | Worker 请求；[集成回归](../cloud/integration.test.mjs) |
| [中继](../cloud/relay.mjs) | 把授权信封交给本地连接，关联响应与取消 | `BridgeRelay` | Worker 认证入口；[传输回归](../cloud/transport.test.mjs) |
| `auth-store.mjs` / `auth-transactions.mjs` / `auth-queue.mjs` | 保存授权状态，组织提交与队列 | `AuthStore` / `AuthTransactions` / `AuthQueue` | 云端入口；[事务回归](../cloud/auth-transactions.test.mjs)及同目录 store/queue 测试 |
| [协议与安全检查](../cloud/security.mjs) / [活性判定](../cloud/liveness.mjs) | 限制 RPC、来源和密码验证，计算连接活性 | `validateRpc` / `verifyOwnerPassword` / `connectionLiveness` | 云端入口、中继；[安全回归](../cloud/security.test.mjs) |

## `local/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| `request-policy.mjs` | 验证信封并构造精确批准对象 | `validateRequestEnvelope` / `approvalSubject` | 连接器与本地批准 |
| `approvals.mjs` / `approval-store.mjs` | 保存和消费有时效批准；发布前核对最终记录大小 | `LocalApprovals.authorize` / `validRequest` / `atomicJson` | 连接器；connector.test.mjs、approval-budget.test.mjs |
| [本机批准界面](../local/approval-cli.mjs) | 显示经过控制字符转义的请求，并发布精确批准标记 | `safeText` / `approveRequest` | 受保护的 `Approve.ps1`；[连接器与批准回归](../test/connector.test.mjs) |
| `connector.mjs` / `receipts.mjs` | 批准后登记请求，再转运行器 | `BridgeConnector` / `receipts.claim` | 云端 WebSocket 信封 |
| `connector.mjs` 的宿主子进程支持 | 固定 PowerShell 路径、工作目录和最小环境；凭证加载失败不透传子进程输出 | `windowsPowerShell` / `loadSecrets` | 凭证加载与代理查询；secret-process.test.mjs |
| [沙箱接线](../local/sandbox.mjs) | 管理独立容器、任务归属、取消和清理状态 | `createSandboxRuntime` | 连接器；[故障恢复回归](../test/sandbox-recovery.test.mjs)、[真实 Docker 回归](../test/sandbox.test.mjs) |
| [工具协议](../local/tools.mjs) / [文件策略](../local/file-safety.mjs) | 定义工具、校验文件边界与身份、限制读写 | `TOOL_DEFINITIONS` / `createToolRuntime` / `createFilePolicy` | 容器文件入口；[文件强化回归](../test/file-hardening.test.mjs)、[工具回归](../test/tools.test.mjs) |
| [Windows 替换检查](../local/windows-acl.mjs) | 替换前只读检查文件权限和别名，拒绝可能丢失自定义 ACL 的替换 | `createWindowsReplacementGuard` | 沙箱文件操作；[Windows ACL 回归](../test/windows-acl.test.mjs) |
| `docker-query.mjs` | 仅对只读初始化查询提供较长时限和一次超时重试 | `queryDockerState` | sandbox 的 context/image/ps 检查；docker-query.test.mjs |

## `container/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| `runner.mjs` / `file-worker.mjs` | 容器内命令和文件两种执行入口 | 由 broker 选择入口，本页不展开循环 | local/sandbox.mjs；Docker 测试另需环境 |
| `Dockerfile` | 固定开发工具环境 | 镜像构建输入，不等于已部署镜像 | 受信安装与构建流程 |

## `scripts/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| `Install-Hardened.ps1` / `State-Safety.ps1` | 安装到受保护位置，复核所有者及祖先路径权限 | 安装入口 / `Assert-PrivateState` | 维护者显式运维流程；management-safety.test.mjs |
| `Approve.ps1` | 可信本机批准入口 | 批准界面和后续 CLI | 受保护 Approve.cmd；管理安全回归 |
| [管理入口](../scripts/Manage.ps1) / [固定 Node 安装](../scripts/Install-NodeRuntime.ps1) | 管理受保护进程，校验固定程序及路径 | `OwnedProcess` / `Assert-PinnedNode` | 受保护启动器；[管理安全回归](../test/management-safety.test.mjs) |
| [凭证操作](../scripts/Secrets.ps1) / [轮换入口](../scripts/Rotate-Secrets.ps1) | 管理 DPAPI 凭证与本项目的显式轮换 | `Create` / `Upload` / `Export` | 安装、轮换和连接器凭证加载；[凭证子进程回归](../test/secret-process.test.mjs) |
| [公网验收](../scripts/acceptance-v2.mjs) / [停止重启验收](../scripts/verify-lifecycle.mjs) | 验证实际接线，使用临时测试数据或明确执行服务启停 | 验收脚本入口 | 维护者显式验收；结果解释见[修复与验证快照](../SECURITY-FIXES.md) |

## 修改入口与验证

请求身份与权限改变先检查 `local/request-policy.mjs` 和 `cloud/relay.mjs`。批准字段改变必须一起核对 `approvalSubject`、`LocalApprovals.authorize`、本机批准 CLI 和连接器回归。执行或取消改变从 `local/sandbox.mjs` 进入，再检查容器两种运行器；清理故障的改动还要核对所属客户端查询和停止是否继续可用。

运行副本、镜像及受保护状态不从工程改动自动更新。`scripts/` 的安装和轮换是独立运维流程；历史 `audit/` 不能代替当前回归。

## 覆盖范围

未逐项解释 OAuth 的全部事务、Windows 安装与凭据轮换、全部文件 ACL 分支和容器生命周期。这些区域已有上表入口，深入修改时应继续追踪相应源码及测试，不能把索引当作完整安全证明。

`docs-site/` 负责独立文档站，其[站点配置](../docs-site/.vitepress/config.mts)读取本指南并使用默认 VitePress 主题；`tools/` 负责[离线维护守卫](../tools/repo_maintenance_guard.py)。它们不参与工具请求的执行路径，未纳入主流程讲解。`audit/` 和 `artifacts/` 是本机历史与验收材料，不能当作运行入口，也不随代码发布。

本轮整理文档与许可说明，不改变应用逻辑。此前源码、运行副本与云端版本核验的时间和范围见[修复与验证快照](../SECURITY-FIXES.md)，不把历史快照表述成新的实时检查。

源码链接指向仓库文件。独立文档站不携带这些文件；可按表中的精确路径在克隆中查找。需要确认哪些代码已经逐段核对，查看[证据覆盖记录](references/source-evidence.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
