import type { ApiCatalogSpec } from './api-types'

export const apiSpecZh: ApiCatalogSpec = {
  project: 'AgentDock Bridge · 网关端点与 MCP 工具参考',
  subtitle:
    '覆盖 Cloudflare Worker OAuth 2.1 + PKCE 网关端点、WSS 设备中继、Approve.cmd 精确批准沙箱约束，以及 10 个核心 MCP 工作区工具。',
  environments: [
    { label: '生产 Worker 域名', value: 'https://bridge.example.com' },
    { label: '本地 Wrangler 调试', value: 'http://127.0.0.1:8797' },
  ],
  searchPlaceholder: '搜索 OAuth 端点、MCP 工具名或沙箱约束…',
  emptyText: '没有找到匹配的端点或 MCP 工具。',
  labels: {
    allGroups: '全部',
    canDo: '✅ 能做到',
    cannotDo: '⛔ 明确限制 / 拒绝条件',
    params: '参数、作用域与校验规则',
    paramName: '参数 / 字段',
    paramLocation: '位置',
    paramType: '类型',
    paramRequired: '要求',
    paramDesc: '说明与硬上限',
    responses: '响应状态与错误码',
    examples: '标准调用示例',
    responseSample: '标准返回示例',
    copy: '复制',
    copied: '已复制',
    noParams: '该端点无需额外调用参数。',
    required: '必填',
    optional: '可选',
    deepDocs: '查看深入安全契约',
    totalItems: '项端点/工具',
    envLabel: '请求基址切换',
    mobilePicker: '切换端点或 MCP 工具',
    defaultLabel: '默认',
    plainIndexToggle: '纯文本检索与打印索引（Ctrl+K 站内搜索定位）',
  },
  groups: [
    { id: 'oauth', title: '边缘网关与 OAuth 2.1' },
    { id: 'mcp-read', title: '只读与上下文 MCP 工具' },
    { id: 'mcp-exec', title: '写入与容器执行 MCP 工具' },
  ],
  items: [
    {
      id: 'edge-health-bridge',
      group: 'oauth',
      kind: 'GET',
      title: '服务体检与连接器长连接桥',
      signature: 'GET /healthz · WSS /bridge',
      auth: 'healthz 公开 · bridge Bearer BRIDGE_TOKEN',
      stability: '网关基石',
      summary:
        '/healthz 检查网关与连接器实时在线状态（心跳超 65 秒判离线）；/bridge 供 Windows 受保护连接器以至少 32 字符密钥建立单条反向长连接。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看网关HTTP与心跳契约',
      capabilities: [
        '本地连接器主动拨号 WSS /bridge，无需在家庭或办公路由器开放任何入站端口',
        '单条活动 WSS 连接与 10s 首心跳宽限（FIRST_HEARTBEAT_GRACE）；空闲/孤立旧连接按 65s 超时回收',
      ],
      limitations: [
        '连接器掉线时 /healthz 返回 503；若已存在活跃或宽限期长连接，新 /bridge 建连直接返回 409',
        '当前生产连接器凭据 loadSecrets 与 ACL 检查严格依赖 Windows x64（DPAPI + NTFS DACL）',
      ],
      params: [
        {
          name: 'Authorization (WSS /bridge)',
          location: 'header',
          type: 'Bearer <BRIDGE_TOKEN>',
          required: true,
          description: '最小长度 32 字符的服务连接器长连接口令，禁止与浏览器 OAuth Token 混用。',
        },
      ],
      responses: [
        {
          status: '200 OK (/healthz)',
          tone: 'ok',
          summary: '网关与连接器在线',
          example: `{ "ok": true, "connectorOnline": true }`,
        },
        {
          status: '503 Offline / 409 Conflict',
          tone: 'err',
          summary: '无在线连接器返回 503；重复设备抢占长连接返回 409',
        },
      ],
      examples: [
        {
          label: 'curl (/healthz)',
          lang: 'sh',
          code: `curl -sS "{{BASE_URL}}/healthz"`,
        },
      ],
    },
    {
      id: 'edge-oauth21',
      group: 'oauth',
      kind: 'POST',
      title: 'OAuth 2.1 + PKCE 授权与令牌轮换',
      signature: 'POST /register · /authorize · POST /oauth/token · /oauth/token/revoke',
      auth: 'PKCE S256 (43 字符) + PBKDF2-SHA256',
      stability: '双 DO 状态一致',
      summary:
        '通过 AuthCoordinator DO 执行动态客户端注册（DCR，20/3600s）、零脚本 CSP 同意页授权、S256 兑换 3600s Access Token（含 30d Refresh Token 家族防重放）与吊销。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看 OAuth 速率与代次契约',
      capabilities: [
        '检测到 Refresh Token 重放时立即撤销整个授权家族；修改所有者密码直接推进代次、瞬间作废历史授权',
        '支持 1..10 条合法 redirect URI、90 天客户端 TTL 与 Client ID Metadata Documents (CIMD)',
      ],
      limitations: [
        '严格仅服务单人属主（userId: "owner"），不支持团队多租户；未传 PKCE S256 直接拒绝',
        'Cloudflare 边缘节点依然可见 OAuth 流程及 /mcp 荷载，网关保护本机越权执行而非链路零知识加密',
      ],
      params: [
        {
          name: 'code_challenge / code_challenge_method',
          location: 'query',
          type: 'S256 (43 chars)',
          required: true,
          description: '强制 PKCE S256 摘要校验；/authorize POST 同时校验 Origin 与所有者密码。',
        },
        {
          name: 'scope',
          location: 'body',
          type: 'string',
          required: false,
          description: '仅可申请 computer:read、computer:write、computer:execute 与可选 offline_access。',
        },
      ],
      responses: [
        {
          status: '200 OK (/oauth/token)',
          tone: 'ok',
          summary: '返回 Access Token (TTL 3600s) 与受家族保护的 Refresh Token (30d)',
          example: `{
  "access_token": "<bearer_token>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "computer:read computer:write computer:execute"
}`,
        },
        {
          status: '400 / 401 / 429 Rate Limited',
          tone: 'err',
          summary: '超出速率（DCR 20/h、Authorize GET 30/10m、POST 8/10m）或重放令牌立即拒绝',
        },
      ],
      examples: [
        {
          label: '元数据发现 & 注册',
          lang: 'sh',
          code: `curl -sS "{{BASE_URL}}/.well-known/oauth-authorization-server"
curl -sS -X POST "{{BASE_URL}}/register" \\
  -H "Content-Type: application/json" \\
  -d '{"client_name":"Local MCP Client","redirect_uris":["https://client.example/cb"]}'`,
        },
      ],
    },
    {
      id: 'edge-mcp-endpoint',
      group: 'oauth',
      kind: 'MCP',
      title: '远程 MCP JSON-RPC 网关入口',
      signature: 'POST /mcp (JSON-RPC 2.0)',
      auth: 'Bearer Access Token + MCP-Protocol-Version',
      stability: '主调度协议',
      summary:
        '校验 Access Token 代次与 MCP 协议版本（2025-03-26 / 2025-06-18 / 2025-11-25），通过 BridgeRelay 经 WSS 转发到本地连接器排队批准并限时 110 秒返回响应。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看中继队列与重放账本顺序',
      capabilities: [
        '支持 16 路并发普通工具调用与独立 4 路 stop_command 紧急控制通道（单客户端最多 2 路）',
        '严格按先删除 .approved.json 再写入 24h 持久账本 RequestReceipts 执行，彻底防重复副作用',
      ],
      limitations: [
        '入站 RPC 硬上限 1 MiB、回包上限 2 MiB，110 秒未完成返回 HTTP 504（不自动重放未确定副作用的写入/命令）',
        '当前实现采用 POST /mcp（JSON-RPC 2.0），不提供独立 SSE 长期推送端点',
      ],
      params: [
        {
          name: 'MCP-Protocol-Version',
          location: 'header',
          type: '2025-03-26 | 2025-06-18 | 2025-11-25',
          required: true,
          description: '必须与已受支持的 MCP 版本严格匹配。',
        },
        {
          name: 'jsonrpc / method / params',
          location: 'body',
          type: 'JSON-RPC 2.0 (<= 1 MiB)',
          required: true,
          description: 'boundedJson 限制最多 20,000 节点与 32 层嵌套。',
        },
      ],
      responses: [
        {
          status: '200 OK',
          tone: 'ok',
          summary: '返回标准 MCP tools/call 或 tools/list JSON-RPC 结果',
          example: `{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "content": [{ "type": "text", "text": "Listed 14 entries under /workspace" }] }
}`,
        },
        {
          status: '503 Offline / 504 Timeout / 403 LOCAL_APPROVAL_REQUIRED',
          tone: 'err',
          summary: '连接器离线、等待 Approve.cmd 超时（5 分钟 pending TTL）或清理异常锁停时拒绝执行',
        },
      ],
      examples: [
        {
          label: 'tools/call (read_file)',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/mcp" \\
  -H "Authorization: Bearer <access_token>" \\
  -H "MCP-Protocol-Version: 2025-11-25" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"package.json"}}}'`,
        },
      ],
    },
    {
      id: 'mcp-read-tools',
      group: 'mcp-read',
      kind: 'MCP',
      title: '工作区只读与检索工具集 (computer_context / list / read / search)',
      signature: 'computer_context · list_directory · read_file · search_files',
      auth: 'computer:read · file-worker (allowExec: false)',
      stability: '4 项只读工具',
      summary:
        '仅挂载单一受控工程目录 /workspace。除 computer_context 免人工批准外，目录枚举、分段 UTF-8 读取与全文检索均按完整参数计算摘要等待 Approve.cmd 确认。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看 10 项工具预算明细',
      capabilities: [
        'read_file 支持 UTF-8 字符对齐分片（默认 64 KiB、上限 256 KiB）并在全量读取时返回 sha256',
        'search_files 跳过 .git、node_modules、.wrangler 及大于 1 MiB 文件，带时间与数量双熔断（5s / 5,000 条）',
      ],
      limitations: [
        'list_directory 与 file-safety 坚决不跟随符号链接或跨设备硬链接（nlink > 1），防目录逃逸',
        '项目目录本身对已批准的读操作透明，未受审查的代码/注释正文仍需操作者在 Approve.cmd 警惕提示词注入',
      ],
      params: [
        {
          name: 'list_directory.limit',
          location: 'body',
          type: 'integer (1..1000)',
          required: false,
          defaultValue: '200',
          description: '最大条目数，按文件系统序返回。',
        },
        {
          name: 'read_file.max_bytes',
          location: 'body',
          type: 'integer (1..262144)',
          required: false,
          defaultValue: '65536',
          description: '单次最大读取字节数；禁止非 UTF-8 孤立代理项。',
        },
        {
          name: 'search_files 预算上限',
          location: 'body',
          type: 'bounds',
          required: false,
          description: '上限 128 目录、5,000 条目、2,000 命中文件、16 MiB 扫描总量与 5 秒超时。',
        },
      ],
      responses: [
        {
          status: 'MCP Text / JSON Result',
          tone: 'ok',
          summary: '返回工作区目录、分块文本（含文件 sha256）或命中行片段',
          example: `{
  "path": "package.json",
  "offset": 0,
  "bytes_read": 512,
  "eof": true,
  "sha256": "e3b0c442..."
}`,
        },
      ],
      examples: [
        {
          label: 'search_files 调用参数',
          lang: 'json',
          code: `{
  "name": "search_files",
  "arguments": {
    "query": "AuthCoordinator",
    "path": "cloud",
    "max_results": 50
  }
}`,
        },
      ],
    },
    {
      id: 'mcp-write-exec-tools',
      group: 'mcp-exec',
      kind: 'MCP',
      title: 'CAS 文件写入与受限容器命令 (write / edit / delete / exec / status / stop)',
      signature: 'write_file · edit_file · delete_file · exec_command · command_status · stop_command',
      auth: 'Approve.cmd 逐参批准（status/stop 除外）',
      stability: '6 项读写执行工具',
      summary:
        '所有文件修改均携带 CAS sha256 / 唯一字面替换校验并执行 NTFS DACL 与 O_EXCL 原子替换预检；命令运行在只读、断网、UID/GID 1000、2 GiB 内存上限的一次性 Linux 容器内。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看容器加固标志与 ACL 规则',
      capabilities: [
        'exec_command 强制 --read-only --cap-drop ALL（仅留 SETUID/SETGID）--pids-limit 256 --memory 2g 与 20s 心跳租约杀死保护',
        'delete_file 限定单常规文件，edit_file 强制唯一 old_text + expected_sha256，防盲改覆盖',
      ],
      limitations: [
        'write_file / edit_file 内容严格限定 <= 1 MiB UTF-8；exec 命令最长 32 KiB、输出截取 128 KiB',
        '一旦 stop_command 清理 docker rm -f 未获确认，连接器直接闭锁（closed=true）并拒接新任务，仅保留 status/stop 查询',
      ],
      params: [
        {
          name: 'expected_sha256',
          location: 'body',
          type: 'sha256 hex',
          required: false,
          description: 'edit_file 必填、write_file / delete_file 可选的乐观并发文件校验摘要。',
        },
        {
          name: 'exec_command.network',
          location: 'body',
          type: '"none" | "outbound"',
          required: false,
          defaultValue: '"none"',
          description: '默认 --network none；仅当宿主配置允许 sandbox.allowOutbound 时可请求 bridge 出网。',
        },
        {
          name: 'exec_command.timeout_ms',
          location: 'body',
          type: 'integer',
          required: false,
          defaultValue: 'sync 30s / bg 300s',
          description: '同步 100..60,000 ms，后台任务 100..3,600,000 ms；内存中至多保留 4 活动 / 64 总记录。',
        },
      ],
      responses: [
        {
          status: 'Tool Execution Result',
          tone: 'ok',
          summary: '返回新 sha256、退出码与截断后 stdout/stderr',
          example: `{
  "exit_code": 0,
  "stdout": "14 tests passed",
  "stderr": "",
  "truncated": false
}`,
        },
        {
          status: 'APPROVAL_RECORD_TOO_LARGE / CLOSED_CLEANUP_UNCONFIRMED',
          tone: 'err',
          summary: '待批排队满 64 项或清理未确认闭锁时明确拒收',
        },
      ],
      examples: [
        {
          label: 'exec_command 示例',
          lang: 'json',
          code: `{
  "name": "exec_command",
  "arguments": {
    "command": "pnpm test",
    "mode": "sync",
    "timeout_ms": 30000,
    "network": "none"
  }
}`,
        },
      ],
    },
  ],
}

export const apiSpecEn: ApiCatalogSpec = {
  project: 'AgentDock Bridge · Gateway & MCP Reference',
  subtitle:
    'Interactive specification covering Cloudflare Workers OAuth 2.1 + PKCE routes, WSS connector relay, exact Approve.cmd confirmation, and all 10 hardened MCP workspace tools.',
  environments: [
    { label: 'Production Worker Domain', value: 'https://bridge.example.com' },
    { label: 'Local Wrangler Dev', value: 'http://127.0.0.1:8797' },
  ],
  searchPlaceholder: 'Filter OAuth routes, MCP tools, sandbox caps…',
  emptyText: 'No matching gateway endpoint or MCP tool found.',
  labels: {
    allGroups: 'All',
    canDo: '✅ Capabilities',
    cannotDo: '⛔ Explicit Limits / Rejections',
    params: 'Parameters, Scopes & Bounds',
    paramName: 'Parameter',
    paramLocation: 'Location',
    paramType: 'Type',
    paramRequired: 'Rule',
    paramDesc: 'Description & Hard Limits',
    responses: 'Status & Error Contracts',
    examples: 'Standard Invocation',
    responseSample: 'Sample Response',
    copy: 'Copy',
    copied: 'Copied',
    noParams: 'No additional request parameters.',
    required: 'Required',
    optional: 'Optional',
    deepDocs: 'Open full security contract',
    totalItems: 'endpoints/tools',
    envLabel: 'Base URL Environment',
    mobilePicker: 'Select Endpoint or Tool',
    defaultLabel: 'Default',
    plainIndexToggle: 'Plaintext Search & Print Index (Ctrl+K Target)',
  },
  groups: [
    { id: 'oauth', title: 'Cloud Edge & OAuth 2.1' },
    { id: 'mcp-read', title: 'Read-Only MCP Tools' },
    { id: 'mcp-exec', title: 'Write & Sandbox MCP Tools' },
  ],
  items: [
    {
      id: 'edge-health-bridge',
      group: 'oauth',
      kind: 'GET',
      title: 'Health Probe & Reverse Connector Relay',
      signature: 'GET /healthz · WSS /bridge',
      auth: 'healthz public · bridge Bearer BRIDGE_TOKEN',
      stability: 'Core Relay',
      summary:
        '/healthz reports connector liveness against a 65s heartbeat limit; /bridge accepts a single active reverse WebSocket from the hardened local Windows connector.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'View HTTP & liveness specs',
      capabilities: [
        'Outbound WSS requires zero open inbound firewall or router ports',
        'Enforces 10s FIRST_HEARTBEAT_GRACE and 65s HEARTBEAT_MAX_AGE per session',
      ],
      limitations: [
        'Returns 503 when connector is offline and 409 if a live/grace WSS socket already exists',
        'Production secret decryption (DPAPI) and NTFS ACL guards require Windows x64 (`win32`)',
      ],
      params: [
        {
          name: 'Authorization (WSS /bridge)',
          location: 'header',
          type: 'Bearer <BRIDGE_TOKEN>',
          required: true,
          description: 'Connector token (>=32 chars), strictly isolated from browser OAuth access tokens.',
        },
      ],
      responses: [
        { status: '200 OK', tone: 'ok', summary: 'Gateway and connector healthy', example: `{ "ok": true, "connectorOnline": true }` },
        { status: '503 Offline / 409 Conflict', tone: 'err', summary: 'Connector offline or duplicate socket claim' },
      ],
      examples: [{ label: 'curl (/healthz)', lang: 'sh', code: `curl -sS "{{BASE_URL}}/healthz"` }],
    },
    {
      id: 'edge-oauth21',
      group: 'oauth',
      kind: 'POST',
      title: 'OAuth 2.1 + PKCE Authorization & Password Generations',
      signature: 'POST /register · /authorize · POST /oauth/token · /oauth/token/revoke',
      auth: 'PKCE S256 (43 chars) + PBKDF2-SHA256',
      stability: 'Dual DO Authority',
      summary:
        'Handles DCR client registration, zero-script CSP consent prompts, 3600s access tokens, 30d replay-protected refresh token families, and instant generation-based mass revocation.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'Inspect OAuth limits & grants',
      capabilities: [
        'Revokes the whole refresh token family on replay; owner password rotation invalidates all legacy grants instantly',
        'Supports 1–10 redirect URIs, 90-day DCR client TTL, and CIMD',
      ],
      limitations: [
        'Single owner identity only (userId: "owner") with zero multi-tenancy support',
        'Cloudflare edge and the AI client platform still observe MCP arguments in transit',
      ],
      params: [
        {
          name: 'code_challenge / scope',
          location: 'query',
          type: 'PKCE S256 (43 chars)',
          required: true,
          description: 'Mandatory S256 challenge; scopes limited to computer:{read,write,execute} + offline_access.',
        },
      ],
      responses: [
        {
          status: '200 OK',
          tone: 'ok',
          summary: 'Issues generation-bound access token and optional refresh token',
          example: `{ "access_token": "<token>", "token_type": "Bearer", "expires_in": 3600 }`,
        },
        { status: '400 / 401 / 429', tone: 'err', summary: 'Enforces per-route rate limits and PKCE S256 checks' },
      ],
      examples: [
        {
          label: 'Metadata & Register',
          lang: 'sh',
          code: `curl -sS "{{BASE_URL}}/.well-known/oauth-authorization-server"`,
        },
      ],
    },
    {
      id: 'edge-mcp-endpoint',
      group: 'oauth',
      kind: 'MCP',
      title: 'Remote MCP JSON-RPC Ingress',
      signature: 'POST /mcp (JSON-RPC 2.0)',
      auth: 'Bearer Access Token + MCP-Protocol-Version',
      stability: 'Primary Client Ingress',
      summary:
        'Validates generation-scoped bearer tokens and MCP protocol versions, forwarding JSON-RPC requests through BridgeRelay with a 110s deadline and pre-claimed replay receipts.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'Review relay lanes & replay order',
      capabilities: [
        'Reserves 16 ordinary RPC slots plus 4 priority stop_command lanes (max 2 per client)',
        'Unlinks .approved.json before claiming a 24h durable RequestReceipt to prevent double execution',
      ],
      limitations: [
        'Enforces 1 MiB RPC / 2 MiB reply limits and 110s HTTP 504 deadline with zero auto-replay',
        'Uses HTTP POST JSON-RPC 2.0 rather than long-lived SSE response streams',
      ],
      params: [
        {
          name: 'MCP-Protocol-Version',
          location: 'header',
          type: '2025-03-26 | 2025-06-18 | 2025-11-25',
          required: true,
          description: 'Supported MCP wire version header.',
        },
      ],
      responses: [
        { status: '200 OK', tone: 'ok', summary: 'Standard JSON-RPC 2.0 result' },
        { status: '403 / 503 / 504', tone: 'err', summary: 'Approval timeout (5m TTL), connector offline, or cleanup lockout' },
      ],
      examples: [
        {
          label: 'tools/call',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/mcp" \\
  -H "Authorization: Bearer <access_token>" \\
  -H "MCP-Protocol-Version: 2025-11-25" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"computer_context","arguments":{}}}'`,
        },
      ],
    },
    {
      id: 'mcp-read-tools',
      group: 'mcp-read',
      kind: 'MCP',
      title: 'Workspace Read & Search MCP Tools',
      signature: 'computer_context · list_directory · read_file · search_files',
      auth: 'computer:read · file-worker (allowExec: false)',
      stability: '4 Read Tools',
      summary:
        'Exposes workspace metadata, non-symlink directory listings, UTF-8 chunk reads with full-file SHA-256 digests, and bounded literal searches under /workspace.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'View tool bounds table',
      capabilities: [
        'read_file enforces UTF-8 character alignment and computes full sha256 digests cleanly',
        'search_files skips .git/node_modules/.wrangler/>1 MiB files and stops cleanly at 5s / 5,000 entries',
      ],
      limitations: [
        'Strictly blocks symlink dereferences and multi-hardlink files (nlink !== 1)',
        'computer_context is exempt from Approve.cmd; directory/file reads require exact argument digest approval',
      ],
      params: [
        { name: 'list_directory.limit / read_file.max_bytes', location: 'body', type: 'integer', required: false, defaultValue: '200 / 65536', description: 'Up to 1,000 entries or 262,144 bytes per call.' },
      ],
      responses: [
        { status: '200 Result', tone: 'ok', summary: 'Bounded directory list, UTF-8 slice, or grep hits', example: `{ "path": "package.json", "bytes_read": 512, "eof": true }` },
      ],
      examples: [{ label: 'search_files Args', lang: 'json', code: `{ "name": "search_files", "arguments": { "query": "AuthCoordinator", "max_results": 50 } }` }],
    },
    {
      id: 'mcp-write-exec-tools',
      group: 'mcp-exec',
      kind: 'MCP',
      title: 'CAS File Writes & Hardened Container Execution',
      signature: 'write_file · edit_file · delete_file · exec_command · command_status · stop_command',
      auth: 'Approve.cmd Exact Digest (status/stop exempt)',
      stability: '6 Write/Exec Tools',
      summary:
        'Executes CAS-guarded workspace mutations (with Windows NTFS DACL checks) and disposable --read-only Linux container commands guarded by 20s lease heartbeats.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'Inspect Docker flags & approval ledger',
      capabilities: [
        'Runs commands under --read-only, --cap-drop ALL (SETUID/SETGID only), UID/GID 1000, 2g RAM, 256 PIDs, and --network none default',
        'Checks expected_sha256 CAS guards on edits and prevents unconfirmed directory/recursive deletes',
      ],
      limitations: [
        'Caps write/edit bodies at <=1 MiB UTF-8, commands at <=32 KiB, and output capture at <=128 KiB',
        'Any unconfirmed docker rm -f closes the sandbox against all new tasks until manual recovery',
      ],
      params: [
        { name: 'expected_sha256 / network / timeout_ms', location: 'body', type: 'object', required: false, defaultValue: 'network="none"', description: 'CAS checksum guard, opt-in network mode, and execution timeout.' },
      ],
      responses: [
        { status: 'Command / Mutation Output', tone: 'ok', summary: 'Exit code, bounded stdout/stderr, or updated file digest', example: `{ "exit_code": 0, "stdout": "14 tests passed", "truncated": false }` },
        { status: '403 / CLOSED_CLEANUP_UNCONFIRMED', tone: 'err', summary: 'Refuses further writes/exec after unconfirmed container teardown' },
      ],
      examples: [{ label: 'exec_command Args', lang: 'json', code: `{ "name": "exec_command", "arguments": { "command": "pnpm test", "network": "none" } }` }],
    },
  ],
}
