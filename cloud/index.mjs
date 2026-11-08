import OAuthProvider, { AuthorizationError, CimdFetchError, insufficientScope } from '@cloudflare/workers-oauth-provider';
import { BridgeRelay } from './relay.mjs';
import { AuthStore } from './auth-store.mjs';
import { AuthTransactions } from './auth-transactions.mjs';
import { COMPUTER_SCOPES, OAUTH_SCOPES, PROTOCOL_VERSIONS, MAX_RPC_BYTES, HttpError, allowedOrigin, equalSecret, escapeHtml, fromBase64url, json, pageHeaders, publicOrigin, readLimited, sha256, validateRpc, verifyOwnerPassword } from './security.mjs';

export { BridgeRelay };
const providers = new Map();
const READ_TOOLS = new Set(['computer_context', 'agentdock_context', 'list_directory', 'read_file', 'search_files']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);
const EXEC_TOOLS = new Set(['exec_command', 'command_status', 'get_command', 'stop_command']);

function relay(env) { return env.RELAY.getByName('primary'); }

async function rate(request, env, category, maximum, seconds) {
  // Cloudflare overwrites CF-Connecting-IP; it is never taken from an arbitrary X-Forwarded-For.
  const address = request.headers.get('cf-connecting-ip') || 'local-development';
  const digest = await sha256(`${env.BRIDGE_TOKEN}:${address}`);
  const fingerprint = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const response = await relay(env).fetch('https://machine.internal/limit', { method: 'POST', body: JSON.stringify({ key: `${category}:${fingerprint}`, maximum, seconds }) });
  if (!response.ok) throw new HttpError(503, 'Authentication is temporarily unavailable.');
  const allowance = await response.json();
  if (!allowance.allowed) {
    const error = new HttpError(429, 'Too many attempts. Please wait before trying again.');
    error.retryAfter = allowance.retryAfter;
    throw error;
  }
}

function documentPage(title, content) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · AgentDock Bridge</title><style>
:root {
  color-scheme: dark light;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --canvas-default: #0d1117;
  --canvas-subtle: #161b22;
  --canvas-inset: #010409;
  --canvas-muted: #21262d;
  --fg-default: #f0f6fc;
  --fg-muted: #8b949e;
  --fg-subtle: #6e7681;
  --fg-on-emphasis: #ffffff;
  --border-default: #30363d;
  --border-muted: #21262d;
  --accent-fg: #2f81f7;
  --accent-emphasis: #1f6feb;
  --accent-hover: #388bfd;
  --accent-subtle: rgba(56, 139, 253, 0.15);
  --accent-muted: rgba(56, 139, 253, 0.4);
  --danger-fg: #f85149;
  --danger-subtle: rgba(248, 81, 73, 0.15);
  --danger-muted: rgba(248, 81, 73, 0.4);
  --btn-shadow: 0 0 transparent;
  font: 14px/1.5 var(--font-sans);
  background: var(--canvas-inset);
  color: var(--fg-default);
}
@media (prefers-color-scheme: light) {
  :root {
    --canvas-default: #ffffff;
    --canvas-subtle: #f6f8fa;
    --canvas-inset: #f6f8fa;
    --canvas-muted: #eaeef2;
    --fg-default: #1f2328;
    --fg-muted: #57606a;
    --fg-subtle: #6e7781;
    --border-default: #d0d7de;
    --border-muted: #d8dee4;
    --accent-fg: #0969da;
    --accent-emphasis: #0969da;
    --accent-hover: #0860ca;
    --accent-subtle: #ddf4ff;
    --accent-muted: rgba(84, 174, 255, 0.4);
    --danger-fg: #cf222e;
    --danger-subtle: #ffebe9;
    --danger-muted: rgba(255, 129, 130, 0.4);
    --btn-shadow: 0 1px 0 rgba(31, 35, 40, 0.04);
  }
}
:root:has(.dn-input:checked) {
  --canvas-default: #ffffff;
  --canvas-subtle: #f6f8fa;
  --canvas-inset: #f6f8fa;
  --canvas-muted: #eaeef2;
  --fg-default: #1f2328;
  --fg-muted: #57606a;
  --fg-subtle: #6e7781;
  --border-default: #d0d7de;
  --border-muted: #d8dee4;
  --accent-fg: #0969da;
  --accent-emphasis: #0969da;
  --accent-hover: #0860ca;
  --accent-subtle: #ddf4ff;
  --accent-muted: rgba(84, 174, 255, 0.4);
  --danger-fg: #cf222e;
  --danger-subtle: #ffebe9;
  --danger-muted: rgba(255, 129, 130, 0.4);
  --btn-shadow: 0 1px 0 rgba(31, 35, 40, 0.04);
}
@media (prefers-color-scheme: light) {
  :root:has(.dn-input:checked) {
    --canvas-default: #0d1117;
    --canvas-subtle: #161b22;
    --canvas-inset: #010409;
    --canvas-muted: #21262d;
    --fg-default: #f0f6fc;
    --fg-muted: #8b949e;
    --fg-subtle: #6e7681;
    --border-default: #30363d;
    --border-muted: #21262d;
    --accent-fg: #2f81f7;
    --accent-emphasis: #1f6feb;
    --accent-hover: #388bfd;
    --accent-subtle: rgba(56, 139, 253, 0.15);
    --accent-muted: rgba(56, 139, 253, 0.4);
    --danger-fg: #f85149;
    --danger-subtle: rgba(248, 81, 73, 0.15);
    --danger-muted: rgba(248, 81, 73, 0.4);
    --btn-shadow: 0 0 transparent;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 40px 16px; min-height: 100svh; display: grid; place-items: center; background: var(--canvas-inset); color: var(--fg-default); }
main { width: min(100%, 640px); padding: 24px; border-radius: 8px; background: var(--canvas-default); border: 1px solid var(--border-default); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12); overflow: hidden; }
.brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -24px -24px 20px; padding: 10px 20px; background: var(--canvas-subtle); border-bottom: 1px solid var(--border-default); font-size: 13px; font-weight: 600; color: var(--fg-muted); }
.brand-title { display: inline-flex; align-items: center; gap: 8px; }
.brand-title::before { content: ""; width: 8px; height: 8px; border-radius: 9999px; background: var(--accent-fg); box-shadow: 0 0 0 3px var(--accent-subtle); }

/* Animated Pure-CSS DayNightSwitch */
.dn-host { display: inline-flex; align-items: center; cursor: pointer; position: relative; user-select: none; }
.dn-input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.dn-host .components {
  position: relative;
  width: 140px;
  height: 50px;
  background-color: rgba(70, 133, 192, 1);
  border-radius: 50px;
  box-shadow: inset 0 0 5px 3px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  transform: scale(0.42);
  transform-origin: right center;
  transition: 0.6s ease;
}
.dn-host .main-button {
  margin: 6.5px 0 0 7.5px;
  width: 37px;
  height: 37px;
  background-color: rgba(255, 195, 35, 1);
  border-radius: 50%;
  box-shadow: 3px 3px 5px rgba(0, 0, 0, 0.4), inset -3px -5px 3px -3px rgba(0, 0, 0, 0.45), inset 4px 5px 2px -2px rgba(255, 230, 80, 1);
  transition: 0.6s ease;
  position: relative;
}
.dn-host .moon {
  position: absolute;
  background-color: rgba(150, 160, 180, 1);
  box-shadow: inset 0 0 1px 1px rgba(0, 0, 0, 0.3);
  border-radius: 50%;
  transition: 0.5s ease;
  opacity: 0;
}
.dn-host .moon:nth-child(1) { top: 6.5px; left: 20px; width: 10.5px; height: 10.5px; }
.dn-host .moon:nth-child(2) { top: 17.5px; left: 8px; width: 8px; height: 8px; }
.dn-host .moon:nth-child(3) { top: 22px; left: 18px; width: 11px; height: 11px; }
.dn-host .daytime-background {
  position: absolute;
  border-radius: 50%;
  transition: 0.6s ease;
  background-color: rgba(255, 255, 255, 0.2);
}
.dn-host .dn-bg-1 { top: -25px; left: -18px; width: 100px; height: 100px; }
.dn-host .dn-bg-2 { top: -45px; left: -38px; width: 140px; height: 140px; }
.dn-host .dn-bg-3 { top: -65px; left: -58px; width: 180px; height: 180px; }
.dn-host .cloud { position: absolute; border-radius: 50%; background-color: rgba(255, 255, 255, 1); transition: 0.6s ease; }
.dn-host .dn-cloud-1 { bottom: -20px; right: -8px; width: 45px; height: 45px; }
.dn-host .dn-cloud-2 { bottom: -12px; right: 18px; width: 32px; height: 32px; }
.dn-host .dn-cloud-3 { bottom: -22px; right: 38px; width: 42px; height: 42px; }
.dn-host .dn-cloud-4 { bottom: -25px; right: 60px; width: 40px; height: 40px; }
.dn-host .stars { position: absolute; opacity: 0; transition: 0.6s ease; }
.dn-host .dn-star-1 { top: 8px; left: 32px; }
.dn-host .dn-star-2 { top: 24px; left: 62px; }
.dn-host .dn-star-3 { top: 12px; left: 88px; }
.dn-host .dn-star-4 { top: 28px; left: 110px; }
.dn-host .star-son { width: 3px; height: 3px; background: #fff; border-radius: 50%; box-shadow: 0 0 3px #fff; }

/* Dark mode state for DayNightSwitch */
:root .dn-host .components { background-color: rgba(25, 30, 50, 1); }
:root .dn-host .main-button { transform: translateX(88px); background-color: rgba(195, 200, 215, 1); box-shadow: 3px 3px 5px rgba(0, 0, 0, 0.4), inset -3px -5px 3px -3px rgba(0, 0, 0, 0.45), inset 4px 5px 2px -2px rgba(255, 255, 255, 1); }
:root .dn-host .moon { opacity: 1; }
:root .dn-host .cloud { transform: translateY(60px); opacity: 0; }
:root .dn-host .stars { opacity: 1; }
:root .dn-host .daytime-background { opacity: 0.05; }

@media (prefers-color-scheme: light) {
  :root .dn-host .components { background-color: rgba(70, 133, 192, 1); }
  :root .dn-host .main-button { transform: none; background-color: rgba(255, 195, 35, 1); box-shadow: 3px 3px 5px rgba(0, 0, 0, 0.4), inset -3px -5px 3px -3px rgba(0, 0, 0, 0.45), inset 4px 5px 2px -2px rgba(255, 230, 80, 1); }
  :root .dn-host .moon { opacity: 0; }
  :root .dn-host .cloud { transform: none; opacity: 1; }
  :root .dn-host .stars { opacity: 0; }
  :root .dn-host .daytime-background { opacity: 1; }
}

:root:has(.dn-input:checked) .dn-host .components { background-color: rgba(70, 133, 192, 1); }
:root:has(.dn-input:checked) .dn-host .main-button { transform: none; background-color: rgba(255, 195, 35, 1); box-shadow: 3px 3px 5px rgba(0, 0, 0, 0.4), inset -3px -5px 3px -3px rgba(0, 0, 0, 0.45), inset 4px 5px 2px -2px rgba(255, 230, 80, 1); }
:root:has(.dn-input:checked) .dn-host .moon { opacity: 0; }
:root:has(.dn-input:checked) .dn-host .cloud { transform: none; opacity: 1; }
:root:has(.dn-input:checked) .dn-host .stars { opacity: 0; }
:root:has(.dn-input:checked) .dn-host .daytime-background { opacity: 1; }

@media (prefers-color-scheme: light) {
  :root:has(.dn-input:checked) .dn-host .components { background-color: rgba(25, 30, 50, 1); }
  :root:has(.dn-input:checked) .dn-host .main-button { transform: translateX(88px); background-color: rgba(195, 200, 215, 1); box-shadow: 3px 3px 5px rgba(0, 0, 0, 0.4), inset -3px -5px 3px -3px rgba(0, 0, 0, 0.45), inset 4px 5px 2px -2px rgba(255, 255, 255, 1); }
  :root:has(.dn-input:checked) .dn-host .moon { opacity: 1; }
  :root:has(.dn-input:checked) .dn-host .cloud { transform: translateY(60px); opacity: 0; }
  :root:has(.dn-input:checked) .dn-host .stars { opacity: 1; }
  :root:has(.dn-input:checked) .dn-host .daytime-background { opacity: 0.05; }
}

h1 { font-size: 20px; font-weight: 600; line-height: 1.25; margin: 0 0 12px; color: var(--fg-default); }
h2 { font-size: 14px; font-weight: 600; line-height: 1.4; margin: 0 0 12px; color: var(--fg-default); }
p { margin: 12px 0; color: var(--fg-muted); font-size: 14px; }
strong { color: var(--fg-default); font-weight: 600; overflow-wrap: anywhere; }
ul { list-style: none; padding: 0; margin: 0; color: var(--fg-muted); }
li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border-muted); font-size: 13px; }
li:first-child { border-top: 0; padding-top: 0; }
li:last-child { padding-bottom: 0; }
.scope-tag { display: inline-flex; align-items: center; font: 600 12px/18px var(--font-mono); color: var(--accent-fg); background: var(--accent-subtle); border: 1px solid var(--accent-muted); border-radius: 9999px; padding: 1px 8px; }
.notice { padding: 12px 16px; background: var(--accent-subtle); border: 1px solid var(--accent-muted); border-radius: 6px; font-size: 13px; color: var(--fg-default); margin: 16px 0; }
.error { background: var(--danger-subtle); border-color: var(--danger-muted); color: var(--danger-fg); }
label { display: block; margin: 16px 0 6px; font-size: 14px; font-weight: 600; color: var(--fg-default); }
input[type=password] { display: block; width: 100%; min-height: 34px; border: 1px solid var(--border-default); border-radius: 6px; background: var(--canvas-inset); color: var(--fg-default); padding: 5px 12px; font: 14px/20px var(--font-sans); transition: border-color 120ms ease, box-shadow 120ms ease; }
input[type=password]:focus-visible { outline: none; border-color: var(--accent-fg); box-shadow: 0 0 0 3px var(--accent-subtle); }
button:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }

/* Tactile Primer v2 Buttons */
.actions { display: flex; gap: 10px; margin-top: 18px; }
button {
  flex: 1;
  min-height: 34px;
  border-radius: 6px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent-emphasis) 88%, #ffffff 12%) 0%, var(--accent-emphasis) 100%);
  border: 1px solid color-mix(in srgb, var(--accent-emphasis) 80%, #000 20%);
  color: var(--fg-on-emphasis);
  padding: 6px 16px;
  cursor: pointer;
  font: 600 14px/20px var(--font-sans);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 1px 3px rgba(9, 105, 218, 0.24);
  transition: background-color 120ms ease, border-color 120ms ease, transform 80ms ease, box-shadow 80ms ease;
}
button:hover {
  background: linear-gradient(180deg, var(--accent-emphasis) 0%, var(--accent-hover) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 3px 8px rgba(9, 105, 218, 0.32);
  transform: translateY(-0.5px);
}
button:active {
  transform: translateY(0.5px) scale(0.99);
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.28);
}
.secondary {
  background: linear-gradient(180deg, var(--canvas-default) 0%, var(--canvas-subtle) 100%);
  border: 1px solid var(--border-default);
  color: var(--fg-default);
  font-weight: 500;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 1px 2px rgba(31, 35, 40, 0.05);
}
.secondary:hover {
  background: linear-gradient(180deg, var(--canvas-subtle) 0%, color-mix(in srgb, var(--canvas-subtle) 85%, var(--fg-muted) 15%) 100%);
  border-color: color-mix(in srgb, var(--border-default) 60%, var(--fg-muted));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 2px 5px rgba(31, 35, 40, 0.1);
  transform: translateY(-0.5px);
}
.secondary:active {
  transform: translateY(0.5px) scale(0.99);
  box-shadow: inset 0 2px 4px rgba(31, 35, 40, 0.16);
}

.endpoint-box { background: var(--canvas-subtle); border: 1px solid var(--border-default); border-radius: 6px; padding: 14px 16px; margin: 16px 0; }
.endpoint-box label { margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: var(--fg-muted); }
.endpoint-box .sub { margin: 6px 0 0 0; font-size: 12px; color: var(--fg-muted); }
.foot { font-size: 12px; color: var(--fg-muted); margin: 20px -24px -24px; border-top: 1px solid var(--border-default); background: var(--canvas-subtle); padding: 12px 24px; }
code { font: 12px/1.5 var(--font-mono); color: var(--fg-default); background: var(--canvas-subtle); border: 1px solid var(--border-default); border-radius: 6px; padding: 2px 6px; overflow-wrap: anywhere; }
.permissions { background: var(--canvas-subtle); border: 1px solid var(--border-default); padding: 16px; margin: 16px 0; border-radius: 6px; }
@media (max-width: 480px) { main { padding: 16px; } .brand { margin: -16px -16px 16px; padding: 10px 16px; } .foot { margin: 16px -16px -16px; padding: 10px 16px; } body { padding: 16px 12px; } .actions { flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; } }
  </style></head><body><main><div class="brand"><span class="brand-title">AgentDock Bridge · Remote MCP Bastion</span><label class="dn-host" title="切换白天/夜间外观"><input type="checkbox" class="dn-input" aria-label="切换白天/夜间外观"><div class="components"><div class="main-button"><div class="moon"></div><div class="moon"></div><div class="moon"></div></div><div class="daytime-background dn-bg-1"></div><div class="daytime-background dn-bg-2"></div><div class="daytime-background dn-bg-3"></div><div class="cloud dn-cloud-1"></div><div class="cloud dn-cloud-2"></div><div class="cloud dn-cloud-3"></div><div class="cloud dn-cloud-4"></div><div class="stars dn-star-1"><div class="star-son"></div></div><div class="stars dn-star-2"><div class="star-son"></div></div><div class="stars dn-star-3"><div class="star-son"></div></div><div class="stars dn-star-4"><div class="star-son"></div></div></div></label></div>${content}</main></body></html>`;
}

function consentPage(details, handle, message = '') {
  const labels = { 'computer:read': '读取授权项目目录中的文件、列出目录与搜索内容', 'computer:write': '在授权项目目录中创建、编辑、删除文件', 'computer:execute': '在隔离的 Linux 开发容器内执行终端命令', offline_access: '允许客户端通过刷新令牌保持连接（最长 30 天）' };
  const client = details.clientDomain ? `客户端发布域名：<strong>${escapeHtml(details.clientDomain)}</strong>` : '客户端名称由申请者自行填写，请核对下面的回调地址。';
  return documentPage('授权访问我的电脑', `<h1>授权访问我的电脑</h1><p><strong>${escapeHtml(details.clientName)}</strong> 请求通过 AgentDock Bridge 调用你的本机工具。</p><p>${client}</p><p>授权回调主机：<strong>${escapeHtml(details.redirectHost)}</strong><br><code>${escapeHtml(details.redirectUri)}</code></p>${details.redirectIsLoopback ? '<p class="notice">回调指向本机应用。仅当你刚刚从自己的 MCP 客户端发起连接时继续。</p>' : ''}<section class="permissions"><h2>本次授予的能力</h2><ul>${details.scope.map(scope => `<li><span class="scope-tag">${escapeHtml(scope)}</span>${escapeHtml(labels[scope] || scope)}</li>`).join('')}</ul></section><p class="notice">工具在隔离开发容器内访问你授权的项目目录。本机仍会逐项确认操作，容器联网需单独开启。调用内容与结果经过 Cloudflare 和所使用的模型平台，请仅授权可信客户端。</p>${message ? `<p role="alert" class="notice error">${escapeHtml(message)}</p>` : ''}<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escapeHtml(handle)}"><label for="password">本机保存的连接密码</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required autofocus><div class="actions"><button name="decision" value="approve" type="submit">登录并允许上述访问</button><button class="secondary" name="decision" value="deny" type="submit" formnovalidate>拒绝</button></div></form><p class="foot">请只在 ${escapeHtml(new URL(details.redirectUri).origin === 'null' ? '你自己的网关域名' : 'bridge.example.test')} 页面输入连接密码。密码不会发送到客户端回调地址。授权表单将在 10 分钟后失效。</p>`);
}

async function showConsent(oauth, authRequest, status = 200, message = '', priorHeaders) {
  const details = await oauth.describeConsent(authRequest);
  const transaction = await oauth.beginConsent(authRequest);
  const headers = pageHeaders();
  if (priorHeaders) for (const cookie of priorHeaders.getSetCookie()) headers.append('set-cookie', cookie);
  for (const [name, value] of transaction.headers) {
    if (name === 'set-cookie') continue;
    // Multiple CSP policies are enforced together; neither source may weaken
    // the other by replacing its policy (including our form and base limits).
    if (name === 'content-security-policy') headers.append(name, value);
    else headers.set(name, value);
  }
  for (const cookie of transaction.headers.getSetCookie()) headers.append('set-cookie', cookie);
  return new Response(consentPage(details, transaction.handle, message), { status, headers });
}

async function authorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      await rate(request, env, 'authorize', 30, 600);
      const authRequest = await oauth.parseAuthRequest(request);
      if (authRequest.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(authRequest.codeChallenge || '')) throw new HttpError(400, 'PKCE S256 is required for every client.');
      if (authRequest.scope.some(scope => !OAUTH_SCOPES.includes(scope))) throw new HttpError(400, 'An unsupported permission was requested.');
      authRequest.scope = [...new Set(['computer:read', ...authRequest.scope])];
      return showConsent(oauth, authRequest);
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, POST' });
    const origin = request.headers.get('origin');
    if (origin && origin !== publicOrigin(env)) throw new HttpError(403, 'Cross-origin authorization form rejected.');
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new HttpError(415, 'A URL-encoded authorization form is required.');
    await rate(request, env, 'password', 8, 600);
    const form = new URLSearchParams(await readLimited(request, 8192));
    const handle = form.get('handle') || '';
    if (handle.length > 1024) throw new HttpError(400, 'Invalid consent handle.');
    if (form.get('decision') === 'deny') {
      const result = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 303, headers: result.headers });
    }
    if (form.get('decision') !== 'approve') throw new HttpError(400, 'Choose Allow or Deny.');
    // Consume the browser-bound consent transaction before checking the password.
    const approved = await oauth.approveConsent(request, handle);
    const valid = await verifyOwnerPassword(form.get('password') || '', env.OWNER_PASSWORD_HASH);
    if (!valid) return showConsent(oauth, approved.request, 401, '密码不正确，请重新输入。', approved.headers);
    const result = await oauth.completeAuthorization({ request: approved.request, userId: 'owner', metadata: { label: 'Personal computer owner' }, scope: approved.request.scope, props: { userId: 'owner' } });
    approved.headers.set('location', result.redirectTo);
    approved.headers.set('cache-control', 'no-store');
    return new Response(null, { status: 303, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) return new Response(documentPage('授权未完成', `<h1>授权未完成</h1><p>${escapeHtml(error instanceof AuthorizationError ? error.description : '无法验证该客户端的元数据。')}</p><p>请返回 MCP 客户端重新连接。</p>`), { status: 400, headers: pageHeaders() });
    throw error;
  }
}

function requiredFor(body) {
  if (body.method !== 'tools/call') return ['computer:read'];
  const name = body.params?.name;
  if (READ_TOOLS.has(name)) return ['computer:read'];
  if (WRITE_TOOLS.has(name)) return ['computer:read', 'computer:write'];
  if (EXEC_TOOLS.has(name)) return ['computer:read', 'computer:execute'];
  return COMPUTER_SCOPES;
}

const mcpHandler = {
  async fetch(request, env, context) {
    if (new URL(request.url).pathname !== '/mcp') return json({ error: 'Not found.' }, 404);
    if (request.method !== 'POST') return json({ error: 'This stateless MCP endpoint accepts POST requests.' }, 405, { allow: 'POST, OPTIONS' });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Content-Type must be application/json.' }, 415);
    let body;
    try { body = validateRpc(JSON.parse(await readLimited(request, MAX_RPC_BYTES))); }
    catch (error) { return json({ error: error.message || 'Malformed JSON.' }, error.status || 400); }
    const scopes = requiredFor(body);
    if (context.props?.userId !== 'owner') return json({ error: 'Access denied.' }, 403);
    if (!scopes.every(scope => context.auth.scope.includes(scope))) return insufficientScope(context.auth, scopes);
    // This response is internal to the AUTH Durable Object, never exposed as MCP output.
    // The Worker sends it to RELAY only after the serialized authentication phase ends.
    return json({ body, authorization: { userId: 'owner', clientId: context.auth.clientId, scope: context.auth.scope } });
  },
};

const defaultHandler = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/authorize') return authorize(request, env);
    return json({ error: 'Not found.' }, 404);
  },
};

function provider(origin) {
  if (!providers.has(origin)) providers.set(origin, new OAuthProvider({
    apiRoute: '/mcp', apiHandler: mcpHandler, defaultHandler,
    authorizeEndpoint: `${origin}/authorize`, tokenEndpoint: `${origin}/oauth/token`, clientRegistrationEndpoint: `${origin}/register`,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'AgentDock Personal Computer' },
    scopesSupported: OAUTH_SCOPES, requiredScopes: COMPUTER_SCOPES,
    accessTokenTTL: 3600, refreshTokenTTL: 30 * 86400, clientRegistrationTTL: 90 * 86400,
    tokenExchangeCallback({ scope, requestedScope }) {
      return { refreshTokenTTL: scope.includes('offline_access') && requestedScope.includes('offline_access') ? 30 * 86400 : 0 };
    },
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationCallback({ clientMetadata }) {
      if (!Array.isArray(clientMetadata.redirect_uris) || clientMetadata.redirect_uris.length > 10) return { description: 'One to ten callback URIs are required.' };
      if (typeof clientMetadata.client_name === 'string' && clientMetadata.client_name.length > 120) return { description: 'Client name is too long.' };
    },
    // Expected OAuth errors are returned by the provider. Do not write tokens or bodies to logs.
    onError() {},
  }));
  return providers.get(origin);
}

async function route(request, env, context) {
  const origin = publicOrigin(env);
  const url = new URL(request.url);
  const expectedHost = new URL(origin).host;
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.origin !== origin && !isLoopback && url.host !== expectedHost) return json({ error: 'Use the configured gateway hostname.' }, 421);
  if (url.href.length > 12000) return json({ error: 'URL is too long.' }, 414);
  if (!allowedOrigin(request.headers.get('origin'), origin)) return json({ error: 'Origin is not allowed.' }, 403);
  const path = url.pathname;
  if (path === '/bridge') {
    if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'A WebSocket connection is required.' }, 426);
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ') || !await equalSecret(authorization.slice(7), env.BRIDGE_TOKEN)) return json({ error: 'Unauthorized.' }, 401);
    return relay(env).fetch(new Request('https://machine.internal/socket', request));
  }
  if (path === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
    const status = await relay(env).fetch('https://machine.internal/status');
    if (request.method === 'HEAD') return new Response(null, { status: status.status, headers: status.headers });
    return status;
  }
  if (path === '/' && request.method === 'GET') return new Response(documentPage('远程连接入口', `
    <h1>远程连接入口</h1>
    <p>这是个人专用的安全 MCP 远程代理网关。</p>
    <div class="endpoint-box">
      <label>MCP 服务端点：</label>
      <code>https://bridge.example.test/mcp</code>
      <p class="sub">认证协议：OAuth 2.1 + PKCE (RFC 7636)</p>
    </div>
    <section class="permissions">
      <h2>安全体系与边界隔离</h2>
      <ul>
        <li><span class="scope-tag">Zero-Trust</span>所有客户端请求必须经由所有者密码验证与 OAuth 授权凭证。</li>
        <li><span class="scope-tag">Sandbox</span>受控宿主机执行器运行于独立 Linux 容器沙盒，严格限制文件系统根目录与网络出站。</li>
        <li><span class="scope-tag">Durable Relay</span>基于 Cloudflare Workers Durable Objects 实现全双工加密控制流中继。</li>
      </ul>
    </section>
    <p class="foot">宿主机连接器需手动启动；电脑休眠或离线时无法执行请求。</p>
  `), { headers: pageHeaders() });
  if (path === '/mcp') {
    const version = request.headers.get('mcp-protocol-version');
    if (version && !PROTOCOL_VERSIONS.has(version)) return json({ error: 'Unsupported MCP protocol version.' }, 400);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id', 'access-control-max-age': '600', 'cache-control': 'no-store' } });
  }
  if (path === '/register') await rate(request, env, 'register', 20, 3600);
  if (path === '/oauth/token') await rate(request, env, 'token', 120, 60);
  if (['/register', '/oauth/token', '/oauth/token/revoke', '/authorize', '/mcp'].includes(path) && request.method === 'POST') {
    // Do not hold the globally serialized authority while an Internet client
    // drips an upload. The DO only receives a bounded, fully buffered body.
    const body = await readLimited(request, path === '/mcp' ? MAX_RPC_BYTES : path === '/authorize' ? 8192 : 16384);
    if (path === '/oauth/token') {
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) return json({ error: 'invalid_request', error_description: 'Token requests must use form encoding.' }, 415);
    }
    request = new Request(request, { body });
  }
  // Password rotation selects a new authorization generation automatically;
  // grants and clients issued under the retired credential cannot authenticate.
  const generation = [...await sha256(env.OWNER_PASSWORD_HASH)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  // v2 retires grants that older releases may have retained after a CIMD downgrade.
  const response = await env.AUTH.getByName(`owner-v2-${generation}`).fetch(request);
  if (path === '/mcp' && response.status === 200) {
    const envelope = await response.json();
    return relay(env).fetch('https://machine.internal/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope), signal: request.signal });
  }
  return response;
}

/** Single strongly consistent authority with bounded optimistic preparation. */
export class AuthCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.transactions = new AuthTransactions({ retain: promise => state.waitUntil(promise) });
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS oauth_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER, metadata TEXT)');
    state.storage.sql.exec('CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth_state(expires)');
  }

  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    let lane = pathname === '/mcp' ? 'mcp' : pathname === '/authorize' ? request.method === 'GET' ? 'authorization' : 'consent' : pathname.startsWith('/oauth/token') ? 'token' : 'other';
    if (lane === 'mcp' && request.method === 'POST') {
      try {
        const body = await request.clone().json();
        if (body.method === 'tools/call' && body.params?.name === 'stop_command') lane = 'stop';
      } catch { /* The provider handles invalid requests without bypassing auth. */ }
    }
    return await this.transactions.run(lane, async () => {
      const store = new AuthStore(this.state.storage);
      const response = await this.handle(request.clone(), store);
      return { response, writes: store.pending.size > 0, commit: () => store.commit() };
    }, request.signal) || json({ error: 'temporarily_unavailable' }, 503);
  }

  async handle(request, store) {
    const env = { ...this.env, OAUTH_KV: store };
    const path = new URL(request.url).pathname;
    let form, refreshToken, refreshRecord;
    if (['/oauth/token', '/oauth/token/revoke'].includes(path) && request.method === 'POST' && request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      form = new URLSearchParams(await request.clone().text());
      for (const name of new Set(form.keys())) if (name !== 'resource' && form.getAll(name).length !== 1) return json({ error: 'invalid_request' }, 400);
      if (form.get('grant_type') === 'authorization_code' && form.get('code') && await store.codeWasUsed(form.get('code'))) return json({ error: 'invalid_grant' }, 400);
      if (form.get('grant_type') === 'refresh_token') {
        refreshToken = form.get('refresh_token');
        if (!refreshToken || refreshToken.length > 1024) return json({ error: 'invalid_grant' }, 400);
        refreshRecord = await store.refreshRecord(refreshToken);
        if (!refreshRecord) return json({ error: 'invalid_grant' }, 400);
        if (refreshRecord.state !== 'current') {
          // A previously issued bearer credential proves reuse. Revoke the entire family.
          await store.revokeFamily(refreshRecord);
          return json({ error: 'invalid_grant', error_description: 'Refresh credential reuse detected. Connect again.' }, 400);
        }
      }
    }
    const background = [];
    let response = await provider(publicOrigin(env)).fetch(request, env, { waitUntil: promise => background.push(Promise.resolve(promise)), passThroughOnException() {} });
    // Provider persistence must finish staging before the revision-guarded commit.
    while (background.length) await Promise.all(background.splice(0));
    if (response.ok && form) {
      if (form.has('grant_type')) {
        const tokens = await response.clone().json();
        if (tokens.refresh_token) {
          await store.recordIssuedRefresh(tokens.refresh_token, refreshToken);
          if (!tokens.scope.split(' ').includes('offline_access')) {
            await store.disableRefresh(tokens);
            delete tokens.refresh_token;
            const headers = new Headers(response.headers);
            headers.delete('content-length');
            response = new Response(JSON.stringify(tokens), {status:response.status,headers});
          }
        }
        if (form.get('grant_type') === 'authorization_code' && tokens.access_token) await store.consumeCode(form.get('code'));
      } else if (form.has('token')) {
        // Revocation of an older, already rotated token must also revoke its family.
        const record = await store.refreshRecord(form.get('token'));
        let clientId = form.get('client_id');
        const basic = request.headers.get('authorization')?.match(/^Basic\s+(\S+)\s*$/i);
        if (!clientId && basic) {
          try { clientId = decodeURIComponent(atob(basic[1]).split(':')[0].replace(/\+/g, ' ')); } catch {}
        }
        if (!clientId && form.has('client_assertion')) {
          // The provider has already verified this assertion and returned success.
          // JWT JSON is UTF-8. atob() alone returns bytes as characters and
          // corrupts a valid non-ASCII client identifier before family lookup.
          try { clientId = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64url(form.get('client_assertion').split('.')[1]))).iss; } catch {}
        }
        if (record && record.clientId === clientId) await store.revokeFamily(record);
      }
    }
    // The coordinator returns this only after the matching revision commits.
    return response;
  }
}

export default {
  async fetch(request, env, context) {
    let result;
    try { result = await route(request, env, context); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      result = json({ error: status === 500 ? 'The gateway is temporarily unavailable.' : error.message }, status, error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {});
    }
    // A 101 response owns a live socket and cannot be reconstructed like an HTTP response.
    if (result.status === 101) return result;
    const headers = new Headers(result.headers);
    const origin = request.headers.get('origin');
    if (origin && allowedOrigin(origin, env.PUBLIC_ORIGIN)) {
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-expose-headers', 'WWW-Authenticate, MCP-Session-Id, MCP-Protocol-Version');
      headers.append('vary', 'Origin');
    }
    headers.set('x-content-type-options', 'nosniff');
    headers.set('strict-transport-security', 'max-age=31536000');
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  },
};
