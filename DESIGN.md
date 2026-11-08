---
version: 2.0.0
name: AgentDock Worker Remote Primer Tactile Design System
description: 面向远程 MCP 桥接网关与 OAuth 2.1 授权页（agentdock-worker-remote）的 Primer 质感设计系统规范。基于 GitHub Primer 功能原语定义零脚本（script-src 'none'）网关入口页与 OAuth 2.1 PKCE 授权同意书卡片的物理质感契约，融合冷轧金属机箱与防伪契约印章美学。
colors:
  primary: '#0969da'
  accent-fg: '#0969da'
  accent-emphasis: '#0969da'
  accent-subtle: '#ddf4ff'
  accent-dark-fg: '#2f81f7'
  canvas-default: '#ffffff'
  canvas-overlay: '#ffffff'
  canvas-inset: '#f6f8fa'
  canvas-subtle: '#f6f8fa'
  canvas-dark-default: '#0d1117'
  canvas-dark-overlay: '#161b22'
  canvas-dark-inset: '#010409'
  canvas-dark-subtle: '#161b22'
  fg-default: '#1f2328'
  fg-muted: '#57606a'
  fg-on-emphasis: '#ffffff'
  fg-dark-default: '#f0f6fc'
  fg-dark-muted: '#8b949e'
  border-default: '#d0d7de'
  border-muted: '#d8dee4'
  border-dark-default: '#30363d'
  border-dark-muted: '#21262d'
  success-fg: '#1a7f37'
  success-emphasis: '#1f883d'
  success-subtle: '#dafbe1'
  success-dark-fg: '#3fb950'
  danger-fg: '#cf222e'
  danger-emphasis: '#cf222e'
  danger-subtle: '#ffebe9'
  danger-dark-fg: '#f85149'
  attention-fg: '#9a6700'
  attention-subtle: '#fff8c5'
  attention-dark-fg: '#d29922'
typography:
  body-md:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  ui-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4285
    letterSpacing: 0px
  heading-page:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.2px
  heading-section:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0px
  code-inline:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'IBM Plex Mono', monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 3px
  md: 6px
  lg: 12px
  pill: 9999px
spacing:
  none: 0px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
components:
  oauth-box:
    backgroundColor: '{colors.canvas-dark-default}'
    textColor: '{colors.fg-dark-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.lg}'
  permissions-box:
    backgroundColor: '{colors.canvas-dark-subtle}'
    textColor: '{colors.fg-dark-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
  scope-badge:
    backgroundColor: '{colors.accent-subtle}'
    textColor: '{colors.accent-dark-fg}'
    typography: '{typography.code-inline}'
    rounded: '{rounded.pill}'
    padding: '{spacing.xxs}'
---

# AgentDock Worker Remote 质感设计系统规范 (`DESIGN.md`)

本文档是 [`agentdock-worker-remote`](README.md) 的设计系统规范。针对远程 MCP 桥接网关与零脚本（`script-src 'none'`）环境，基于 GitHub Primer 功能原语融合**零信任硬件保险箱与防伪契约印章质感（Zero-Trust Airgap & Cryptographic Token Vault Materiality）**，定义授权卡片与连接页面的物理交互契约。

---

## 1. 核心设计哲学与物理质感

1. **零脚本环境纯 CSS 触觉反馈（Pure CSS Kinematics）**：在强制性严格 CSP（`default-src 'none'; style-src 'unsafe-inline'`）下，完全由纯 CSS 达成微动按压反馈：
   - 静止态：卡片具备顶边缘微光 `box-shadow: 0 8px 24px rgba(1, 4, 9, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)`。
   - 按钮 `:hover`：向光源上浮 `transform: translateY(-0.5px)`。
   - 按钮 `:active`：物理内陷 `transform: translateY(0.5px) scale(0.99)`，投影坍缩为内嵌压槽 `box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3)`。
2. **硬件密钥柜卡片质感（Vault Keycard Feel）**：居中呈现的授权卡片（`main.card`）具有冷轧金属板外框（`1px solid var(--border)`）与四角高精度倒角（`6px`），营造高可信度法律契约的厚实感。
3. **权限作用域实体印章（Scope Tokens）**：`computer:read`、`computer:write` 等危险敏感权限封装在具有斜角微高光的等宽胶囊（`.scope-tag`）中，搭配激光刻蚀感的 SHA 指纹，明确隔离安全边界。

---

## 2. 调色板与语义 Token

### 2.1 W3C `$value/$type` Token 注册表

| Primer 功能 Token | CSS 变量 | Light `$value` | Dark `$value` | 物理质感映射 |
| :--- | :--- | :--- | :--- | :--- |
| `canvas.inset` | `--bg-inset` | `#f6f8fa` | `#010409` | 深度内凹机房基座、密码输入内槽 |
| `canvas.default` | `--surface` | `#ffffff` | `#0d1117` | 授权卡实体表面、防伪证书白底/深空黑底 |
| `canvas.subtle` | `--layer` | `#f6f8fa` | `#161b22` | 权限清单压槽底板、拒绝按钮底色 |
| `fg.default` | `--fg` | `#1f2328` | `#f0f6fc` | 契约条款标题、高对比正文 |
| `fg.muted` | `--muted` | `#57606a` | `#8b949e` | 权限说明、底部哈希指纹 |
| `border.default` | `--border` | `#d0d7de` | `#30363d` | 容器物理边框（1px solid） |
| `accent.emphasis` | `--brand` | `#0969da` | `#1f6feb` | 主批准按钮背景、安全状态指示方块 |
| `danger.fg` | `--danger` | `#cf222e` | `#f85149` | 密码校验失败报警、权限超限警示条 |

---

## 3. 字体栈与空间规范

- **UI 字体栈（`--font-sans`）**：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`
- **等宽数据字体（`--font-mono`）**：`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'IBM Plex Mono', monospace`
- **空间步进**：`4px / 8px / 12px / 16px / 24px / 32px`。卡片内边距 `24px`，权限列表行高 `36px`。

---

## 4. 核心组件与防钓鱼安全约束

1. **Permissions Box（`.permissions`）**：采用 `canvas.subtle` 沉槽背景，每项授权能力包含物理胶囊 `.scope-tag` 与明确的边界范围说明，严禁使用含糊词汇。
2. **防钓鱼 URL 验真**：客户端回调地址（`redirectHost` / `redirectUri`）强制使用等宽高对比框体渲染，绝不折叠省略二级域名，确保操作者清晰识别授权目标。
3. **Flash Notice（`.notice` / `.notice.error`）**：采用 Primer 3px 语义强化左边框与多层内嵌微光，错误时提供醒目的物理警示感。
