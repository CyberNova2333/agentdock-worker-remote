# AgentDock Bridge 2

[English](README.en.md) · [中文源码指南](repo-docs/README.md)

独立实现的个人 MCP 网关。Cloudflare Worker 负责 OAuth 和中转；Windows 上的受保护连接器负责本地批准与容器生命周期；Linux 开发容器处理工程文件及命令。

入口由本机部署配置的 `PUBLIC_ORIGIN` 决定，MCP 路径为 `/mcp`，认证方式 OAuth。

## 日常使用

默认可信管理入口在 `%USERPROFILE%\.agentdock-bridge`，不在容器挂载的工程目录内：

- `Start.cmd`：手动启动连接器和监督器。
- `Status.cmd`：检查本地进程与公网心跳状态。
- `Stop.cmd`：停止连接器并清理本部署的开发容器。
- `Password.cmd`：在本机弹窗显示连接密码；不要贴进聊天。
- `Approve.cmd`：查看并批准精确的待处理请求。

在 MCP 客户端添加网关地址，核对回调与权限，再在自己的网关页面输入本机密码。2026-10-30 的第五轮修复保留连接密码和授权存储代次，不要求因此重新授权。迁移本机状态目录后，未完成的待批准请求需从客户端重新发起。

读取、列目录、搜索、写入、编辑、删除和执行命令首次调用会返回 `LOCAL_APPROVAL_REQUIRED`。在本机运行可信的 `Approve.cmd`，查看完整参数，输入显示的 `APPROVE <编号>`，再让客户端以相同参数重试。批准绑定客户端、权限、全部参数和联网选项，5 分钟有效、仅使用一次。记录使用紧凑 JSON，写入前检查与读取相同的最终字节上限；超限请求会明确拒绝，元数据不会被静默删除或排除在批准摘要之外。空输入取消；请求改变后需重新批准。查看环境、查询已有任务和停止任务不需要批准。

## 开发环境

先将 `wrangler.jsonc.example` 复制为本机的 `wrangler.jsonc`，填写自己的部署配置；后者不入版本控制。

按所有者要求，**整个 `D:\Projects` 以读写方式挂载到 `/workspace`**。文件工具接受 `/workspace/...`，也可转换对应 Windows 绝对路径。终端使用 Linux Bash，不能直接执行 Windows `.exe` 或 Windows PowerShell 命令。

| 类别 | 镜像内的工具 |
| --- | --- |
| JavaScript | Node.js 24、npm、pnpm、TypeScript |
| 通用语言 | Python 3、pip/venv/pipx、Go、Rust/Cargo、Java 21/Maven |
| 构建工具 | GCC/G++、make、CMake、Ninja、pkg-config、GDB |
| 平台 CLI | GitHub CLI (`gh`)、Wrangler |
| 通用工具 | Git/Git LFS、SSH 客户端、curl/wget、jq、ripgrep、fd-find、rsync、SQLite、压缩工具 |

镜像标签为 `agentdock-dev:2026-10-28`，生产配置固定其 SHA-256，不会跟随标签自动更新。完整包清单位于镜像 `/opt/bridge/os-packages.txt` 和 `/opt/bridge/npm-packages.json`。CLI 已安装，**没有迁移 Windows 登录令牌，也没有把凭证写入镜像**；需要认证的平台操作仍须为容器单独配置适当权限的凭证。

文件操作始终无网络。`exec_command` 默认 `network: "none"`；安装依赖或访问平台 API 时，可以显式传 `network: "outbound"` 并在本机批准。联网模式可以访问外部及可达的局域网服务，不是域名白名单。容器不发布入站端口。

每个命令使用独立容器，开发进程以 UID/GID 1000 运行。镜像只读，临时目录和 HOME 使用有上限的 tmpfs。工程构建产物保留在磁盘，临时 HOME 的配置和缓存随容器销毁。每个容器最多 2 CPU、2 GiB 内存、256 个进程；最多并行 4 个命令及 4 个文件操作。同步命令最长 60 秒，后台任务最长 1 小时。使用 `command_status` 查询、`stop_command` 停止自己客户端创建的任务；连接器重启不恢复旧任务。无法确认容器清理时，连接器拒绝继续执行，须先检查 Docker 状态。

## 安全边界

- 容器不挂载 Windows 用户目录、网关状态、运行副本、Docker socket 或宿主 CLI 登录配置。控制程序来自只读镜像；宿主连接器从私有状态目录中的安装副本运行。工程源码变更不会自动进入运行副本或镜像。
- 状态目录检查包括所有者和祖先路径的写入、删除及权限修改风险。状态与运行副本不能放在工程目录或不可信父路径下；更换目录不能只复制启动脚本而跳过检查。
- 宿主 Node 使用 `%USERPROFILE%\.agentdock-toolchains` 下独立的官方固定版本，校验下载包 SHA-256 与签名；启动时复核程序摘要和路径权限。安装及运行不使用共享 `D:\Toolkit` 中的 Node/npm，也会清除 Node 预加载和 TLS 覆盖环境变量。现有共享工具目录权限不变。
- 完整工程访问意味着其中的 `.env`、私钥、令牌等也可能被读取和修改。批准操作前要核对实际意图；不可信项目代码和工具输出仍可能携带提示注入。
- 本地批准降低云端伪造操作的风险，但 Cloudflare/Worker 仍是可信中继，可看到并修改经过它的工具输入输出。这不是端到端加密或端到端客户端签名系统。
- OAuth 签发、刷新、撤销和认证检查由同一 Durable Object 处理。外部元数据获取在提交锁外进行，版本复核通过后才原子提交并返回结果；持续冲突或超时会安全失败。CIMD 客户端重新授权降权会撤销旧授权。旧刷新凭证重用会撤销整组授权；未批准 `offline_access` 时不颁发刷新凭证。更换所有者密码会使旧客户端和授权失效。撤销不能撤回已经开始的操作。
- 本地请求账本只保存获准操作的摘要和时间，保留 24 小时、最多 10000 条；无需批准的控制请求使用有上限的短期缓存。重复桥接 ID 不会再次执行。断线或超时的操作可能已有部分效果，不应自动重试写入。
- 普通控制请求按客户端限额；停止命令有独立的有界缓存和并发槽位，不因普通控制缓存满额而被拦截，且仍核对任务归属。停止操作是幂等的；其专用缓存淘汰旧记录后，旧停止请求可能再次到达归属检查。
- 待批准请求的精确参数暂存于私有状态目录，过期后不可使用并在后续扫描时清理。连接日志不记录令牌、文件正文或命令输出。Windows DPAPI 与状态目录 ACL 保护本机连接凭证。
- 文件工具拒绝链接、检查身份、限制遍历预算并使用原子替换。这不是针对任意并发本地写入者的完整文件系统事务；宿主隔离依赖实际容器挂载边界。
- 字符串参数必须是合法 Unicode；内容、编辑参数、路径及命令中的孤立代理项会在操作前被拒绝，避免静默改变文本或误指向其他路径。
- 为避免原子替换丢失 Windows 自定义权限，文件工具拒绝替换具有受保护或显式自定义 ACL 的文件。普通继承权限文件仍可编辑。需要保留自定义 ACL 时，请使用可信 Windows 编辑工具；已批准的 Bash 命令仍具有完整工程读写权，可能改变文件权限。
- 没有新增开机启动、计划任务或云端定时任务。Docker Desktop 必须正常运行；电脑离线、休眠或 Docker 停止时不可执行工具。

## 开发和更新

在宿主受信任环境中检查源码后执行：

```powershell
npm.cmd ci
npm.cmd run check
docker.exe build -f container/Dockerfile -t agentdock-dev:2026-10-28 .
$env:AGENTDOCK_DOCKER_TEST='1'
$env:AGENTDOCK_TEST_IMAGE='agentdock-dev:2026-10-28'
npm.cmd test
.\node_modules\.bin\wrangler.cmd deploy --dry-run
```

停止旧连接器后运行 `scripts\Install-Hardened.ps1 -Workspace D:\Projects`，将已审查源码和生产依赖安装到受保护目录并固定镜像 ID，然后使用可信入口启动。首次安装会下载校验固定版本的 Windows Node；可先单独运行 `scripts\Install-NodeRuntime.ps1`，需要代理时传入 `-Proxy`。不要把工程目录中的任意脚本当作不可篡改的控制入口。

旧版本默认状态目录为 `%LOCALAPPDATA%\AgentDockBridge`。升级到新的用户目录位置时，应在旧连接器停止后迁移受保护凭证和配置、安装新运行副本，再使用新目录入口；保留原连接凭证，待批准请求重新发起。实际迁移、安装和部署是否完成，以本次运维验收记录为准。

云端部署固定使用 `wrangler.jsonc` 指定的账户、Worker 和域名。`scripts\Rotate-Secrets.ps1` 通过内存管道上传本项目新秘密，保留加密恢复副本，不输出明文。`scripts\acceptance-v2.mjs` 仅为自己的临时 canary 操作批准一次请求，结束后撤销测试授权。

`SECURITY-REVIEW.md` 是升级前历史审查，`audit/` 是历史漏洞复现，不能作为修复后的通过标准。当前测试在 `test/` 和 `cloud/*.test.mjs`；修复状态及实际验收证据见 `SECURITY-FIXES.md` 和 `artifacts/`。

<!-- repo-docs routing -->

## 源码指南与文档站

云端认证网关把工具请求交给 Windows 受保护连接器，再由本机对精确参数批准，交给 Linux 容器访问工程文件或运行 Bash。批准边界和执行结果需要分别理解。当前没有独立 LICENSE 文件，项目整体分发许可尚未确认，不能以依赖许可代替。

从[阅读路径](repo-docs/README.md)进入[一条真实主流程](repo-docs/walkthroughs/one-real-run.md)，再用[代码地图](repo-docs/code-map.md)定位改动。证据与未覆盖边界见[源码调查记录](repo-docs/references/source-evidence.md)。

## 文档站

文档站采用 VitePress 默认主题，依赖与业务项目分开安装。默认输出 `docs-site/.vitepress/dist/`；独立核验可在构建命令后加 `-- --outDir <仓库外绝对目录>`。指南正文只维护 `repo-docs/`，站点通过 include 读取；网页中的仓库源码链接显示为精确文件路径，不复制源码或本机资源。

```sh
npm --prefix docs-site ci
npm --prefix docs-site run docs:dev -- --host 127.0.0.1
npm --prefix docs-site run docs:build
```
