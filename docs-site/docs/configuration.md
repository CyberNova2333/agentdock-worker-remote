---
title: 配置矩阵与运维脚本
description: 完整列出 AgentDock Bridge 的 wrangler.jsonc、Worker Secrets、本地 config.json、环境变量以及 PowerShell 与测试脚本矩阵。
---

# 配置矩阵与运维脚本

AgentDock Bridge 将配置明确划分为**云端网关**与**本机受保护状态目录**（默认 `%USERPROFILE%\.agentdock-bridge`）两层。任何真实域名、加密凭据与历史部署记录都不应进入 Git 版本库。

## 1. Cloudflare Worker 配置（`wrangler.jsonc`）

仓库内置脱敏模板 `wrangler.jsonc.example`。复制为 `wrangler.jsonc` 后，关键字段如下：

| 配置字段 | 源模板默认示例 | 作用与约束 |
| --- | --- | --- |
| `name` | `agentdock-bridge` | Worker 服务名称 |
| `main` | `cloud/index.mjs` | 云端入口模块（导出默认 `fetch` 与 `BridgeRelay`、`AuthCoordinator`） |
| `compatibility_date` / `compatibility_flags` | `2026-10-28` / `["nodejs_compat", "global_fetch_strictly_public"]` | 启用 Node 兼容 API 并限制公共出站 fetch 行为 |
| `preview_urls` | `false` | 关闭随机预览 URL，避免绕过 `PUBLIC_ORIGIN` 来源核对 |
| `vars.PUBLIC_ORIGIN` | `https://bridge.example.test` | 公开网关根地址（HTTPS）；同时约束主机头校验、CORS 与同意书 POST 同源检查 |
| `durable_objects.bindings` | `RELAY` (`BridgeRelay`), `AUTH` (`AuthCoordinator`) | 两个基于 SQLite 存储（迁移 `v1` / `v2`）的核心 Durable Objects |

### Worker Secrets（敏感凭据）

下列密钥通过 `.\scripts\Secrets.ps1 -Action Upload` 或 `.\scripts\Rotate-Secrets.ps1` 经 `wrangler secret bulk` 上传，严禁写入 `wrangler.jsonc` 的 `vars`：

| Secret 名称 | 生成方式与格式 | 行为影响 |
| --- | --- | --- |
| `BRIDGE_TOKEN` | 32 字节密码学随机 URL-safe Base64（不少于 32 字符） | `BridgeRelay` 使用恒定时间摘要比对 `/bridge` 的 `Bearer` 鉴权，并作为限流键盐值 |
| `OWNER_PASSWORD_HASH` | `pbkdf2-sha256$100000$<salt>$<hash>` | 用于 `/authorize` 登录校验；其 SHA-256 决定 `AUTH` DO 实例名 `owner-v2-<hash>`，更改后旧令牌即时全部作废 |

## 2. 本机受保护目录（`%USERPROFILE%\.agentdock-bridge`）

本机状态目录由 `Setup.ps1` 与 `Install-Hardened.ps1` 维护，受 NTFS 显式 ACL 约束，仅允许当前 Windows 用户与 `SYSTEM`（`S-1-5-18`）访问。

### 目录结构与文件说明

- `secrets.dpapi`：使用当前用户 Windows DPAPI（附加熵 `cbnv.agentdock-bridge.secrets.v1`）加密保存 `bridgeToken`、`ownerPassword` 与 `ownerPasswordHash`。
- `config.json`：连接器运行时配置（详见下表）。
- `runtime-<timestamp>-<id>/`：隔离复制的 `local/`、`scripts/`、`package.json`、`pnpm-lock.yaml` 及只读生产依赖，源码目录修改不会静默影响运行副本。
- `installation.json`：安装清单，记录工作区、镜像 SHA-256 及每个拷贝文件的 SHA-256 校验值。
- `Start.cmd` / `Stop.cmd` / `Status.cmd` / `Password.cmd` / `Approve.cmd`：由安装器生成的受保护快捷批处理，显式调用 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`。注意仓库根目录的 `ShowPassword.cmd` 会转发调用受保护目录下的 `Password.cmd`。
- `approvals/` 与 `request-receipts/`：5 分钟 TTL 待批准队列文件（`.request.json` / `.approved.json`）与 24 小时防重放执行账本。
- `connector.log` / `connector-status.json` / `supervisor.json` / `connector-process.json`：轮转日志（上限 1 MiB）、在线状态与防 PID 复用锁文件。

### `config.json` 字段矩阵

| 字段路径 | 由谁写入 | 真实含义与约束 |
| --- | --- | --- |
| `origin` | `Setup.ps1 -Origin` | 对应云端 `PUBLIC_ORIGIN`；非回环测试地址必须为 `https://` 且无多余路径 |
| `roots` / `defaultCwd` | `Setup.ps1 -Roots` → `Install-Hardened.ps1 -Workspace` | 沙箱模式下严格限定**单一**绝对工作区目录；不能包含状态目录或运行副本本身 |
| `sourceRoot` | `Install-Hardened.ps1` | 指向受保护的 `runtime-*` 目录；`Manage.ps1` 与 `Approve.ps1` 会拒绝从不匹配的目录启动 |
| `nodePath` / `nodeRoot` / `nodeSha256` | `Install-NodeRuntime.ps1` | 固定指向 `%USERPROFILE%\.agentdock-toolchains\node-v24.22.1-win-x64\node.exe`，每次启动与批准前复核 SHA-256 |
| `allowExec` | `Setup.ps1`（`false`）→ `Install-Hardened.ps1`（`true`） | 控制是否暴露 `exec_command` / `command_status` / `stop_command`；容器内 `file-worker.mjs` 始终固定为 `false` |
| `requireLocalApproval` | `true` | `Manage.ps1` 启动强制校验必须为 `true` |
| `sandbox.enabled` | `Setup.ps1`（`false`）→ `Install-Hardened.ps1`（`true`） | 启用后才可由 `Manage.ps1 Start` 拉起连接器 |
| `sandbox.image` | `Install-Hardened.ps1 -Image` | 固定为完整 `sha256:<64位十六进制>` 镜像 ID；运行时传参 `--pull never` |
| `sandbox.dockerPath` / `sandbox.context` | `Install-Hardened.ps1` | 本机 `docker.exe` 绝对路径（要求 `nlink === 1`）与上下文名（默认 `desktop-linux`） |
| `sandbox.allowOutbound` | `Install-Hardened.ps1`（`true`） | 是否允许单次命令在获批参数 `network: "outbound"` 时切到 Docker `bridge` 网络 |

## 3. 环境变量与开发/测试脚本

### 环境变量表

| 变量名 | 生效范围 | 用途与安全行为 |
| --- | --- | --- |
| `HTTPS_PROXY` / `HTTP_PROXY` | 本地连接器 `proxyCandidates` | 若与 Windows 注册表代理均配置，连接器会与直连一起按队列轮询重连 Cloudflare `/bridge` |
| `AGENTDOCK_DOCKER_TEST` | `test/sandbox.test.mjs` | 显式启用真实 Docker 集成回归（默认测试镜像也可由环境变量指定，未设置时跳过真实容器用例） |
| `AGENTDOCK_ACL_REQUEST` | 内部临时变量（`local/windows-acl.mjs`） | 宿主 ACL 只读核查子进程传入路径参数，不读取文件内容 |
| `AGENTDOCK_BRIDGE_TOKEN` | 启动时主动 `delete` | 连接器进程启动前强制清除，避免污染工作区子进程环境 |
| `NODE_OPTIONS`、`NODE_PATH`、`NODE_TLS_REJECT_UNAUTHORIZED`、`NODE_EXTRA_CA_CERTS` | `Clear-NodeOverrides` | 每次执行管理或批准脚本前显式清空，防止劫持 Node 模块加载与 TLS 校验 |

### npm / pnpm 与 PowerShell 脚本矩阵

| 命令或脚本 | 职责与默认参数说明 |
| --- | --- |
| `pnpm run dev` | 运行 `wrangler dev --ip 127.0.0.1 --port 8797`，用于本地回环调试 Worker（需自行准备本地 `.dev.vars`） |
| `pnpm run deploy` | 运行 `wrangler deploy` 把 `cloud/index.mjs` 与 Durable Objects 发布到 Cloudflare |
| `pnpm run check` | 使用 `node --check` 校验 `cloud/`、`local/` 与 `container/runner.mjs` 语法 |
| `pnpm test` | 执行 `node --test test/*.test.mjs cloud/*.test.mjs`；Linux/macOS 会按条件自动跳过 15 项 Windows/Docker 用例 |
| `scripts/Setup.ps1` | 参数 `-StateDir`、`-Roots`（脚本默认值为示例路径，请显式传入目标工作区）、`-Origin`；初次生成 DPAPI 密钥与初始 `config.json` |
| `scripts/Install-NodeRuntime.ps1` | 下载 Node `24.22.1` win-x64 压缩包，校验官方 SHA-256 与 OpenJS 签名并写入私有工具链清单 |
| `scripts/Install-Hardened.ps1` | 参数 `-StateDir`、`-Workspace`、`-Image`（默认 `agentdock-dev:2026-10-28`）、`-Proxy`；部署版本化运行副本与 `.cmd` 启动器 |
| `scripts/Manage.ps1` | 参数 `-Action Start\|Stop\|Status\|Run\|Password`；使用进程创建时间 + 可执行路径校验与互斥锁避免复用失效 PID |
| `scripts/Rotate-Secrets.ps1` | 生成 `secrets.next.dpapi`，上传新 `BRIDGE_TOKEN` 与 `OWNER_PASSWORD_HASH` 到云端成功后再覆盖本地 `secrets.dpapi`（须先停机） |
| `scripts/acceptance-v2.mjs` / `verify-lifecycle.mjs` | 维护者显式运行的公网验收与停机重启探测脚本，测试数据均带有随机临时标识并执行清理 |

## 4. 轮换密钥与升级运行副本标准步骤

1. 先运行 `& "$env:USERPROFILE\.agentdock-bridge\Stop.cmd"` 确保 `supervisor.json` 与 `connector-process.json` 对应进程已退出。
2. 轮换密码与隧道密钥时，运行 `.\scripts\Rotate-Secrets.ps1`（若云端上传失败，`secrets.next.dpapi` 会保留以便修复网络后幂等重试）。轮换后旧 OAuth 授权代次失效，所有 MCP 客户端需使用 `Password.cmd` 展示的新密码重新登录。
3. 升级本地源码或容器依赖时，先运行 `pnpm test` 并重新执行 `docker build`，再运行 `.\scripts\Install-Hardened.ps1 -Workspace "<workspace-path>"` 刷新运行副本，最后重新执行 `pnpm run deploy` 与 `Start.cmd`。
