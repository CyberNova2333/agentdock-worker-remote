---
layout: home

hero:
  name: AgentDock Bridge
  text: 单人远程 MCP 桥接网关
  tagline: 通过 Cloudflare Workers OAuth 2.1 + PKCE 鉴权与中继，在 Windows 受保护连接器执行人工精确批准，并把操作隔离在只读 Linux Docker 沙箱中。
  actions:
    - theme: brand
      text: 起步与配置部署
      link: /docs/
    - theme: alt
      text: 接口与安全契约
      link: /docs/contracts
    - theme: alt
      text: 架构与源码导览
      link: /docs/architecture
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/CyberNova2333/agentdock-worker-remote

features:
  - title: 边缘 OAuth 2.1 + 代次隔离
    details: 拆分为 AuthCoordinator 与 BridgeRelay 双 SQLite Durable Objects，强制 PKCE S256、零脚本 CSP 同意书与密码轮换代次作废。
  - title: 本机单次精确批准与持久账本
    details: 除只读环境、状态查询与停止指令外，敏感工具绑定完整参数摘要等待 Approve.cmd 确认；先消费批准再记账以防重放。
  - title: Linux 只读容器与 Windows 守卫
    details: 丢弃多余内核权能、UID/GID 1000、默认断网执行，并拒绝越界符号链接、非法 UTF-16 与剥离自定义 NTFS ACL 的替换。
---

## 系统架构全景

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span>📐</span> AgentDock Bridge 拓扑视图（支持平移、缩放与节点探查）
    </span>
    <a href="/diagrams/worker-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      在新窗口全屏打开 ↗
    </a>
  </div>
  <iframe src="/diagrams/worker-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

> **实现口径提示**：拓扑图中的外层节点概括了边缘网关到隔离沙箱的四段分工；当前源码实际采用的协议与接口为 `POST /mcp`（JSON-RPC 2.0，而非 SSE 流）、`OAuth 2.1 + PKCE (S256)`、连接器主动发起的 `WSS /bridge` 长连接以及本地经 `Approve.cmd` 确认后的 `docker start --attach` 容器执行。

## 本地验证与客户端接入摘要

在 Node.js 24+ 与 `pnpm@12.6.0` 环境验证源码语法与跨平台测试（Linux/macOS 会自动跳过 15 项依赖 Windows DPAPI/ACL 或开启 Docker 的用例）：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

实际生产配置须依次完成 Cloudflare Worker 部署（`wrangler deploy`）与 Windows x64 受保护运行副本安装（`Setup.ps1` + `Install-Hardened.ps1`）。在远端 MCP 客户端填入你的网关端点：

```text
https://<your-bridge-domain>/mcp
```

## 文档分层导航

::: tip 按照读者需求快速跳转
- **首次部署个人工作区的开发者**：阅读 [项目定位与部署流程](/docs/) 与 [配置矩阵与运维脚本](/docs/configuration)，掌握 Worker、DPAPI 凭据、固定镜像、`.agentdock-bridge` 安装与密码轮换；
- **遇到离线 503、待批阻断或清理停机**：查阅 [部署与运行排错 FAQ](/docs/faq)，按 `healthz`、`Approve.cmd`、ACL 报错与 `cleanup_confirmed` 快速定位根因；
- **评估权限模型、接入客户端或审计接口**：查阅 [OAuth、工具、批准与沙箱契约](/docs/contracts)，核对端点速率上限、4 个作用域、10 项 MCP 工具限制与容器安全边界；
- **阅读源码、追踪端到端链路或准备提交改动**：查阅 [架构全景与安全决策](/docs/architecture)、[一次请求端到端走查](/docs/walkthrough) 与 [源码目录与测试地图](/docs/code-map)。
:::
