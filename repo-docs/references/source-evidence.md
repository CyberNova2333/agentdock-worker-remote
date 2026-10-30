# 源码证据审计

这是固定审计记录，记录 2026-10-29 的两遍调查及 2026-10-30 的定向同步；行为解释由主流程页承载，源码导航由代码地图承载。

## 遍历记录

| 遍历 | 实际检查 | 得到的依据 |
| --- | --- | --- |
| Pass 1 | 仓库目录、Git 状态、父级及 root AGENTS/CLAUDE、README、`package.json`、`cloud/`、`local/`、`container/` 与管理脚本清单 | 确定真实入口、运行命令及现存文档；README 只作线索 |
| Pass 2 | `local/request-policy.mjs`、`approvals.mjs`、`approval-store.mjs`、`connector.mjs` 的批准交接，以及 `test/connector.test.mjs` 的首次/变参/去重断言 | 追踪主路径的输入、输出与失败分支，并对照测试断言 |

## 覆盖与排除

覆盖：一个敏感 MCP 工具请求从本机待批准到一次执行。不逐项覆盖 OAuth 所有事务、Windows 安装/凭据轮换、全部文件 ACL 分支和容器生命周期；没有重新验收线上网关、Docker 镜像或已安装副本。
仓库尚无首个提交，全部实现文件处于未跟踪状态。它有实际实现，按工作树证据编写 Lite 指南；不能填写当前 SHA，也不把 README 中的历史验收描述当成本轮结果。

## 声明与证据

| Claim | Evidence | Confidence | Caveat | Used by |
| --- | --- | --- | --- | --- |
| 敏感工具须精确本机批准 | [请求策略](../../local/request-policy.mjs) 搜索 `approvalSubject`、`requiresApproval` | 已确认 | 有三个明确控制工具豁免 | 主流程 Step 1–2 |
| 批准 5 分钟有效并在副作用前消费 | [批准实现](../../local/approvals.mjs) 搜索 `TTL`、`unlink` | 已确认 | 消费后崩溃需重新核对，不能保证执行成功 | 主流程 Step 2–3 |
| 批准记录按最终字节统一读写预算，超限先拒绝 | [记录存储](../../local/approval-store.mjs) 搜索 `MAX_RECORD_BYTES`、`atomicJson`；[预算回归](../../test/approval-budget.test.mjs) | 已确认 | 2026-10-30 核对源码和测试断言；部署结果另行验收 | 主流程 Step 2–3 |
| 默认状态目录在用户目录下，祖先路径也需可信 | [连接器](../../local/connector.mjs) 搜索 `defaultStateDirectory`；[状态检查](../../scripts/State-Safety.ps1) 搜索 `Assert-PrivateState` | 已确认 | 迁移旧状态属于运维任务，源码变更不自动迁移 | 根 README、指南运行入口 |
| Docker 初始化只读查询可在超时后重试一次 | [查询策略](../../local/docker-query.mjs) 搜索 `queryDockerState` | 已确认 | 不用于创建、启动、删除容器或文件副作用 | 代码地图 |
| 容器清理不确定时拒绝新执行，但保留自有任务查询与停止 | [沙箱接线](../../local/sandbox.mjs) 搜索 `call`、`closed`、`ownerClient`、`cleanupConfirmed` | 已确认 | 2026-10-30 核对控制分支先于关闭检查；仍检查取消和任务归属，清理失败不自动重试；测试与运行副本验收另见根修复记录 | 主流程 Step 4、根 README |
| 桥接 ID 账本先登记再执行 | [连接器](../../local/connector.mjs) 搜索 `receipts.claim`、`handleRpc` | 已确认 | 不重放输出；超时可能已有部分效果 | 主流程 Step 3 |
| 变参数与跨重启去重有测试断言 | [连接器回归](../../test/connector.test.mjs) | 已确认 | 使用假的运行器；本轮未跑 | 主流程 Step 5 |

## 证伪检查与读者下一问

证伪检查：若改变路径仍能复用批准，或连接器先执行再登记请求账本，则单次精确批准模型失效。先复查连接器回归和批准对象摘要，再讨论端到端保证。

读者下一问：OAuth 撤销与已经开始的工具操作怎样衔接？需另读 `cloud/auth-store.mjs`、`auth-transactions.mjs` 与事务测试，本指南不声称撤销能追回已执行效果。

## 验证边界

本轮执行 `validate_repo_docs.py` 和 MkDocs 构建，退出码及完整输出保存在独立维护报告中；不将静态阅读当作业务测试通过。没有部署、生产验收或历史改写。
所有 `../../` 源码链接按当前磁盘核对；独立站点没有这些仓库文件，MkDocs 对此记 INFO，站内链接仍正常检查。未解析、展示或引用真实凭据和运行时数据库内容；现有未提交文件仅作本地摘要保全。
