# AgentDock Bridge 2

[English](README.en.md) · [中文源码指南](repo-docs/README.md)

AgentDock Bridge 是自行管理 Windows 工程环境的个人 MCP 网关。MCP 客户端通过 Cloudflare Worker 完成 OAuth 授权并发送工具请求；Windows 受保护连接器核对权限、收取本机批准；Linux 开发容器读取工程文件或运行 Bash，再经网关返回结果。

适用于需要远程使用本机开发环境、同时保留本机精确批准的人。电脑、连接器与 Docker 必须在线，工具执行依赖这台 Windows 主机。


## 阅读路径

| 读者目标 | 从这里开始 | 读完后获得什么 |
| --- | --- | --- |
| 部署并开始使用 | 本页的前置条件、首次配置与安装、日常使用 | 配置自己的网关并找到可信管理入口 |
| 理解一次请求 | [一条真实主流程](repo-docs/walkthroughs/one-real-run.md) | 看懂授权、批准、执行与返回的交接 |
| 寻找改动入口 | [代码地图](repo-docs/code-map.md) | 定位源码职责和对应验证 |
| 核对证据与限制 | [源码调查记录](repo-docs/references/source-evidence.md)与[修复和验收记录](SECURITY-FIXES.md) | 区分源码事实、测试结果和生产验收 |
| 参与维护 | [贡献指南](CONTRIBUTING.md)与[安全说明](SECURITY.md) | 了解提交信息、签名及离线安全检查 |

## 前置条件

- Windows x64、Windows PowerShell 和 .NET Framework，用于 DPAPI 凭证与本机权限检查。
- Docker Desktop 的 Linux 容器引擎；安装脚本使用本机 `desktop-linux` context。
- 可信的 Node.js 24+ 和 npm，用于检出目录的依赖、开发检查与 Wrangler。安装器会为宿主运行副本另行安装并校验固定版本 Node。
- 自己的 Cloudflare 账户、Wrangler 登录和可用的 HTTPS 域名。Worker 使用 SQLite Durable Objects。
- 一个明确允许容器完整读写的工程目录。当前默认是整个 `D:\Projects`，映射到 `/workspace`。

需要修改提交钩子或运行文档校验时，还需 Python 3.10+。源码、宿主运行副本和容器镜像分别管理，检出目录不是日常可信控制入口。

## 首次配置与安装

以下命令在已审阅的检出目录内执行，仅用于新安装。已有配置会被初始化脚本拒绝；升级已有安装请阅读后面的开发和更新说明。

1. 安装开发依赖，并创建本机部署配置：

   ```powershell
   pnpm install --frozen-lockfile
   Copy-Item wrangler.jsonc.example wrangler.jsonc
   .\node_modules\.bin\wrangler.cmd login
   ```

   编辑 `wrangler.jsonc`，核对目标账户、Worker 名称、域名绑定和 `PUBLIC_ORIGIN`。模板中的 `https://bridge.example.test` 必须换成自己的真实 HTTPS 地址；模板未包含特定账户和自定义域名路由。该配置不入版本控制。

   保持本机配置的 `origin` 与 Worker 的 `PUBLIC_ORIGIN` 一致。`Manage.ps1` 的公网状态探针和 `Secrets.ps1` 的密码窗口标题都从本机 `config.json` 的 `origin` 读取地址。

2. 显式指定同一个公开地址，初始化本机加密凭证并构建开发镜像：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Setup.ps1 -Origin https://bridge.example.test -Roots D:\Projects
   docker.exe --context desktop-linux build -f container/Dockerfile -t agentdock-dev:2026-10-28 .
   ```

   `Setup.ps1` 只初始化凭证和配置，默认私有目录为 `%USERPROFILE%\.agentdock-bridge`，此时尚不能启动工具执行。先把示例地址与工程目录改成自己的值。状态目录及其祖先必须通过所有者和写入权限检查。

3. 部署 Worker，并上传本项目所需的连接秘密：

   ```powershell
   .\node_modules\.bin\wrangler.cmd deploy
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Secrets.ps1 -Action Upload
   ```

   上传通过内存管道传递 `BRIDGE_TOKEN` 和 `OWNER_PASSWORD_HASH`。本机密码与 DPAPI 文件不提交到仓库，也不要贴进聊天。此步骤使用已审阅检出目录中的 Wrangler、部署配置和登录状态。

4. 安装受保护的宿主运行副本，再从私有目录启动：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Install-Hardened.ps1 -Workspace D:\Projects -Image agentdock-dev:2026-10-28
   & (Join-Path $env:USERPROFILE '.agentdock-bridge\Start.cmd')
   ```

   安装器复制连接器及生产依赖、固定镜像 SHA-256，并生成可信管理入口；它不负责部署 Worker 或创建域名。首次安装会下载并校验宿主 Node 的固定官方版本。需要代理时，安装脚本支持 `-Proxy`。连接器启动后检查本机状态及自己公开地址下的 `/healthz`。

MCP 入口为 `PUBLIC_ORIGIN` 下的 `/mcp`。在客户端添加该地址，核对回调与申请权限，再使用本机 `Password.cmd` 显示的密码完成网关授权。

## 日常使用

日常管理使用 `%USERPROFILE%\.agentdock-bridge` 内安装器生成的入口：

| 入口 | 用途 |
| --- | --- |
| `Start.cmd` | 手动启动连接器和监督器 |
| `Status.cmd` | 检查本地进程、连接状态及公网探针 |
| `Stop.cmd` | 停止连接器并清理本安装的开发容器 |
| `Password.cmd` | 在本机弹窗显示连接密码 |
| `Approve.cmd` | 查看并批准精确的待处理请求 |

读取、列目录、搜索、写入、编辑、删除和执行命令需要本机批准。首次请求返回 `LOCAL_APPROVAL_REQUIRED` 后，运行可信的 `Approve.cmd`，核对完整参数，输入显示的 `APPROVE <编号>`，再让客户端以相同参数重试。批准绑定客户端、权限、全部参数及联网选项，5 分钟内有效、仅使用一次。请求变化后需重新批准，超限请求会明确拒绝。

查看环境、查询已有任务和停止任务免于本机批准，仍检查所需权限；任务控制只允许所属客户端。使用 `command_status` 查询后台任务、`stop_command` 停止任务。连接器重启不会恢复旧任务。

无法确认容器清理时，连接器拒绝新命令和文件操作，仍保留所属客户端对已有任务的查询和停止。`cleanup_confirmed: false` 表示清理尚未确认，应在本机检查 Docker。停止请求不会自动重试失败的删除；容器自身时限和可信 `Stop.cmd` 继续提供恢复途径。

## 容器开发环境

整个允许的工程目录以读写方式挂载到 `/workspace`。文件工具接受 `/workspace/...`，也可转换对应 Windows 绝对路径。命令使用 Linux Bash，不能直接执行 Windows `.exe` 或 Windows PowerShell。

| 类别 | 镜像内的工具 |
| --- | --- |
| JavaScript | Node.js 24、npm、pnpm、TypeScript |
| 通用语言 | Python 3、pip/venv/pipx、Go、Rust/Cargo、Java 21/Maven |
| 构建工具 | GCC/G++、make、CMake、Ninja、pkg-config、GDB |
| 平台 CLI | GitHub CLI（`gh`）、Wrangler |
| 通用工具 | Git/Git LFS、SSH 客户端、curl/wget、jq、ripgrep、fd-find、rsync、SQLite、压缩工具 |

镜像标签是构建入口，安装后的配置固定具体 SHA-256，不会随标签变化自动更新。完整包清单位于镜像的 `/opt/bridge/os-packages.txt` 和 `/opt/bridge/npm-packages.json`。CLI 已安装，但宿主登录令牌没有迁移或写入镜像；平台操作需要为容器单独配置适当权限的凭证。

文件操作始终无网络。命令默认 `network: none`，需要联网时显式申请 `network: outbound` 并在本机批准。出站联网可访问外网及可达的局域网服务，不提供域名白名单，也不注入认证凭据。容器不发布入站端口。

每次执行使用独立容器。开发子进程的 UID/GID 为 1000，镜像只读，HOME 和临时目录使用有上限的 tmpfs。工程产物保留在挂载目录，临时 HOME 配置随容器销毁。每个容器最多 2 CPU、2 GiB 内存和 256 个进程；最多并行 4 个命令及 4 个文件操作。同步命令最长 60 秒，后台任务最长 1 小时。

## 安全边界

- 完整工程访问包含其中的 `.env`、私钥、令牌等文件。项目代码、文件内容和模型或工具输出都应作为不可信输入处理，可能携带提示注入。
- 容器不挂载宿主用户目录、网关状态、运行副本、Docker socket 或宿主 CLI 登录配置。宿主连接器运行在受保护安装目录，启动时核对固定 Node 摘要和路径权限，并清除 Node 预加载及 TLS 覆盖变量。
- Cloudflare/Worker 属于可信中继，可观察和修改经过它的工具输入输出。本机批准绑定精确请求，但不提供端到端加密或客户端签名的执行证明。
- OAuth 权限与本机批准分别校验。授权事务原子提交，旧刷新凭证重用会撤销整组授权；撤销不能回滚已开始的操作。
- 文件工具拒绝链接、检查文件身份和 Unicode，限制遍历与输出预算，并使用原子替换。预期内容摘要可防止基于旧内容的修改；这些检查不构成对任意并发本地写入者的完整文件系统事务。
- 文件工具拒绝替换具有受保护或显式自定义 Windows ACL 的文件，保留其内容和权限。已批准的 Bash 仍有完整工程读写权，可能改变文件及权限。
- 断线、取消或超时可能已经产生部分效果。请求账本防止相同桥接请求再次执行，不应据此自动重试写入。批准记录由私有目录 ACL 保护，连接凭证另以 Windows DPAPI 加密。

更详细的实现路径见[源码指南](repo-docs/README.md)，修复与历史验收见[安全修复记录](SECURITY-FIXES.md)。

## 开发和更新

在可信开发环境中运行：

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

Docker 集成测试需明确启用并选定已构建的镜像；以下命令串行运行完整测试入口：

```powershell
$env:AGENTDOCK_DOCKER_TEST='1'
$env:AGENTDOCK_TEST_IMAGE='agentdock-dev:2026-10-28'
node --test --test-concurrency=1 test/*.test.mjs cloud/*.test.mjs
.\node_modules\.bin\wrangler.cmd deploy --dry-run
```

更新宿主连接器时，先用可信入口停止旧安装，审阅源码后重新运行 `Install-Hardened.ps1`，再从新生成的可信入口启动。容器代码或工具变更还需重建、测试镜像并重新固定镜像 ID；检出源码不会自动替换运行副本。云端更新使用本机部署配置单独部署。

旧版 `%LOCALAPPDATA%\AgentDockBridge` 的迁移应在旧连接器停止后处理受保护凭证、配置及新运行副本，不能只复制启动器；迁移后的待批准请求需重新发起。仓库没有通用的自动迁移入口。轮换凭证使用已审阅的 `scripts/Rotate-Secrets.ps1`，运行前停止连接器，并使用带 Wrangler 开发依赖和正确部署配置的检出目录；轮换后客户端需重新授权。

提交标题、正文和签名遵循[贡献指南](CONTRIBUTING.md)。真实配置、凭证、构建输出和本机审查证据留在版本控制之外。

## 文档与验证

[中文源码指南](repo-docs/README.md)采用 Lite 指南加代码地图，聚焦一次敏感工具请求的批准和执行流程。当前实现、测试、生产运行副本和云端部署应分别核验；文档校验或构建不代表业务与生产验收通过。已执行验证的日期、对应源码及范围见[修复和验收记录](SECURITY-FIXES.md)。

文档站使用 VitePress 默认主题，内容只维护在 `repo-docs/`，站点通过 include 读取：

```powershell
pnpm --dir docs-site install --frozen-lockfile
pnpm --dir docs-site run docs:dev -- --host 127.0.0.1
pnpm --dir docs-site run docs:build
```

默认输出为 `docs-site/.vitepress/dist/`，构建命令可追加 `-- --outDir <仓库外绝对目录>`。独立文档站把仓库源码链接显示为精确路径，不随页面发布源码或本机资源。

## 许可

本项目以 [GNU General Public License 第 3 版](LICENSE)开源，标识为 `GPL-3.0-only`。依赖组件保留各自的许可证。
