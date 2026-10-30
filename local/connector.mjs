import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createSandboxRuntime } from './sandbox.mjs';
import { RequestReceipts, TransientReceipts, StopReceipts } from './receipts.mjs';
import { LocalApprovals } from './approvals.mjs';
import { ApprovalRecordTooLargeError } from './approval-store.mjs';
import { validateRequestEnvelope, requiresApproval } from './request-policy.mjs';

export const defaultStateDirectory = () => path.join(os.homedir(), '.agentdock-bridge');
function windowsPowerShell() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  if (!path.isAbsolute(systemRoot) || systemRoot.startsWith('\\\\')) throw new Error('Cannot locate the Windows system shell.');
  const system32 = path.join(systemRoot, 'System32');
  const shellHome = path.join(system32, 'WindowsPowerShell', 'v1.0');
  // Module imports and CLR startup must not inherit project/toolchain overrides.
  // Use the OS directory as cwd as well, rather than a caller-controlled project.
  return {
    executable: path.join(shellHome, 'powershell.exe'), cwd: shellHome,
    env: { SystemRoot: systemRoot, WINDIR: systemRoot, USERPROFILE: os.homedir(),
      PATH: system32, PSModulePath: path.join(shellHome, 'Modules') },
  };
}

export function loadSecrets(stateDir) {
  if (process.platform !== 'win32') throw new Error('This installation stores its secrets with Windows DPAPI');
  const script = path.resolve(import.meta.dirname, '..', 'scripts', 'Secrets.ps1');
  try {
    const { executable, env, cwd } = windowsPowerShell();
    const json = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script,
      '-Action', 'Export', '-StateDir', stateDir], { env, cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 65536, timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    // execFileSync errors can contain captured credential output and shell diagnostics.
    // Never attach the original error or relay either stream to callers or logs.
    throw new Error('Protected credential loading failed. Check the trusted local installation.');
  }
}

export function proxyCandidates() {
  const options = [null];
  for (const value of [process.env.HTTPS_PROXY, process.env.HTTP_PROXY]) {
    if (/^https?:\/\//i.test(value || '')) options.push(value);
  }
  if (process.platform === 'win32') {
    try {
      const script = String.raw`$p=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop; if($p.ProxyEnable -eq 1){[Console]::Write($p.ProxyServer)}`;
      const { executable, env, cwd } = windowsPowerShell();
      const value = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], { env, cwd, encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const server = value.includes('=') ? value.match(/(?:^|;)https=([^;]+)/)?.[1] || value.match(/(?:^|;)http=([^;]+)/)?.[1] : value;
      if (server) options.push(/^https?:\/\//i.test(server) ? server : `http://${server}`);
    } catch { /* Direct and environment routes remain usable. */ }
  }
  return [...new Set(options)].sort((a, b) => Number(Boolean(b)) - Number(Boolean(a)));
}

export class BridgeConnector {
  constructor({ origin, bridgeToken, runtime, stateDir, proxyProvider = proxyCandidates, socketFactory }) {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
      throw new Error('The bridge requires HTTPS, except on loopback for tests');
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Expected an origin without a path or credentials');
    this.url = new URL('/bridge', url);
    this.url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.origin = url.origin;
    this.token = bridgeToken;
    this.runtime = runtime;
    this.stateDir = stateDir;
    this.proxyProvider = proxyProvider;
    this.socketFactory = socketFactory || ((target, options) => new WebSocket(target, options));
    this.running = false;
    this.retries = 0;
    this.inflight = new Map();
    this.receipts = new RequestReceipts(stateDir);
    this.controlReceipts = new TransientReceipts();
    this.stopReceipts = new StopReceipts();
    this.approvals = new LocalApprovals(stateDir, this.origin);
  }

  async record(event, fields = {}) {
    if (!this.stateDir) return;
    try {
      const log = path.join(this.stateDir, 'connector.log');
      if ((await fs.stat(log).catch(() => ({ size: 0 }))).size > 1024 * 1024) await fs.rename(log, `${log}.1`).catch(() => {});
      await fs.appendFile(log, JSON.stringify({ time: new Date().toISOString(), event, ...fields }) + '\n');
    } catch { /* Logging must not expose transport failures or interrupt tools. */ }
  }

  async status(online) {
    if (!this.stateDir) return;
    try {
      await fs.writeFile(path.join(this.stateDir, 'connector-status.json'), JSON.stringify({
        pid: process.pid, online, updatedAt: new Date().toISOString(), origin: this.origin,
      }, null, 2));
    } catch { /* Health remains available from the authenticated cloud connection. */ }
  }

  async start() {
    if (this.running) return this.starting;
    this.running = true;
    this.starting = (async () => {
      try {
        await Promise.all([this.receipts.ready, this.approvals.ready]);
        if (this.running) this.connect();
      } catch (error) { this.running = false; throw error; }
    })();
    return this.starting;
  }

  connect() {
    if (!this.running) return;
    if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket?.readyState)) return;
    let candidate;
    try {
      const routes = this.proxyProvider();
      candidate = routes[this.retries % routes.length];
      const socket = this.socketFactory(this.url, {
        headers: { authorization: `Bearer ${this.token}` },
        agent: candidate ? new HttpsProxyAgent(candidate) : undefined,
        handshakeTimeout: 15000,
        maxPayload: 1200000,
        perMessageDeflate: false,
        followRedirects: false,
      });
      this.socket = socket;
      let lastPong = 0;
      let beat;
      socket.on('open', () => {
        if (!this.running || this.socket !== socket) { socket.terminate(); return; }
        this.retries = 0;
        this.record('connected', { route: candidate ? 'proxy' : 'direct' });
        this.status(false);
        socket.send('{"type":"ping"}');
        beat = setInterval(() => {
          if (Date.now() - lastPong > 65000) return socket.terminate();
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
          this.status(Date.now() - lastPong <= 65000);
        }, 20000);
      });
      socket.on('message', async (data, isBinary) => {
        if (!this.running || this.socket !== socket) return;
        let message;
        try { if (isBinary) throw new Error(); message = JSON.parse(data.toString()); if (!message || Array.isArray(message) || typeof message !== 'object') throw new Error(); } catch { socket.close(1003, 'Invalid bridge frame'); return; }
        if (message.type === 'pong') { lastPong = Date.now(); this.status(true); return; }
        if (message.type === 'cancel' && typeof message.id === 'string') { this.inflight.get(message.id)?.controller.abort(); return; }
        if (message.type !== 'request') return;
        const send = body => {
          if (socket.readyState !== WebSocket.OPEN) return;
          let encoded = JSON.stringify({ type: 'response', id: message.id, body });
          if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) encoded = JSON.stringify({ type: 'response', id: message.id, body: { jsonrpc: '2.0', id: message.body?.id ?? null, error: { code: -32603, message: 'Tool result exceeds the bridge limit; request a smaller range' } } });
          socket.send(encoded);
        };
        const errorReply = (text, data) => send({ jsonrpc: '2.0', id: message.body?.id ?? null, error: { code: -32001, message: text, ...(data ? { data } : {}) } });
        let authorized;
        try { authorized = validateRequestEnvelope(message); }
        catch (error) { errorReply(error.message); return; }
        if (this.inflight.has(message.id)) { errorReply('Request ID is already being processed.'); return; }
        const stopping = authorized.body.method === 'tools/call' && authorized.body.params?.name === 'stop_command';
        const lane = [...this.inflight.values()].filter(active => active.stopping === stopping);
        if (lane.length >= (stopping ? 4 : 16) || (stopping && lane.filter(active => active.clientId === authorized.authorization.clientId).length >= 2)) {
          errorReply('Too many requests in this control lane.', { reason: 'inflight_capacity' }); return;
        }
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), Math.max(1, message.deadline - Date.now()));
        this.inflight.set(message.id, { controller, socket, stopping, clientId: authorized.authorization.clientId });
        try {
          const persistent = requiresApproval(authorized.body);
          let prior;
          if (persistent) prior = await this.receipts.inspect(message);
          else {
            // Keep stop admission independent of ordinary control traffic. Cross-lane
            // ID conflicts are still rejected while their bounded receipt survives.
            prior = (stopping ? this.controlReceipts : this.stopReceipts).inspect(message);
            if (prior.acquired) prior = (stopping ? this.stopReceipts : this.controlReceipts).claim(message);
          }
          if (!prior.acquired) { errorReply('This request ID was already attempted or its control budget is exhausted.', { reason: prior.reason }); return; }
          controller.signal.throwIfAborted();
          const approval = await this.approvals.authorize(authorized.body, authorized.authorization, { signal: controller.signal });
          if (!approval.approved) { errorReply('Local approval is required. Open the protected Approve.cmd on your computer, review this request, then retry the same tool arguments.', { code: 'LOCAL_APPROVAL_REQUIRED', approval_id: approval.id, expires_at: new Date(approval.expiresAt).toISOString(), tool: authorized.body.params.name }); return; }
          controller.signal.throwIfAborted();
          if (persistent) {
            const claim = await this.receipts.claim(message);
            if (!claim.acquired) { errorReply('This request ID was already attempted; its result is not replayed.', { reason: claim.reason }); return; }
          }
          controller.signal.throwIfAborted();
          const body = await this.runtime.handleRpc(authorized.body, { signal: controller.signal, authorization: authorized.authorization, requestId: message.id });
          send(body);
        } catch (error) {
          if (controller.signal.aborted) errorReply('Local request was cancelled or expired.');
          else if (error instanceof ApprovalRecordTooLargeError) errorReply('Request exceeds the local approval size limit. Reduce the request arguments or metadata.', { code: 'APPROVAL_RECORD_TOO_LARGE' });
          else errorReply('Local policy or tool failed; request was not retried.');
          this.record('tool_runtime_error');
        } finally { clearTimeout(deadline); this.inflight.delete(message.id); }
      });
      socket.on('error', error => this.record('socket_error', { code: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'HANDSHAKE_OR_NETWORK' }));
      socket.on('close', (code) => {
        clearInterval(beat);
        for (const active of this.inflight.values()) if (active.socket === socket) active.controller.abort();
        if (this.socket !== socket) return;
        this.status(false);
        this.record('disconnected', { code });
        this.schedule();
      });
    } catch { this.record('connection_setup_failed'); this.schedule(); }
  }

  schedule() {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.retries += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retries - 1, 5)) + Math.floor(Math.random() * 500);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    for (const active of this.inflight.values()) active.controller.abort();
    const socket = this.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED) await new Promise(resolve => {
      const timer = setTimeout(() => { socket.terminate(); resolve(); }, 1500);
      socket.once('close', () => { clearTimeout(timer); resolve(); });
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Local connector stopped');
      else socket.terminate();
    });
    await this.runtime.close();
    await this.status(false);
  }
}

async function main() {
  const stateDir = path.resolve(process.argv[2] || defaultStateDirectory());
  const config = JSON.parse(await fs.readFile(path.join(stateDir, 'config.json'), 'utf8'));
  const secrets = loadSecrets(stateDir);
  // No bridge token is passed via environment to subprocesses run by tools.
  delete process.env.AGENTDOCK_BRIDGE_TOKEN;
  const runtime = await createSandboxRuntime({ ...config, stateDir, auditFile: path.join(stateDir, 'audit.jsonl') });
  const connector = new BridgeConnector({ origin: config.origin, bridgeToken: secrets.bridgeToken, runtime, stateDir });
  secrets.ownerPassword = undefined;
  secrets.ownerPasswordHash = undefined;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await connector.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', async () => { await connector.record('uncaught_exception'); await shutdown(); });
  process.on('unhandledRejection', async () => { await connector.record('unhandled_rejection'); await shutdown(); });
  // The Windows manager requests a clean stop without terminating unrelated processes.
  const stopPoll = setInterval(async () => {
    if (await fs.access(path.join(stateDir, 'stop.request')).then(() => true, () => false)) {
      clearInterval(stopPoll);
      await shutdown();
    }
  }, 1000);
  await connector.start();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch(() => {
  console.error('Connector startup failed. Check the local installation and protected configuration.');
  process.exitCode = 1;
});
