# 指南变更记录

条目按时间先后排列，最新记录位于末尾。历史条目保留当时的仓库和验证状态；其中“无首个提交”及 MkDocs 记录不代表当前配置。当前使用与源码阅读从[指南入口](README.md)开始，运行验证按[修复与验证快照](../SECURITY-FIXES.md)中的版本和时间解释。

## 2026-10-29：建立主流程指南并对齐文档入口

- 触发：用户授权 widened docs sync；同步决策为 `foreground patch`，在共享工作树完成指定文档层。
- 建立阅读路径、主流程、代码地图、两遍源码证据与阅读质量审计；范围限定为 一个敏感 MCP 工具请求从本机待批准到一次执行。
- 保留中文 README 的现有正确内容，补齐英文入口和文档站操作；AGENTS 成为规则单一来源，CLAUDE 简短引用。
- 新建 MkDocs 1.6.1 内置主题站点；验证输出写入仓库外目录，保留业务构建产物。
- 验证：`validate_repo_docs.py --lite` 与 `mkdocs build --strict` 均退出 0；源码链接 INFO 和保留提示见独立维护报告。未跑业务测试，不代表生产验证。
- 边界：不逐项覆盖 OAuth 所有事务、Windows 安装/凭据轮换、全部文件 ACL 分支和容器生命周期；没有重新验收线上网关、Docker 镜像或已安装副本。

校验限制：因为无首个提交，校验器保留缺 SHA 提示；不得用虚构值消除提示。

Synced through：不可用（尚无首个提交，HEAD 不存在；以本次工作树调查为基线，不伪造 SHA）。

## 统一维护复核（2026-10-29）

补齐中英 README 入口、贡献与安全说明；AGENTS 为规范正文，CLAUDE 为引用入口。补充钩子检查暂存内容、提交标题及推送新增历史，保留项目原有检查；安装步骤与边界见根 SECURITY 和 CONTRIBUTING。独立站点采用 VitePress 默认主题，源码链接在网页中保留为精确路径。

仓库尚无首个提交；不伪造同步 SHA。

文档结构校验和站点构建均退出 0；共用护栏的 9 项隔离测试通过。业务测试、生产部署和远端发布未因此视为通过。大文件扫描边界见 SECURITY。

## 文档站恢复默认主题（2026-10-29）

按用户要求统一使用 VitePress 默认主题，移除额外配色、字体、圆角和入场动效。指南正文、源码定位及导航保留；文档依赖与业务依赖分开。新建站点从 MkDocs 迁移为 VitePress，既有两个 VitePress 站点使用原生主题入口。
## 2026-10-30：同步第五轮修复的使用入口与批准预算

- 触发：安全与批准流程修复；同步决策为 `foreground patch`，保留 Lite 指南范围。
- 中英 README 与指南入口改为默认 `%USERPROFILE%\.agentdock-bridge`；说明所有者及祖先路径检查、旧状态迁移后重发待批准请求，以及本轮保留连接密码与授权代次。
- 主流程补充紧凑 JSON 的最终字节预算与超限拒绝，所有参数和元数据仍完整绑定；代码地图补充只读 Docker 初始化查询策略及验证入口。
- 定向核对当前管理脚本、批准存储、连接器和 Docker 查询源码；不把文档更新当作迁移或生产验收。实际测试与部署结果见根目录 `SECURITY-FIXES.md`。
- 验证：`validate_repo_docs.py --lite` 退出 0，0 errors、1 warning；日志在 `artifacts/fix-round5/repo-docs-validation.txt`。唯一提示为缺少同步 SHA：同步时仓库尚无首个提交、HEAD 不存在，不伪造同步值。

首次签名提交建立后补齐同步锚点；后续变更仅整理换行和本条记录，不改变运行行为。

Synced through 9b483eebeeadd90b98bc01c8a71a3daf4bdbd93b

## 2026-10-30 23:27 +08:00：保留清理故障后的任务控制

- 触发：最终审查发现清理故障同时封锁已有任务查询和停止；同步决策为 `foreground patch`。
- 中英 README 和主流程说明故障时只拒绝新命令、文件操作，保留所属客户端对已有任务的查询与停止；取消和权限校验继续生效。
- 证据表记录控制分支与关闭检查的顺序。未确认清理仍按失败报告，不自动重试；容器时限和可信本机停止入口继续有效。
- 本条基于下列提交及本次修复工作树的源码核对；实际业务测试、运行副本更新与部署结果另见根目录 `SECURITY-FIXES.md`。
- 验证：`validate_repo_docs.py --lite` 退出 0，0 errors、0 warnings；日志在 `artifacts/fix-final-01/repo-docs-validation.txt`。

Synced through 5ded65ef08bb6e15b81ce1e22b7fe66dda567abb

## 2026-10-31 00:07 +08:00：规范指南并对齐验证快照

- 触发：用户要求按 `repo-docs` 规范项目文档、提交信息和双语 README；采用 widened docs sync，前台决策为 `foreground patch`，保留 Lite 加代码地图的阅读范围。
- 指南入口区分源码、运行副本、镜像和版本验收；主流程补充客户端 RPC ID 与桥接请求 ID 的用途，以及批准、预算和故障恢复的局部验证入口。
- 代码地图修正沙箱与工具运行器的符号归属，补齐本机批准、文件策略、云端入口和运维脚本的改动导航，明确文档站与维护工具不参与主请求路径。
- 证据与质量审计移除过时的当前状态断言，统一链接已有验证快照。云端管理登录恢复后的部署补验已完成，不再保留为未解决缺口；历史记录仍保留原有语境。
- 项目已获授权采用 GNU GPLv3，指南许可说明链接根目录 `LICENSE`，标识为 `GPL-3.0-only`。
- 验证：文档结构与链接校验退出 0，0 errors、0 warnings；VitePress 默认主题站点构建通过。两个包及锁文件的许可字段一致，依赖内容未变，完整 `LICENSE` 与下载源摘要一致。日志保存在本机 `artifacts/docs-normalization-20261031/`。
- 验证范围：重新核对实际源码、精确符号、回归断言和已保存验收记录；本轮未执行业务回归、服务启停或部署。包许可元数据已更新，运行副本的 28 文件一致性仍按 `8e4afdd` 的既有快照解释。

Synced through 8e4afdd2e62ff6f6e2fd58cada0a2b75a50abcc8

## 2026-11-10 11:58 +08:00：README 切换 pnpm 指令并记录部署当日的安装器修复与部署专用值脱敏

- 触发：用户要求把网关重新部署到既定域名并完成本机配置，随后要求筛查混入仓库的本机配置与个人信息、过滤后提交；发现中英根 README 仍残留 `npm.cmd` 指令，而仓库已无 `package-lock.json`，照做会直接失败；同步决策为 `foreground patch`。
- 中英 README 的依赖安装、开发检查与文档站命令改为 pnpm 形式，与 `AGENTS.md`、`repo-docs/README.md` 一致；wrangler 调用保持 `node_modules\.bin` 形式不变。
- 同轮部署事实：修复 `scripts/Install-Hardened.ps1` 运行副本依赖安装（补上锁文件内固定的 pnpm CLI 引用，并把 pnpm 12 已移除的 `--omit=dev --no-audit --no-fund` 调整为 `--frozen-lockfile --prod --ignore-scripts`）；重建并固定镜像 `agentdock-dev:2026-11-10`（镜像内 `/opt/bridge` 关键文件 SHA-256 与源码一致）；重装受保护运行副本（28 文件清单）。公网 `/healthz` 曾返回 `{"ok":true,"connectorOnline":true}`。
- 部署专用值脱敏：移除云端页面与测试中的硬编码部署域名（首页端点改由 `PUBLIC_ORIGIN` 渲染，反钓鱼提示改通用文案，测试改用 `bridge.example.test`）；`Setup.ps1` 默认 Origin 改回示例地址；`Manage.ps1` 探针与 `Secrets.ps1` 密码窗口标题改读本机 `config.json` 的 `origin`；`record-deployment.mjs`/`record-hardening.mjs` 的 Cloudflare 账户 ID 与主机名改为显式命令行参数，并把安装清单核对中的 `package-lock.json` 对齐为 `pnpm-lock.yaml`。历史提交中仍含上述部署值，未获重写授权，按原样保留。
- 部署环境注记：本机沙箱层曾向 `%USERPROFILE%\.agentdock-bridge` 与 `%USERPROFILE%\.agentdock-toolchains` 添加 `CodexSandboxUsers:(RX)` ACE，触发 `Assert-PrivateState` 拒绝全部可信入口；本次已移除并复核两树无多余主体。若再次出现同类拒绝，先检查这两个控制目录的 ACL。
- 验证：`pnpm run check` 通过；`pnpm test` 101 项（99 通过、0 失败、2 项 Docker 集成测试在未启用 `AGENTDOCK_DOCKER_TEST` 时按预期跳过）。本轮未运行 Docker 集成回归，也未执行停止/重启公网验收。

Synced through 90295b3（README 与安装器修复在工作树，未提交）

## 2026-11-10：历史脱敏、接入说明纠正与完整部署复验

- 触发：接续部署与发布任务，复核源码、历史和实际运行状态；同步决策为 `foreground patch`。
- 对 27 个既有提交执行历史清理，去除旧平台依赖和引用，替换历史部署账户、域名与本机绝对路径；分别重新签名并校验文件树、日期和父子关系。历史条目中的旧提交编号和当时的验证限制仍按原有时间解释，本条记录后续复验结果。
- 容器保留 GitHub CLI，凭据隔离测试改为覆盖通用 `_TOKEN` 变量；本机发布工具置于仓库外，主历史使用 GitHub 身份，镜像发布使用独立密钥与身份映射。
- 根 README 修正管理脚本地址来源；文档站的首页、快速入门、配置与排错页改为实际的远端 OAuth/MCP 接入和受保护安装流程，移除不存在的本地入口和环境变量示例。指南入口更新源码基线。
- 验证：语法检查通过；显式启用 Docker 后全量 101 项通过，0 失败、0 跳过。首次全量运行中的一项测试及新副本首次启动遇到 Windows PowerShell 安全扫描组件的 `AccessViolation`；保留失败证据，单项和全量重跑及可信启动重试均成功，未修改系统安全设置。
- 部署复验：重新构建并固定镜像、重装受保护运行副本；28 个安装文件、固定 Node 和镜像内关键源文件摘要一致。停止后公网 503、重启后公网 200；公网验收 9 项通过，覆盖 OAuth、文件增读改删、无网命令和令牌刷新。临时授权已撤销、旧令牌返回 401，探针无残留。云端源码未变，沿用已核实的部署版本。
- 边界：以上是独立验收客户端的实际调用；未在 ChatGPT 账户中添加或验证连接。操作证据、旧版本备份与失败日志保留在仓库外，不随文档发布。
- 文档验证：VitePress 构建通过；指南校验 0 errors、1 warning（既有 `DESIGN.md` 缺少同步规则提示）。

Synced through 110e5cd6a1219ea4448d94c3f897b65e92d3d081
