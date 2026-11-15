# 术语表

本页解释跨多个源码模块反复出现的项目专有名词、配置键与状态码。需要追查某一机制的完整设计边界时，按右侧链接进入对应模块或主流程。

| 术语 | 项目里的意思 | 延伸阅读 |
| --- | --- | --- |
| `AuthCoordinator` | 云端管理 OAuth 2.1 状态与授权事务的 SQLite Durable Object，实例名随所有者密码哈希切换代次 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `AuthStore` | `AuthCoordinator` 内的请求级 KV 适配器，先把读写暂存到内存再通过 SQLite 单事务原子提交 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `AuthTransactions` | 负责并发通道限流、乐观版本号校验与有限重试的授权事务协调器 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `AuthQueue` | 序列化提交操作、并在超时或客户端取消时先一步丢弃过期等待任务的队列 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `OAuthProvider` | 来自 `@cloudflare/workers-oauth-provider` 的 OAuth 2.1 核心处理器，被包装在 `AuthCoordinator` 内运行 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `PKCE` (`S256`) | 公共与动态客户端授权必须携带的 SHA-256 挑战校验参数，缺省或降级即被 `/authorize` 拒绝 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `CIMD` / `DCR` | 通过外部元数据文档（CIMD）或 `/register` 动态注册（DCR）接入的 OAuth 客户端登记方式 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `BridgeRelay` | 托管单条本机连接器 WebSocket、派发请求信封并执行 IP 速率限制与通道并发限制的 Durable Object | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `BridgeConnector` | 运行在本地宿主上的连接器主类，负责代理探测、重连心跳、信封二审与串行批准/记账 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `PUBLIC_ORIGIN` | Cloudflare Worker 的公开 HTTPS 根地址配置，同时约束入口主机检查、CORS 与同意书提交来源 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `BRIDGE_TOKEN` | 本地连接器接入 `/bridge` 时使用的共享 Bearer 密钥，长度至少 32 字符，以 DPAPI 加密存储在本地 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `OWNER_PASSWORD_HASH` | 云端保存的 PBKDF2-SHA256 密码哈希；其摘要变化会改变授权代次前缀 `owner-v2-*`，旧令牌即时失效 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `MCP-Protocol-Version` | `/mcp` 端点校验的协议版本请求头，仅接受 `2025-03-26`、`2025-06-18` 与 `2025-11-25` | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `CF-Connecting-IP` | Cloudflare 注入的真实客户端来源 IP 头，用于结合 `BRIDGE_TOKEN` 计算不可反推的限流指纹 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `FIRST_HEARTBEAT_GRACE` | 连接器新建 WebSocket 后等待首包心跳的宽限时间（`10000` 毫秒） | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `HEARTBEAT_MAX_AGE` | 收到有效 `pong` 后允许继续判定连接器在线的最长存活间隔（`65000` 毫秒） | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `MAX_RPC_BYTES` / `MAX_REPLY_BYTES` | `/mcp` 入站 RPC 上限（`1 MiB`）与连接器回传结果帧上限（`2 MiB`） | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `computer:read` / `computer:write` / `computer:execute` / `offline_access` | 网关四项 OAuth 权限作用域，分别控制读、写、容器命令执行与 30 天刷新令牌保留 | [云端网关、OAuth 2.1 与中继交接](modules/cloud-oauth-and-relay.md) |
| `validateRequestEnvelope` / `boundedJson` | 连接器本地执行的信封有效期、JSON 树节点/深度预算（20000 节点 / 32 层）和作用域二审函数 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `toolScopes` / `APPROVAL_EXEMPT_TOOLS` | 本地连接器认可的 10 个 MCP 工具权限映射，以及豁免人工确认的 3 个只读/控制工具清单 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `LocalApprovals` / `approvalSubject` | 本地待批准队列状态机与精确摘要构建器；摘要绑定网关源、客户端、权限、方法与完整参数，排除 RPC ID | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `LOCAL_APPROVAL_REQUIRED` | 敏感工具首次调用且尚无有效人工批准时返回的错误码，提示用户通过 `Approve.cmd` 核对并重试 | [一次真实操作的阶段交接](walkthroughs/one-real-run.md) |
| `ApprovalRecordTooLargeError` / `APPROVAL_RECORD_TOO_LARGE` / `atomicJson` | 当待批准请求按紧凑 JSON 超过 `1,200,000` 字节时在落盘前抛出的错误及原子硬链接写入 helper | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `safeText` | 批准交互界面用来转义终端控制符与 Unicode 双向控制符、防止混淆视觉欺骗的函数 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `RequestReceipts` / `already_attempted` | 24 小时持久化的已执行桥接请求 ID 账本（上限 10000 条），阻止断线或重放触发二次副作用 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `TransientReceipts` / `StopReceipts` | 面向普通控制流量（1000 条 / 120 秒）与 `stop_command`（128 条按 FIFO 淘汰）的内存防重放账本 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `DPAPI` / `Assert-PrivateState` | Windows 当前用户数据保护接口与 PowerShell 状态目录、祖先路径及所有者 ACL 强制检验函数 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `%USERPROFILE%\.agentdock-bridge` | Windows 默认受保护本机状态目录，集中保存 `config.json`、DPAPI 凭据、运行副本、账本与生成后的 `.cmd` 启动器 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `APPROVE <uuid>` | 本机批准终端内要求用户核对完整 JSON 参数后手工输入的逐字确认口令 | [本地精确批准与防重放账本](modules/local-approval-and-replay.md) |
| `createSandboxRuntime` / `queryDockerState` | 创建单工作区只读 Docker 沙箱运行时的入口函数，以及仅对只读初始查询生效一次重试的封装 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |
| `cleanupConfirmed` / `cleanup_confirmed` / `closed` | 标记 `docker rm -f` 是否得到守护进程确认的标志及运行时全局关闭状态；未确认时置 `closed` 为 `true` 并封锁新操作 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |
| `createFilePolicy` / `nlink` / `fileLocks` / `isWellFormed` | 容器内路径逐级 `lstat` 与 `dev:ino` 防竞争策略、单硬链接要求、同路径写锁及 UTF-16 合法性检查 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |
| `createWindowsReplacementGuard` | 在 Windows 上对 `edit_file` 与覆盖写前置核查宿主文件与父链 NTFS DACL 的只读守卫 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |
| `exec_command` / `command_status` / `stop_command` | 启动、查询与停止隔离容器 Bash 任务的 3 个命令类 MCP 工具，查询与停止受客户端归属约束 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |
| `computer_context` / `list_directory` / `read_file` / `write_file` / `edit_file` / `delete_file` / `search_files` | 返回工作区约束以及在 `/workspace` 下执行有界目录浏览、UTF-8 读写、精确替换、单文件删与检索的工具集 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |
| `network: "outbound"` | 显式允许单次命令容器启用 Docker `bridge` 出网的参数值，必须通过配置开关与本机人工精确批准 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |
| `allowExec` | 控制本机沙箱是否开放 `exec_command`（而 `file-worker.mjs` 内部始终固定为 `false`）的配置字段 | [容器沙箱与文件安全策略](modules/container-sandbox-and-file-policy.md) |

证据状态：除特别标注外，本页基于当前源码已确认。
