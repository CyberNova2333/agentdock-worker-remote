---
title: 架构全景与安全决策
description: 解析 AgentDock Bridge 的三段式分层拓扑、与源码契合的协议注释、安全演进决策（ADR）与版本迁移注意事项。
---

# 架构全景与安全决策

AgentDock Bridge 的核心结构是**云端无持久文件落地、本地无直接宿主执行、容器无宿主机密与默认无外网**的三层隔离模型。

## 交互式架构全景

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span>📐</span> AgentDock Bridge 拓扑图（支持平移、缩放与节点探查）
    </span>
    <a href="/diagrams/worker-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      在新窗口全屏打开 ↗
    </a>
  </div>
  <iframe src="/diagrams/worker-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

> **图表与当前源码对照说明**：互动图中的区域命名用于概览四段职责；对应当前源码时，外部客户端入口为 `POST /mcp`（标准 HTTP JSON-RPC 2.0 响应，非图中示意的 SSE 实时日志流），身份认证使用 OAuth 2.1 + PKCE（`S256`）与密码代次 Durable Object，反向隧道为连接器主动拨入的 `WSS /bridge`（`Bearer BRIDGE_TOKEN`），实际工作负荷按每次批准运行一次性 `docker create` + `docker start --attach`。

---

## 核心子系统交接

```text
Remote Client ──(HTTPS OAuth 2.1 + POST /mcp)──▶ Cloudflare Worker
                                                    ├─ AuthCoordinator DO (owner-v2-*, SQLite)
                                                    └─ BridgeRelay DO (primary, WSS /bridge)
                                                           │
Windows Host (DPAPI + NTFS ACL + Pinned Node) ◀────────────┘
  ├─ BridgeConnector (信封二审 + 并发通道 + 心跳)
  ├─ LocalApprovals + Approve.cmd (5 分钟一次性精确摘要确认)
  ├─ RequestReceipts (24h 持久防重放) / StopReceipts (独立停止栈)
  └─ createSandboxRuntime (windows-acl 前置检查 + Docker CLI)
         │
         ▼
Linux Container (node:24-trixie-slim, --read-only, UID 1000, --network none|bridge)
  ├─ runner.mjs (PID 1, 20s 宿主租约监控, /bin/bash 命令执行)
  └─ file-worker.mjs (allowExec=false + file-safety 路径/编码/链接守卫)
```

要沿着单个请求完整追踪上述组件如何交接与失败降级，请直接阅读[一次请求端到端走查](/docs/walkthrough)；按源码目录定位对应文件和测试，请进入[源码目录与测试地图](/docs/code-map)。

---

<span id="security-adrs-migration"></span>

## 安全决策与演进迁移

自首个发布基线以来，架构演进中确立了四项不可回退的关键安全决策（ADR）：

### ADR-01：基于密码哈希的 OAuth 代次隔离与 CIMD 元数据修复

- **背景问题（R4-01）**：早期存储记录在客户端降权（CIMD）或刷新轮换后，可能残留未带完整 `metadata` 的旧授权记录；此外仅改密钥需要手动清理全部历史会话。
- **架构决策**：`AuthStore.list` 与 `put` 通过 `completeMetadata` 统一从规范 `grant` JSON 补齐 `clientId` / `resource` / `redirectUri`；同时 `cloud/index.mjs` 按 `owner-v2-${sha256(OWNER_PASSWORD_HASH)}` 计算 `AuthCoordinator` 实例名。
- **工程权衡与迁移影响**：使用 `Rotate-Secrets.ps1` 或从旧版本升级到 `owner-v2-*` 后，**所有既有 MCP 客户端都必须重新 OAuth 登录授权**，换取旧授权零残留保证。

### ADR-02：出锁准备 + 乐观版本号提交事务

- **背景问题（R4-03）**：在单实例序列化锁内部等待 HTTP 请求体上传或外部 CIMD/JWKS 拉取，会导致一个慢请求堵死全站授权与令牌刷新。
- **架构决策**：`cloud/index.mjs` 先通过 `readLimited` 在边缘完整读取上限受控的请求体；`AuthTransactions` 将准备阶段置于 `AuthQueue` 锁外执行，按通道限制并发（如 `authorization: 4`、`mcp: 32`、`stop: 4`），提交前核对 `revision` 是否变化并最多重试 4 轮（总超时 25 秒）。

### ADR-03：停止指令专用通道与清理故障安全退守

- **背景问题（R4-04 / FINAL-01）**：普通控制请求占满防重放缓存或单一容器 `docker rm -f` 失败时，若全局锁死全部接口，属主客户端将失去停止失控后台任务的能力。
- **架构决策**：`AuthTransactions`、`BridgeRelay`、`BridgeConnector` 与 `StopReceipts`（128 条 FIFO 淘汰）为 `stop_command` 贯穿保留独立并发槽；`local/sandbox.mjs` 在 `cleanupConfirmed === false` 置 `closed = true` 时，把属主 `command_status` / `get_command` / `stop_command` 分支放在关闭拦截之前，继续严查 `ownerClient` 并保持汇报 `cleanup_confirmed: false`。

### ADR-04：紧凑字节前置预算、零脚本 CSP 合并与宿主静态加固

- **背景问题（R4-02 / 第五轮修复）**：深层嵌套 JSON 会因 `JSON.stringify(..., 2)` 在落盘后膨胀超出读取上限；外部宿主共享 Node 目录、PowerShell `PSModulePath` 继承及覆盖覆盖头部的 CSP 均带来隐蔽风险。
- **架构决策**：`approval-store.mjs` 在开临时文件前按紧凑序列化检测 `1,200,000` 字节上限；`showConsent` 合并保留而非覆盖基础零脚本 CSP；`Install-NodeRuntime.ps1`、`Manage.ps1` 与 `connector.mjs` 将运行目录与官方 Node `24.22.1` 隔离到用户私有目录并检查完整祖先路径 ACL、SHA-256 及最小子进程环境；`local/windows-acl.mjs` 前置拦截会丢弃显式 NTFS DACL 的替换请求。

### 升级与迁移操作清单

升级仓库源码时，请按顺序同步三个独立运行面：
1. **源码验证**：在新拉取的目录运行 `pnpm install --frozen-lockfile && pnpm run check && pnpm test`。
2. **镜像与受保护副本**：先执行 `Stop.cmd`，若有 `container/` 或 `local/` 改动须重新 `docker build` 并重新运行 `.\scripts\Install-Hardened.ps1 -Workspace "<workspace-path>"`（该脚本会保留 `%USERPROFILE%\.agentdock-bridge` 中的 DPAPI 凭据、历史账本与新副本备份，但需要等待重装完成 `installation.json` 清单）。
3. **云端 Worker**：有 `cloud/` 或 `wrangler.jsonc` 改动时重新执行 `pnpm run deploy`，再启动 `Start.cmd` 并用 `Status.cmd` 核对在线状态。

---

<span id="glossary-index"></span>

## 核心术语快速索引

完整术语表维护在仓库 `repo-docs/glossary.md`，以下列出架构阅读中最常遇到的关键标识：

- **`AuthCoordinator` / `BridgeRelay`**：分别管理 OAuth 2.1 状态事务（`owner-v2-*`）与连接器 WebSocket 中继（`primary`）的双 SQLite Durable Objects。
- **`LOCAL_APPROVAL_REQUIRED` / `APPROVAL_RECORD_TOO_LARGE`**：敏感工具首次调用缺本地批准返回码，以及紧凑待批准请求超过 `1,200,000` 字节时的前置拒收码。
- **`RequestReceipts` / `StopReceipts`**：分别为 `24` 小时持久执行账本（上限 `10,000`）与专门保障停止命令不被饿死的内存防重放栈（`128`）。
- **`cleanupConfirmed` / `closed`**：标志 `docker rm -f` 是否获得确认；未确认时置 `closed` 为 `true` 并阻止一切新执行。

---

<span id="evidence-and-boundaries"></span>

## 源码证据与验证边界

文档站内容均对照当前源码（提交锚点记入仓库 `repo-docs/change-log.md`）核实。在非 Windows 开发机上进行文档构建与跨平台回归时，依赖 DPAPI、NTFS ACL 与显式开启 `AGENTDOCK_DOCKER_TEST` 的测试用例会自动跳过；历史已签名的公网全量回归、固定镜像摘要校验与受保护运行副本 28 文件清单快照见仓库根目录 `SECURITY-FIXES.md`，本页的架构与构建检查不代替实机生产再验收。
