# 本地精确批准与防重放账本

本地连接器运行在受保护的宿主环境中，在云端中继与容器执行器之间增加第二道控制闸门：云端 OAuth 令牌只证明调用方获得过会话授权，真正触及项目文件或启动 Bash 命令前，仍必须在本地核对请求信封、等待人工确认精确参数，并在副作用发生前完成一次性批准消费与防重放登记。

云端信封如何打包并发起连接，见[云端网关、OAuth 2.1 与中继交接](cloud-oauth-and-relay.md)；批准通过后容器如何挂载项目与约束文件替换，见[容器沙箱与文件安全策略](container-sandbox-and-file-policy.md)。

## 宿主启动边界与代理链

[连接器入口](../../local/connector.mjs)从受保护状态目录（默认 `%USERPROFILE%\.agentdock-bridge`）读取 `config.json`，并调用 `loadSecrets` 解密本机凭据。当前生产秘密存储显式检查 `process.platform === 'win32'`，通过最小环境变量和系统目录工作路径启动独立 `powershell.exe` 子进程，从 Windows DPAPI 加密文件 `secrets.dpapi` 中导出密钥到内存后立即剥离 `AGENTDOCK_BRIDGE_TOKEN` 等进程环境变量，不向容器或子进程传递子进程报错细节。非 Windows 平台无法直接加载该 DPAPI 凭据存储，但可以在 Linux/macOS 开发环境运行本地模块回归测试。

`BridgeConnector` 通过 `proxyCandidates` 依次尝试环境变量 `HTTPS_PROXY`/`HTTP_PROXY`、Windows 注册表 `Internet Settings` 代理配置与直连路由，以 `Bearer BRIDGE_TOKEN` 建立 `wss://<origin>/bridge` 连接（禁用压缩与重定向，单帧上限 `1,200,000` 字节）。连接每 `20` 秒发送 ping 心跳帧，超过 `65000` 毫秒未收到 `pong` 即断开重连，退避上限 `30` 秒加随机抖动，并每秒轮询 `stop.request` 以响应受控停机。

## 信封校验与十项工具策略

收到云端发来的 `request` 帧后，连接器调用[本地请求策略](../../local/request-policy.mjs)的 `validateRequestEnvelope` 执行离线二审：

- **信封与时限预算**：校验 `id` 格式与时间窗口（`issuedAt` 最多允许领先本地时钟 `5000` 毫秒，`deadline - issuedAt <= 110000` 毫秒且未过期），并用 `boundedJson` 限制 JSON 结构总节点数不超过 `20000`、深度不超过 `32`。
- **本地工具与作用域白名单**：基础 MCP 方法（`initialize`、`ping`、`tools/list`、`notifications/*`）要求 `computer:read`；工具调用严格收敛为 `toolScopes` 中的 10 个工具，其中 `write_file`/`edit_file`/`delete_file` 要求 `computer:read` + `computer:write`，`exec_command`/`command_status`/`stop_command` 要求 `computer:read` + `computer:execute`。即便云端初步放行，不在 `toolScopes` 内的旧名称也会在本地拒绝。

## 精确批准状态机与记录预算

`APPROVAL_EXEMPT_TOOLS` 仅豁免只读上下文与任务控制三项工具（`computer_context`、`command_status`、`stop_command`）；其余 7 项文件或命令工具调用首次到达时均要求本机交互确认：

1. **绑定精确摘要**：`approvalSubject` 把 `{ origin, authorization, method, params }` 规范化排序并计算 SHA-256 摘要（`digest`）。该摘要包含客户端标识、授予作用域、网关源、方法名和完整参数，刻意排除外层客户端 JSON-RPC `id`，允许客户端在人工批准后使用新的 RPC ID 重试同一操作；若路径、内容、模式或 `network` 等任一参数变更，摘要改变并重新要求批准。
2. **紧凑序列化与发布预算**：[批准存储](../../local/approval-store.mjs)限定待批准请求（`.request.json`）上限为 `1200000` 字节（约 1.2 MB），已批准标记（`.approved.json`）上限为 512 字节。`atomicJson` 在创建临时文件前先按紧凑 JSON 计算最终 UTF-8 字节长度，超限直接抛出 `ApprovalRecordTooLargeError`（返回 `APPROVAL_RECORD_TOO_LARGE`），防止缩进放大或超长参数污染本机批准界面；发布通过只读独占文件（`wx`）、刷盘后硬链接原子创建，避免覆盖同名批准。
3. **队列容量与人工确认界面**：[批准状态机](../../local/approvals.mjs)限制单条待批记录有效期 `5` 分钟（`300000` 毫秒），队列上限 `64` 条、单客户端上限 `8` 条；目录条目超过 `1024` 时拒绝入队并要求维护清理。用户通过 `Approve.cmd` 启动的[批准终端界面](../../local/approval-cli.mjs)会使用 `safeText` 将终端控制字符与 Unicode 双向格式化字符转义为字面 `\uXXXX`，在复核原文件摘要一致且用户输入精确口令 `APPROVE <uuid>` 后，才写入一次性的 `.approved.json`。

## 消费顺序与三类防重放账本

对需要批准的请求，`BridgeConnector` 严格按以下先后顺序跨越异步边界：

1. **预查持久账本**：调用 `RequestReceipts.inspect` 只读检查 `<stateDir>/request-receipts/<sha256(id)>.json`；若该桥接请求 ID 已执行或存在摘要冲突，直接拒绝而不再生成新的待批准记录。
2. **先消费再登记**：当 `LocalApprovals.authorize` 找到匹配的 `.approved.json` 时，**先同步删除 `.approved.json` 与 `.request.json`**，随后再调用 `RequestReceipts.claim` 写入 24 小时持久账本（最多 `10000` 条，单条上限 512 字节，遇损坏或半写入文件按 `duplicate_or_incomplete` 失败关闭）。
3. **控制通道与停止隔离**：豁免工具与只读协议请求使用内存态[防重放账本](../../local/receipts.mjs)——普通控制采用 `TransientReceipts`（总上限 `1000`、单客户端 `100`、存活 `120` 秒），而 `stop_command` 独占 `StopReceipts`（上限 `128`、满时按 FIFO 淘汰最旧记录）以及本地 `4` 并发槽（单客户端限 `2`），确保普通控制流打满时仍能下发停止指令。

## 宿主目录加固与典型判定表

在 Windows 宿主侧，[状态安全校验](../../scripts/State-Safety.ps1)与[安装脚本](../../scripts/Install-Hardened.ps1)共同约束运行环境：状态目录 `%USERPROFILE%\.agentdock-bridge` 与[固定 Node 运行时目录](../../scripts/Install-NodeRuntime.ps1) `%USERPROFILE%\.agentdock-toolchains` 必须位于工作区之外，检查整条祖先路径的所有者与写权限（仅当前用户 SID 与 `SYSTEM` 可写入，拒绝符号链接、目录联接与多硬链接），每次启动与批准前核对官方 Node `24.22.1` 的 SHA-256 并清除 `NODE_OPTIONS`、`NODE_PATH`、`NODE_TLS_REJECT_UNAUTHORIZED`、`NODE_EXTRA_CA_CERTS` 环境变量。

首次触发待批准请求时，客户端收到的 JSON-RPC 错误载荷形如下例（已脱敏）：

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "error": {
    "code": -32001,
    "message": "Local approval is required. Open the protected Approve.cmd on your computer, review this request, then retry the same tool arguments.",
    "data": {
      "code": "LOCAL_APPROVAL_REQUIRED",
      "approval_id": "0d9c8e12-41af-4f87-9d18-7a2b5c9f1104",
      "expires_at": "2026-11-10T04:05:00.000Z",
      "tool": "read_file"
    }
  }
}
```

典型批准与重放场景的可观察行为如下：

| 输入与队列条件 | 连接器行为与结果 | 验证依据 |
| --- | --- | --- |
| 首次调用 `read_file` 等敏感工具 | 写入 `.request.json` 并返回 `LOCAL_APPROVAL_REQUIRED`，文件与命令均未触碰 | [连接器集成测试](../../test/connector.test.mjs) |
| 5 分钟内输入 `APPROVE <uuid>` 并以同参数、新 RPC ID 重试 | 先删 `.approved.json` 与 `.request.json`，再写 `RequestReceipts`，随后仅执行一次 | [连接器集成测试](../../test/connector.test.mjs) |
| 重试时修改路径或开启 `network: "outbound"` | `approvalSubject` 摘要变化，原有批准不匹配并创建新待批记录 | [连接器集成测试](../../test/connector.test.mjs) |
| 携带深层元数据使紧凑 JSON 超过 `1,200,000` 字节 | 发布前拒绝并返回 `APPROVAL_RECORD_TOO_LARGE`，不生成损坏文件 | [批准预算测试](../../test/approval-budget.test.mjs) |
| 断线或重连后使用同一桥接请求 ID 重试 | `RequestReceipts` 拦截并返回 `already_attempted`，不重放工具副作用或结果 | [控制账本测试](../../test/control-receipts.test.mjs) |

## 定向验证入口

在已安装依赖的开发环境中运行以下定向回归即可核对上述边界（Windows ACL、Node 签名与管理进程检查在非 Windows 宿主会自动跳过）：

```sh
node --test test/connector.test.mjs test/approval-budget.test.mjs test/control-receipts.test.mjs test/secret-process.test.mjs
```

通过批准并登记后，请求正式交由 Docker 执行：继续阅读[容器沙箱与文件安全策略](container-sandbox-and-file-policy.md)，或通过[代码地图](../code-map.md)核对对应源码与测试文件。

证据状态：除特别标注外，本页基于当前源码已确认。
