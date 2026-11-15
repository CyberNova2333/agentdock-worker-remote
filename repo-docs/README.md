# AgentDock Bridge：源码阅读指南

当远端智能体通过托管网关请求操作电脑上的工程文件或启动命令时，系统把公网鉴权、本机逐次批准与容器沙箱执行拆成三个隔离阶段。理解这些阶段如何交接、在哪个节点消费批准以及出错时怎样安全降级，是修改协议、排查拦截和审计安全边界的基础。

本指南采用 Standard 体系，沿着一条完整工具请求为主线拆解三大核心子系统。源码与测试基线以[指南变更记录](change-log.md)的最新锚点为准；历史部署与公网验收快照不代表自动同步的在线状态。

## 阅读路径

| 读者目标 | 从这里开始 | 读完后获得什么 |
| --- | --- | --- |
| 第一次建立全局心智模型 | [沿一次真实操作走到底](walkthroughs/one-real-run.md) | 串联云端信封、本机批准、防重放账本与容器执行的完整生命周期 |
| 理解云端认证与 WebSocket 中继 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) | 掌握双 Durable Objects 分工、PKCE/CIMD 校验、刷新轮换与心跳规则 |
| 理解精确批准、账本与宿主加锁 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) | 看懂 `approvalSubject` 摘要、紧凑字节预算、消费顺序与 Windows ACL 检验 |
| 理解 Docker 容器与文件安全边界 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) | 掌握容器权限参数、20 秒租约监控、文件防替换守卫与清理失败退守 |
| 按文件目录寻找修改与测试入口 | [按职责寻找源码与测试入口](code-map.md) | 对照 `cloud/`、`local/`、`container/`、`scripts/` 与 `test/` 定位具体符号 |
| 查对缩写、状态码与结构名 | [查看核心术语表](glossary.md) | 快速定位 `LOCAL_APPROVAL_REQUIRED`、`RequestReceipts` 等专用词条 |
| 复核源码依据与测试覆盖边界 | [查看源码证据审计](references/source-evidence.md) | 区分当前源码实测结论、仅限 Windows/Docker 的限制与历史验收快照 |
| 审阅可证伪边界与遗留风险 | [查看阅读质量审计](references/quality-review.md) | 明确讲解范围边界与修改时可能破坏不变量的高危点 |

## 运行与验证

仓库主体运行于 Node.js 24+，使用 `pnpm` 锁定依赖。在开发机上运行静态语法检查与测试套件如下（其中 Windows ACL、DPAPI、安装脚本与真实 Docker 集成测试在缺少对应宿主环境时会自动跳过）：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

生产模式把 Windows 受保护状态目录默认放在 `%USERPROFILE%\.agentdock-bridge` 并依赖 DPAPI 与 NTFS 权限校验；使用、安装与部署步骤集中记录在[项目使用与部署总览](../README.md)与[文档站入口](../docs-site/index.md)。源码、受保护运行副本、开发容器镜像和 Cloudflare 云端部署彼此独立更新，结构化文档校验不能代替实机端到端验收；已核验的版本快照另见[修复与验证快照](../SECURITY-FIXES.md)。

## 文档站与许可

独立文档站位于 `docs-site/`，基于 VitePress 构建中英双语站点，并通过配置映射直接引入本指南页面与结构图；仓库使用 GNU Affero General Public License v3.0（SPDX 标识 `AGPL-3.0-only`），条款见[完整许可文本](../LICENSE)。

证据状态：除特别标注外，本页基于当前源码已确认。
