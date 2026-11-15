---
title: 接口与扩展契约
description: 详述 AgentDock Bridge 的安全假设、云端 HTTP 与 OAuth 2.1 契约、10 项 MCP 工具上限、本机批准/防重放顺序及容器沙箱约束。
---

# 接口与扩展契约

本页定义跨云端边缘网关、本机连接器与隔离容器三层边界的**对外协议与安全不变量**，并回答二次开发或接入客户端时的扩展问题。

## 能力边界与安全假设

系统围绕“**个人所有、按次批准、隔离执行**”构建，以下安全边界直接由源码硬编码约束：

| 边界项 | 源码保证 | 不覆盖的风险范围 |
| --- | --- | --- |
| 身份模型 | 单所有者模式（`userId: "owner"`），`PUBLIC_ORIGIN` 限定访问主机与 CORS | 不支持多用户隔离；修改密钥会联动失效全部历史授权 |
| 传输信任 | Cloudflare Workers 强制 HTTPS（回环测试除外），同意书页面零脚本 CSP（禁止一切内联/外链 JS） | Cloudflare 与上游大模型平台仍可看到经过 `/mcp` 的工具参数与响应正文 |
| 本地批准 | 非豁免工具绑定完整参数 SHA-256 摘要，先消费 `.approved.json` 再写 24 小时 `RequestReceipts` | 批准通过后的网络超时（`504`）不等于无副作用；禁止自动重放同一桥接 ID |
| 工程目录访问 | 单一绝对工作区挂载为 `/workspace`；跳过软链接、多硬链接与含显式 NTFS ACL 的替换 | 项目根目录内对已批准的工具刻意可读写；工程内密钥文件与不可信提示词须靠人工在 `Approve.cmd` 审阅 |
| 宿主平台 | `loadSecrets`（DPAPI）与 `createWindowsReplacementGuard`（NTFS ACL）明确依赖 `win32` | Linux / macOS 仅支持 Worker 部署与跨平台回归测试，不包含原生密钥库 |

---

<span id="cloud-oauth-relay"></span>

## 云端 HTTP 与 OAuth 2.1 接口契约

由 `cloud/index.mjs` 与 `cloud/relay.mjs` 对外暴露的端点与协议限制如下：

### 端点与限流矩阵

| 路径 | 方法与认证 | 限流与负载上限 | 行为与状态码 |
| --- | --- | --- | --- |
| `/` | `GET`（公开） | — | 返回零脚本 Primer 风格网关说明页，展示 `PUBLIC_ORIGIN/mcp` |
| `/healthz` | `GET` / `HEAD`（公开） | — | 查询 `BridgeRelay /status`：在线返回 `200`（`{ "ok": true, "connectorOnline": true }`），否则 `503` |
| `/bridge` | `GET` `Upgrade: websocket`，`Bearer <BRIDGE_TOKEN>` | 密钥不少于 32 字符 | 建立单连接器 WebSocket；若已有在线或宽限期内连接返回 `409` |
| `/.well-known/oauth-authorization-server`<br>`/.well-known/oauth-protected-resource/mcp` | `GET`（公开） | — | OAuth 2.1 元数据发现，声明受保护资源 `<origin>/mcp` 与四项作用域 |
| `/register` | `POST`（公开 DCR） | `20 次 / 3600 秒`；Body 上限 `16,384 B` | 动态注册回调 URI（1–10 个），`client_name` 最长 `120` 字符（注册有效期 90 天） |
| `/authorize` | `GET` / `POST`（所有者登录） | `GET: 30 / 600 秒`；`POST: 8 / 600 秒`；Body `8,192 B` | 强制 PKCE `S256`（43 字符）；自动包含 `computer:read`；表单句柄 `10` 分钟有效；校验 `Origin` 与 PBKDF2-SHA256 密码 |
| `/oauth/token` | `POST`（`x-www-form-urlencoded`） | `120 次 / 60 秒`；Body `16,384 B` | 禁止重复表单参数（`resource` 除外）；拦截已用授权码；检测刷新令牌复用并整族撤销 |
| `/oauth/token/revoke` | `POST`（`x-www-form-urlencoded`） | Body `16,384 B` | 支持表体 `client_id`、Basic 或 UTF-8 解码 JWT `client_assertion` 撤销同族凭证 |
| `/mcp` | `POST`（OAuth Bearer） / `OPTIONS` | `MAX_RPC_BYTES = 1 MiB`；回传 `2 MiB` | JSON-RPC 2.0；校验 `MCP-Protocol-Version`（`2025-03-26`、`2025-06-18`、`2025-11-25`）；超时 `110s` 返回 `504` |

### OAuth 作用域、代次与中继通道

- **作用域清单**：`computer:read`（基础方法与只读工具）、`computer:write`（写/改/删文件，必同时具备 `computer:read`）、`computer:execute`（执行与控制命令，必同时具备 `computer:read`）、`offline_access`（允许保留 30 天刷新令牌；未获批准则令牌端点响应删除 `refresh_token`）。访问令牌默认有效期 `3600` 秒。
- **密码代次隔离**：`AuthCoordinator` 实例名为 `owner-v2-${sha256(OWNER_PASSWORD_HASH)}`；一旦密码改变即切到全新 SQLite Durable Object，旧令牌立即失效。
- **CORS 策略**：仅向 `PUBLIC_ORIGIN`、`https://chatgpt.com`、`https://chat.openai.com` 及其受控子域返回 CORS 允许头，并显式暴露 `WWW-Authenticate`、`MCP-Session-Id`、`MCP-Protocol-Version`。
- **并发与活性窗口**：`BridgeRelay` 等待首包心跳宽限 `10,000 ms`（`FIRST_HEARTBEAT_GRACE`），收到响应后在线上限 `65,000 ms`（`HEARTBEAT_MAX_AGE`）。普通 `/mcp` 通道共享 `16` 个并发槽，`stop_command` 独占 `4` 个并发槽（单客户端上限 `2` 个）。

---

<span id="local-approval-replay"></span>

## 本地精确批准、工具清单与防重放契约

### 10 项 MCP 工具权限与参数边界

`local/request-policy.mjs` 的 `toolScopes` 与 `local/tools.mjs` 的 `TOOL_DEFINITIONS` 共同定义了连接器实际开放的 10 个工具（注：云端 `cloud/index.mjs` 为兼容旧词表仍保留 `agentdock_context` 与 `get_command` 的作用域归类，但本地策略白名单严格只放行下表 10 项工具）：

| 工具名称 | 所需作用域 | 是否免 `Approve.cmd` | 硬性输入与输出约束 |
| --- | --- | --- | --- |
| `computer_context` | `computer:read` | 是（豁免） | 返回工作区挂载路径、容器镜像摘要、并发限制与安全提醒 |
| `list_directory` | `computer:read` | 否（须批准） | 按文件系统顺序返回目录条目；`limit` 范围 `1..1000`（默认 `200`），不跟进符号链接 |
| `read_file` | `computer:read` | 否（须批准） | 按 UTF-8 完整字符切分；`max_bytes` 范围 `1..262144`（默认 `65536`）；拒绝二进制与非法 UTF-8；全量读取返回 `sha256` |
| `search_files` | `computer:read` | 否（须批准） | 字面匹配（`content` / `name`）；默认忽略 `.git`、`node_modules`、`.wrangler` 与 `> 1 MiB` 文件；预算上限 `128` 目录 / `5000` 条目 / `2000` 文件 / `16 MiB` / `5s` |
| `write_file` | `computer:read` + `computer:write` | 否（须批准） | 内容上限 `1 MiB` UTF-8；覆盖已有文件须显式传 `overwrite: true`（可选 `expected_sha256`） |
| `edit_file` | `computer:read` + `computer:write` | 否（须批准） | `old_text` 在文件中必须唯一出现；支持 `expected_sha256` 乐观并发检查；结果上限 `1 MiB` |
| `delete_file` | `computer:read` + `computer:write` | 否（须批准） | 仅删除单一普通文件（不可删目录或递归删除）；支持 `expected_sha256` |
| `exec_command` | `computer:read` + `computer:execute` | 否（须批准） | 命令上限 `32,768 B`；`sync` 时限 `100..60,000 ms`（默认 `30s`），`background` `100..3,600,000 ms`（默认 `300s`）；输出上限 `131,072 B`；`network` 默认 `none`；最多 `4` 个活跃命令、`64` 条内存历史 |
| `command_status` | `computer:read` + `computer:execute` | 是（豁免） | 校验 `job.ownerClient === authorization.clientId`，仅限当前连接器会话期内任务 |
| `stop_command` | `computer:read` + `computer:execute` | 是（豁免） | 校验客户端归属后执行 `docker rm -f` 与进程树终止；幂等重试安全 |

> **兼容注意**：`local/sandbox.mjs` 在只读状态查询内也兼容识别 `get_command`，但因 `toolScopes` 与 `TOOL_DEFINITIONS` 未开放该工具名，远端 MCP 调用应统一使用 `command_status`。

### 本地批准与防重放顺序契约

1. **信封预算与结构**：连接器使用 `boundedJson` 限定单条请求不超过 `20,000` 个 JSON 节点与 `32` 层嵌套；信封时效窗口不超过 `110` 秒。
2. **批准对象摘要与预算**：`approvalSubject` 对 `{ origin, authorization, method, params }` 规范排序并求 SHA-256；紧凑 JSON 待批准文件上限 `1,200,000` 字节（超限返回 `APPROVAL_RECORD_TOO_LARGE`），批准标记上限 `512` 字节，单次批准有效期 `5` 分钟，全局待批队列上限 `64`（单客户端 `8`）。
3. **消费与账本顺序**：敏感调用进入容器前，按“先 `RequestReceipts.inspect` → 再 `LocalApprovals.authorize`（**校验匹配并 `unlink` 删除 `.approved.json` 与 `.request.json`**）→ 再 `RequestReceipts.claim`（写 `24` 小时持久账本，上限 `10,000` 条）→ 最后调用容器运行器”严格执行。
4. **控制防重放分离**：普通豁免/协议调用使用 `TransientReceipts`（`1000` 条 / 单客户端 `100` / `120s`）；`stop_command` 使用独立 `StopReceipts`（`128` 条 FIFO 淘汰），互不饿死。

---

<span id="container-sandbox-policy"></span>

## 容器沙箱、文件策略与 ACL 边界

每次命令或文件调用均由 `local/sandbox.mjs` 传入严格受限的 Docker 参数启动一次性容器：

```text
docker create --rm -i --pull never --name agentdock-<uuid>
  --label cbnv.agentdock.install=<24-hex> --log-driver none --restart no
  --read-only --user 0:0 --cap-drop ALL --cap-add SETUID --cap-add SETGID
  --security-opt no-new-privileges=true --pids-limit 256
  --memory 2g --memory-swap 2g --cpus 2 --network <none|bridge>
  --mount type=bind,src=<workspace>,dst=/workspace
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777
  --tmpfs /home/developer:rw,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=700
  <sha256-pinned-image>
```

- **租约心跳与降权执行**：容器 PID 1（`container/runner.mjs`）每 `2` 秒核查宿主标准输入写入的 `{"type":"lease"}`（宿主每 `5` 秒发送一次），超 `20` 秒断连或关闭即以退出码 125 自杀；实际命令（`bash --noprofile --norc`）与文件进程（`file-worker.mjs`，固定 `allowExec: false`）均降权为 UID/GID `1000`。
- **路径、编码与链接守卫**：`local/file-safety.mjs` 禁止孤立 UTF-16 代理项、`\0`、Windows 设备名（`con`/`nul`/`com1` 等）、NTFS 备用流（`:`）、逐级 `lstat` 命中符号链接/目录联接与多硬链接（`nlink !== 1`）；读取后校验 `dev:ino:size:mtimeMs:ctimeMs` 稳定；新建文件先用 `O_EXCL` 写同目录临时文件再原子硬链接发布。
- **Windows DACL 替换守卫**：在 `win32` 宿主上，`edit_file` 与 `write_file(overwrite=true)` 前置调用只读 PowerShell 检查宿主真实路径与所有父目录，发现受保护 ACL、非规范顺序、显式非继承权限规则或所有者不匹配时直接拒绝覆盖。
- **清理故障降级**：`docker rm -f` 无法确认容器已清除时置 `closed = true`，立即拒绝所有新文件与命令调用，同时保留属主客户端对自己已有任务的 `command_status` / `stop_command`。

---

## 扩展与集成 FAQ

### 如何临时关闭命令执行或禁止容器出网？

可在 `%USERPROFILE%\.agentdock-bridge\config.json` 中手动将 `allowExec` 或 `sandbox.allowOutbound` 设为 `false`，然后重启连接器（`Stop.cmd` → `Start.cmd`）。注意：每次重新运行 `Install-Hardened.ps1` 时，脚本默认写入 `allowExec: true` 与 `sandbox.allowOutbound: true`；若需长期禁用，应在重新安装后或修改安装脚本模板时显式关闭。

### 如何更换绑定的项目根目录或修改 `PUBLIC_ORIGIN`？

- 更换唯一挂载的工作区路径：停止连接器后重新运行 `.\scripts\Install-Hardened.ps1 -Workspace "<new-workspace-path>"`。系统拒绝一次配置多个根目录或把工作区设为磁盘根目录/包含逗号的路径。
- 更换云端网关域名：更新 `wrangler.jsonc` 中的 `vars.PUBLIC_ORIGIN`，重新执行 `pnpm run deploy`，并在本机 `config.json` 更新 `origin` 后重启连接器；现有待批准请求与 OAuth 客户端回调将按新源重新对齐。

### 二次开发新增一个 MCP 工具必须同时改哪些位置？

为了维持双边纵深防御，至少须同步修改以下四处边界并补充回归测试：
1. `cloud/index.mjs`（将该工具纳入 `READ_TOOLS` / `WRITE_TOOLS` / `EXEC_TOOLS` 作用域归类）；
2. `local/request-policy.mjs`（加入 `toolScopes` 白名单，若非只读豁免则维持 `requiresApproval` 默认强制批准）；
3. `local/tools.mjs` 与 `local/sandbox.mjs`（严格编写 JSON Schema `additionalProperties: false` 与参数边界检查）；
4. `test/` 与 `cloud/` 对应测试文件，保证无效 Unicode、超限负载与越权调用均被拦截。
