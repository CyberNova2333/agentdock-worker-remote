# 云端网关、OAuth 2.1 与中继交接

云端组件部署在 Cloudflare Workers 上，承担公开 HTTPS 接入、OAuth 2.1 授权与本地连接器中继三项职责。源码把授权协调与设备通道拆入两个独立的 SQLite Durable Objects（`AuthCoordinator` 与 `BridgeRelay`），避免慢速 HTTP 请求体或外部元数据拉取阻塞已认证的 MCP 调用与取消指令。

理解这套分层后，可以先沿[本地精确批准与防重放账本](local-approval-and-replay.md)查看连接器收到信封后的二次校验，或通过[代码地图](../code-map.md)直接定位测试文件。

## 入口路由与协议边界

[云端主入口](../../cloud/index.mjs)的 `route` 函数按路径和请求方法分发流量，并在进入任何状态锁之前完成主机名、Origin 与请求体上限检查：

1. **主机名与 CORS 检查**：生产环境要求请求匹配配置的 `PUBLIC_ORIGIN`（仅对 `127.0.0.1`、`localhost` 与 `[::1]` 放行回环测试请求）；URL 超过 `12000` 字节返回 414。[安全与输入校验](../../cloud/security.mjs)的 `allowedOrigin` 仅允许 `chatgpt.com`、`chat.openai.com` 及其受控预览域名，以及 `PUBLIC_ORIGIN` 自身。
2. **基础探针与入口页**：`GET /` 返回零脚本（`script-src` 被禁止，`default-src 'none'`）的网关说明页；`GET` 或 `HEAD /healthz` 转发至 `BridgeRelay` 的内部 `/status`，连接器在线时返回 HTTP 200（`{ "ok": true, "connectorOnline": true }`），离线或心跳超时返回 HTTP 503。
3. **设备长连接接入**：`GET /bridge` 必须携带 `Upgrade: websocket` 且通过 `BRIDGE_TOKEN` 恒定时间摘要校验（`equalSecret` 要求密钥长度不少于 32 字符），校验通过后转交 `BridgeRelay` 建立唯一活跃连接。
4. **流式限流与协议版本**：`/mcp` 检查 `MCP-Protocol-Version`（支持 `2025-03-26`、`2025-06-18` 与 `2025-11-25`），`OPTIONS` 仅返回预检头；对 `/register`（20 次 / 3600 秒）和 `/oauth/token`（120 次 / 60 秒）实施基于 `CF-Connecting-IP` 与 `BRIDGE_TOKEN` 哈希指纹的限流。
5. **缓冲读取先行**：对 `/mcp`、`POST /authorize`、`/oauth/token`、`/oauth/token/revoke` 与 `/register` 的 `POST` 请求体，先通过 `readLimited` 在 15 秒时限内完整读取（上限分别为 `1 MiB`、`8192` 字节与 `16384` 字节）并严格校验 UTF-8，再送入 `AuthCoordinator`。

## OAuth 2.1、代次隔离与乐观事务

授权状态由 `@cloudflare/workers-oauth-provider` 托管在 `AuthCoordinator` 中，所有实例名统一采用 `owner-v2-${generation}`，其中 `generation` 是 `OWNER_PASSWORD_HASH` 的 SHA-256 十六进制摘要。一旦通过秘密轮换修改所有者密码，Worker 会自动切换到全新的 Durable Object 实例，旧代次的客户端注册与令牌即时失效。

- **强制 PKCE S256 与权限映射**：`GET /authorize` 先按 `authorize: 30 / 600s` 限流，强制要求 `codeChallengeMethod === 'S256'` 且 `codeChallenge` 符合 43 位 Base64url 格式；授权范围仅限 `computer:read`、`computer:write`、`computer:execute` 与 `offline_access`，并自动补全 `computer:read`。同意书页面同时合并基础策略与 SDK 生成的 CSP 响应头，表单句柄有效期为 10 分钟。`POST /authorize` 校验 `Origin` 与表单编码后按 `password: 8 / 600s` 限流，再通过 `verifyOwnerPassword` 核对密码。
- **DCR、CIMD 与令牌轮换撤销**：网关启用了动态客户端注册（`/register`，限 `1..10` 个回调 URI，`client_name` 不超过 `120` 字符）及客户端元数据文档（CIMD）。令牌端点禁止重复表单键（`resource` 除外）、拦截已消费授权码，并在[授权状态存储](../../cloud/auth-store.mjs)中追踪刷新令牌家族：`refreshRecord.state !== 'current'` 时判定令牌复用并调用 `revokeFamily` 吊销整条授权链；若未获准 `offline_access`，响应会剔除 `refresh_token`。撤销端点 `/oauth/token/revoke` 会对 JWT `client_assertion` 载荷执行 UTF-8 解码，避免非 ASCII 客户端标识在撤销时失配。
- **分通道并发与版本号校验**：[授权事务协调](../../cloud/auth-transactions.mjs)结合[串行队列](../../cloud/auth-queue.mjs)实现乐观并发控制：外部 CIMD/JWKS 读取在提交锁外执行，各用途通道独立限制并发数（`authorization: 4`、`consent: 4`、`token: 8`、`mcp: 32`、`stop: 4`、`other: 4`），队列深度上限为 `64`、等待上限 `15000` 毫秒；准备阶段与提交阶段之间若 `revision` 发生变化则重试（最多 4 轮，总超时 25 秒），防止过时授权视图覆盖新吊销结果。

## WebSocket 中继、通道预算与活性判据

通过 `AuthCoordinator` 鉴权与作用域检查的 `/mcp` 请求会被封装为内部信封，转交单一命名实例 `BridgeRelay`（`primary`）执行派发。其中 `READ_TOOLS`（含 `computer_context` 等）、`WRITE_TOOLS`、`EXEC_TOOLS` 在云端只做基础作用域分类；具体工具白名单与参数边界由连接器再次收敛。

[中继状态与活性判定](../../cloud/relay.mjs)与[心跳时间窗口](../../cloud/liveness.mjs)共同维护设备在线状态：

- **单机独占与心跳窗口**：同一时刻仅允许一条处于有效窗口内的连接器 WebSocket；新连接获得 `FIRST_HEARTBEAT_GRACE`（`10000` 毫秒）宽限期，收到自动响应的 ping/pong 心跳帧后进入 `HEARTBEAT_MAX_AGE`（`65000` 毫秒）在线期，并由 Durable Object Alarm 到期清理失活连接。
- **停止通道隔离与取消匹配**：中继把 `stop_command` 划入独立通道（上限 `4` 并发，单客户端最多 `2` 个），其余普通 MCP 请求共享 `16` 并发槽位；超时时间固定为 `110000` 毫秒，超时返回 HTTP `504` 并提示操作可能已执行、切勿盲目重试。`notifications/cancelled` 通知按 `(clientId, requestId)` 精确匹配待决请求，阻止跨客户端误取消。

## 请求信封与常见边界行为

进入 `/bridge` 的授权信封结构如下（字段值均为脱敏示例）：

```json
{
  "type": "request",
  "id": "f6f9d2b0-1c43-4f10-9a77-0b1e7b8a0001",
  "body": {
    "jsonrpc": "2.0",
    "id": 12,
    "method": "tools/call",
    "params": { "name": "read_file", "arguments": { "path": "/workspace/README.md" } }
  },
  "authorization": {
    "userId": "owner",
    "clientId": "https://client.example.test/oauth.json",
    "scope": ["computer:read"]
  },
  "issuedAt": 1762800000000,
  "deadline": 1762800110000
}
```

下表总结了云端边界对典型正常请求与异常边界的处置结果：

| 场景或输入条件 | 云端判定与输出 | 依据路径与断言 |
| --- | --- | --- |
| 携带有效访问令牌与匹配的 `computer:read` 调用 `read_file` | `AuthCoordinator` 返回内部授权信封，`BridgeRelay` 通过 WebSocket 转发 | [云端集成测试](../../cloud/integration.test.mjs) |
| 使用已轮换的旧 `refresh_token` 再次换取令牌 | `AuthStore.revokeFamily` 吊销整族授权并返回 `invalid_grant` | [OAuth 加固测试](../../cloud/oauth-hardening.test.mjs) |
| 授权码未使用 PKCE `S256` 或 `POST /authorize` 跨站提交 | 在入口或授权分支直接返回 HTTP `400` 或 `403` | [安全校验测试](../../cloud/security.test.mjs) |
| 非 ASCII `clientId` 通过 `client_assertion` 撤销令牌 | 经 UTF-8 Base64url 解码定位记录并吊销同族全部刷新凭证 | [OAuth 加固测试](../../cloud/oauth-hardening.test.mjs) |
| 连接器未上线或心跳超 65 秒无响应时请求 `/mcp` | 返回 HTTP 503，响应明确声明请求未被重放 | [中继与传输测试](../../cloud/transport.test.mjs) |

## 定向验证入口

可在仓库根目录通过 Miniflare 与 Node 内置测试器单独回归云端模块：

```sh
node --test cloud/*.test.mjs
```

如需对照本地连接器如何消费上述信封并实施精确批准，请继续阅读[本地精确批准与防重放账本](local-approval-and-replay.md)，或回到[一次真实操作的阶段交接](../walkthroughs/one-real-run.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
