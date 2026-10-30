# 代码地图

先读[一次真实操作的阶段交接](walkthroughs/one-real-run.md)，再按这里的职责定位。覆盖范围为 一个敏感 MCP 工具请求从本机待批准到一次执行；这不是全仓库架构清单。

| 路径 | 职责 | 关键代码 | 与主流程的关系 |
| --- | --- | --- | --- |
| `cloud/` | 云端认证、请求中继和活性 | [中继](../cloud/relay.mjs)、`index.mjs`、`auth-store.mjs`、`auth-transactions.mjs` | 主流程仅追踪认证后的信封交接，其余 OAuth 事务未展开 |
| `local/` | 宿主连接、批准和去重 | [连接器](../local/connector.mjs)、[策略](../local/request-policy.mjs)、[批准](../local/approvals.mjs)、[账本](../local/receipts.mjs) | 请求先校验，再消费精确批准并登记 |
| `local/` 中的运行支持 | Docker 接线及文件策略 | [沙箱](../local/sandbox.mjs)、`docker-query.mjs`、`tools.mjs`、`file-safety.mjs`、`windows-acl.mjs` | 约束执行环境与文件操作 |
| `container/` | 容器内文件与命令运行 | [命令执行](../container/runner.mjs)、[文件执行](../container/file-worker.mjs)、`Dockerfile` | 接收本机 broker 已获准的任务 |
| `test/` 与 `cloud/*.test.mjs` | 当前回归 | [连接器测试](../test/connector.test.mjs)、`sandbox.test.mjs` | 对照批准边界，Docker 测试另需环境 |
| `scripts/` | 受信安装与本机管理支持 | [安装入口](../scripts/Install-Hardened.ps1)、`Approve.ps1`、`State-Safety.ps1` | 仅作安装/批准来源索引，实际运维结果另行验收 |

## `cloud/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| `relay.mjs` | 把授权信封交给本地连接并等待响应 | 授权信封与 request deadline | Worker 认证入口；cloud 传输回归 |
| `auth-store.mjs` / `auth-transactions.mjs` | 认证状态和事务，主指南未展开 | 本页不逐函数声明 OAuth 行为 | cloud 入口；独立事务回归 |

## `local/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| `request-policy.mjs` | 验证信封并构造精确批准对象 | `validateRequestEnvelope` / `approvalSubject` | 连接器与本地批准 |
| `approvals.mjs` / `approval-store.mjs` | 保存和消费有时效批准；发布前核对最终记录大小 | `LocalApprovals.authorize` / `validRequest` / `atomicJson` | 连接器；connector.test.mjs、approval-budget.test.mjs |
| `connector.mjs` / `receipts.mjs` | 批准后登记请求，再转运行器 | `BridgeConnector` / `receipts.claim` | 云端 WebSocket 信封 |
| `connector.mjs` 的宿主子进程支持 | 固定 PowerShell 路径、工作目录和最小环境；凭证加载失败不透传子进程输出 | `windowsPowerShell` / `loadSecrets` | 凭证加载与代理查询；secret-process.test.mjs |
| `sandbox.mjs` / `tools.mjs` | 隔离 broker 与文件工具协议 | `createToolRuntime` / `TOOL_DEFINITIONS` | 容器运行器及测试 |
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

## 修改入口与验证

请求身份与权限改变先改 `local/request-policy.mjs` 并核对 `cloud/relay.mjs`。批准字段改变必须一起核对 `approvalSubject`、`LocalApprovals.authorize`、本机批准 CLI 和连接器回归。执行或取消改变从 `local/sandbox.mjs` 进入，再检查容器两种运行器。

运行副本、镜像及受保护状态不从工程改动自动更新。`scripts/` 的安装和轮换是独立运维流程；历史 `audit/` 不能代替当前回归。

## 覆盖范围

不逐项覆盖 OAuth 所有事务、Windows 安装/凭据轮换、全部文件 ACL 分支和容器生命周期；没有重新验收线上网关、Docker 镜像或已安装副本。

源码链接指向仓库文件。独立文档站不携带这些文件；可按表中的精确路径在克隆中查找。需要确认哪些代码已经逐段核对，查看[证据覆盖记录](references/source-evidence.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
