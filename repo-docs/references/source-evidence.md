# 源码证据审计

这是固定源码审计记录。首次调查发生于 2026-10-29，2026-10-30 随安全修复同步，2026-10-31 按当前源码和已保存验收证据复核。行为解释由主流程承载，源码导航由代码地图承载。

本次源码基线为 `8e4afdd2e62ff6f6e2fd58cada0a2b75a50abcc8`，加上本轮文档与许可工作树。首次调查时仓库尚无首个提交；该历史状态不再代表当前仓库。

## 遍历记录

| 遍历 | 实际检查 | 得到的依据 |
| --- | --- | --- |
| Pass 1 | 仓库目录、Git 状态、根 `AGENTS.md`、README、`package.json`、`cloud/`、`local/`、`container/` 与管理脚本清单 | 确定真实入口、运行命令和文档范围；文档说明需继续与源码核对 |
| Pass 2 | `local/request-policy.mjs`、`approvals.mjs`、`approval-store.mjs`、`connector.mjs`、`receipts.mjs`、`sandbox.mjs` 的批准与执行交接，容器入口，以及 connector/approval-budget/sandbox-recovery 测试断言 | 追踪输入、批准摘要、单次消费、执行登记和故障控制，并对照可证伪的回归条件 |
| 验收证据复核 | `artifacts/fix-final-01/result.json`、`artifacts/release-review-8e4afdd/review.json` 和 `after-login-verification.json` | 确认既有验证绑定的源码版本、时间和运行/部署对象；只引用脱敏结论，不发布本机材料 |

## 覆盖与排除

讲解覆盖一个敏感 MCP 工具请求从本机待批准到一次执行，包含故障状态下已有任务的查询与停止。OAuth、安装、凭据轮换和文件系统检查列出源码入口，但不逐项展开全部分支。

本轮文档整理没有运行新的业务回归、服务启停或云端部署。此前已完成的源码、受保护运行副本、真实 Docker 和云端验收结果，按时间和版本汇总于[修复与验证快照](../../SECURITY-FIXES.md)。该记录已说明云端管理登录恢复后的部署补验；早先“尚未核验”的临时限制不再作为当前结论。

## 声明与证据

| Claim | Evidence | Confidence | Caveat | Used by |
| --- | --- | --- | --- | --- |
| 敏感工具须精确本机批准 | [请求策略](../../local/request-policy.mjs) 搜索 `approvalSubject`、`requiresApproval` | 已确认 | 有三个明确控制工具豁免 | 主流程 Step 1–2 |
| 批准 5 分钟有效并在副作用前消费 | [批准实现](../../local/approvals.mjs) 搜索 `TTL`、`unlink` | 已确认 | 消费后崩溃需重新核对，不能保证执行成功 | 主流程 Step 2–3 |
| 批准记录按最终字节统一读写预算，超限先拒绝 | [记录存储](../../local/approval-store.mjs) 搜索 `MAX_RECORD_BYTES`、`atomicJson`；[预算回归](../../test/approval-budget.test.mjs) | 已确认 | 2026-10-30 核对源码和测试断言；部署结果另行验收 | 主流程 Step 2–3 |
| 默认状态目录在用户目录下，祖先路径也需可信 | [连接器](../../local/connector.mjs) 搜索 `defaultStateDirectory`；[状态检查](../../scripts/State-Safety.ps1) 搜索 `Assert-PrivateState` | 已确认 | 迁移旧状态属于运维任务，源码变更不自动迁移 | 根 README、指南运行入口 |
| Docker 初始化只读查询可在超时后重试一次 | [查询策略](../../local/docker-query.mjs) 搜索 `queryDockerState` | 已确认 | 不用于创建、启动、删除容器或文件副作用 | 代码地图 |
| 容器清理不确定时拒绝新执行，但保留自有任务查询与停止 | [沙箱接线](../../local/sandbox.mjs) 搜索 `call`、`closed`、`ownerClient`、`cleanupConfirmed`；[故障恢复回归](../../test/sandbox-recovery.test.mjs) | 已确认 | 控制分支先于关闭检查，仍检查取消和任务归属；清理失败不自动重试，未确认清理仍不报告成功 | 主流程 Step 4–5、根 README |
| 桥接 ID 账本先登记再执行 | [连接器](../../local/connector.mjs) 搜索 `receipts.claim`、`handleRpc` | 已确认 | 不重放输出；超时可能已有部分效果 | 主流程 Step 3 |
| 变参数与跨重启去重有测试断言 | [连接器回归](../../test/connector.test.mjs) | 已确认 | 使用假的运行器；本轮只核对既有源码和运行记录 | 主流程 Step 5 |
| 已保存的业务与部署验收属于特定版本快照 | [修复与验证快照](../../SECURITY-FIXES.md)及本页列出的本机证据 | 已核对 | 完整测试、补充测试与登录后的云端补验分别执行，不能说成文档整理时重新跑过全部检查；本机原始证据不随源码发布 | 指南入口、代码地图 |

## 证伪检查与读者下一问

证伪检查：若改变路径仍能复用批准，或连接器先执行再登记请求账本，则单次精确批准模型失效。若容器清理失败后同一客户端无法查询、停止其他已有任务，则故障控制模型失效。分别复查连接器和故障恢复回归，不能仅凭文档结构检查判定行为正确。

读者下一问：OAuth 撤销与已经开始的工具操作怎样衔接？需另读 `cloud/auth-store.mjs`、`auth-transactions.mjs` 与事务测试，本指南不声称撤销能追回已执行效果。

## 验证边界

当前文档站采用 VitePress 默认主题。文档结构、链接和站点构建的实际检查结果记入[指南变更记录](../change-log.md)，不将这些检查当作业务测试或生产验收。

源码链接在克隆和代码托管视图中可直接核对；独立文档站将指南之外的仓库链接显示为精确文件路径。真实凭据、受保护状态和本机验收材料均不进入文档站或公开源码。
