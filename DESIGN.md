---
version: 1.0.0
name: AgentDock Worker Remote Primer Design System
description: 面向远程 MCP 桥接网关与 OAuth 2.1 授权页（agentdock-worker-remote）的 Primer 设计系统规范。与 CloudForge 同色系同风格，基于 GitHub Primer 功能原语定义零脚本（script-src 'none'）网关入口页与 OAuth 2.1 PKCE 授权同意书卡片的视觉与安全交互契约。
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

# AgentDock Worker Remote Primer 设计系统规范 (`DESIGN.md`)

本文档是 [`agentdock-worker-remote`](README.md) 的设计系统规范，与 [`cloudforge/DESIGN.md`](https://github.com/CyberNova2333/cloudforge/blob/main/DESIGN.md) 保持**同色系同风格（GitHub Primer Functional Design System）**，专门指导 [`cloud/index.mjs`](cloud/index.mjs) 中的网关连接入口页（`documentPage`）与 OAuth 2.1 + PKCE 授权同意书页（`consentPage`）。

---

## Overview

1. **GitHub OAuth App Authorization Pattern（GitHub OAuth 授权卡范式）**：授权同意书直接关系到本机隔离容器的读写与命令执行权限（`computer:read`、`computer:write`、`computer:execute`、`offline_access`）。界面效仿 GitHub OAuth Authorize 页面，以 `canvas.inset`（Light `#f6f8fa` / Dark `#010409`）为背景，居中呈现 `1px solid border.default`（`#d0d7de` / `#30363d`）+ `6px` 圆角的 Primer `Box` 授权卡。
2. **Zero-Script Security Boundary（零脚本安全边界）**：页面强制响应 `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`，所有亮暗模式自适应（`@media (prefers-color-scheme: light)` / `dark`）、焦点环与表单反馈均由纯 CSS 原语驱动。
3. **Anti-Spoofing Metadata Clarity（防钓鱼元数据高清晰度）**：客户端回调主机（`redirectHost`）、完整回调 URI（`redirectUri`）与请求的权限 Scope 标识符一律采用 `12px` 等宽代码胶囊展示，防止长域名截断欺骗。

---

## Colors

### W3C `$value/$type` Token 注册表

| Primer 功能 Token | CSS 变量 | Light `$value` | Dark `$value` | 用途说明 |
| :--- | :--- | :--- | :--- | :--- |
| `canvas.inset` | `--bg-inset` | `#f6f8fa` | `#010409` | `body` 全屏背景、密码输入框背景 |
| `canvas.default` | `--surface` | `#ffffff` | `#0d1117` | `main` Primer `Box` 授权卡主体底色 |
| `canvas.subtle` | `--layer` | `#f6f8fa` | `#161b22` | `.permissions` 能力清单容器底色、次要拒绝按钮（`.secondary`）底色 |
| `fg.default` | `--fg` | `#1f2328` | `#f0f6fc` | 页面主标题、`<strong>` 强调文本、表单 Label |
| `fg.muted` | `--muted` | `#57606a` | `#8b949e` | 说明段落、权限描述文本、底部安全域核对脚印（`.foot`） |
| `border.default` | `--border` | `#d0d7de` | `#30363d` | `main` 卡片外框、`.permissions` 边框、输入框与按钮边框 |
| `accent.fg` | `--brand-soft` | `#0969da` | `#2f81f7` | 品牌眉标、代码胶囊文字、`:focus-visible` 2px 焦点环 |
| `accent.emphasis` | `--brand` | `#0969da` | `#1f6feb` | 主批准按钮背景、品牌状态方块锚点 |
| `danger.fg` | `--danger` | `#cf222e` | `#f85149` | 密码校验失败告警框（`.notice.error`）文字与左边框 |
| `danger.subtle` | `--danger-bg` | `#ffebe9` | `rgba(248,81,73,0.15)` | `.notice.error` 告警框底色 |

---

## Typography & Components

1. **字阶体系**：全局基准 `14px/1.5` 系统无衬线字体；授权卡主标题 `h1` 为 `20px`（`font-weight: 600`）；权限清单小节标题 `h2` 为 `14px`（`font-weight: 600`）；回调地址 `<code>` 与权限胶囊 `.scope-tag` 为 `12px` 等宽字体。
2. **Permissions Box（`.permissions`）**：采用 `canvas.subtle` 背景、`1px solid var(--border)`、`6px` 圆角，每项能力左侧展示胶囊圆角（`9999px`）的 `.scope-tag`（如 `computer:execute`），右侧为中文能力边界说明。
3. **Flash Notice（`.notice` / `.notice.error`）**：采用 Primer Flash 样式（`6px` 圆角，`1px solid` 边框 + `3px solid` 语义左边框），清晰区分本机回环提醒与密码错误告警。
4. **Action Buttons（`.actions button`）**：高度 `36px`，圆角 `6px`，主按钮使用 Primer Blue（`--brand`），拒绝按钮使用 `.secondary`（`canvas.subtle` + `1px solid var(--border)`）。
