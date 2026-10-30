import { DurableObject } from 'cloudflare:workers';
import { MAX_REPLY_BYTES, MAX_RPC_BYTES, json, readLimited, validateRpc, sha256 } from './security.mjs';
import { connectionLiveness } from './liveness.mjs';

/** One object owns one machine's socket and the associated in-flight calls. */
export class BridgeRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.pending = new Map();
    this.nextCleanup = 0;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  async currentCredential() {
    if (typeof this.env.BRIDGE_TOKEN !== 'string' || this.env.BRIDGE_TOKEN.length < 32) throw new Error('Bridge credentials are unavailable.');
    this.credentialVersion = [...await sha256(this.env.BRIDGE_TOKEN)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  liveConnections() {
    const live = [];
    for (const socket of this.ctx.getWebSockets('machine')) {
      const attachment = socket.deserializeAttachment();
      const acceptedAt = attachment?.acceptedAt;
      const heartbeat = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime();
      const state = connectionLiveness(acceptedAt, heartbeat);
      if (socket.readyState === WebSocket.OPEN && state.reserved && attachment?.credentialVersion === this.credentialVersion) live.push({ socket, ...state });
      else { try { socket.close(1001, 'Connector heartbeat expired'); } catch {} this.disconnected(socket); }
    }
    return live;
  }

  connector() { return this.liveConnections().find(item => item.online)?.socket; }

  async alarm() {
    await this.currentCredential();
    const live = this.liveConnections();
    if (live.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...live.map(item => item.expiresAt))));
    else await this.ctx.storage.deleteAlarm();
  }

  async fetch(request) {
    await this.currentCredential();
    const path = new URL(request.url).pathname;
    if (path === '/status') { const online = !!this.connector(); return json({ ok: online, connectorOnline: online }, online ? 200 : 503); }
    if (path === '/limit' && request.method === 'POST') return this.limit(request);
    if (path === '/guard' && request.method === 'POST') return this.guard(request);
    if (path === '/socket' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (this.liveConnections().length) return json({ error: 'A connector is already online or completing its heartbeat.' }, 409);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], ['machine']);
      pair[1].serializeAttachment({ acceptedAt: Date.now(), credentialVersion: this.credentialVersion });
      await this.ctx.storage.setAlarm(Date.now() + 10000);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path !== '/rpc' || request.method !== 'POST') return json({ error: 'Not found.' }, 404);
    const socket = this.connector();
    if (!socket) return json({ error: 'Computer is offline. Start the local connector; the request was not replayed.' }, 503, { 'retry-after': '10' });
    let body, authorization;
    try {
      const envelope = JSON.parse(await readLimited(request, MAX_RPC_BYTES + 8192));
      body = validateRpc(envelope.body);
      authorization = envelope.authorization;
      if (authorization?.userId !== 'owner' || typeof authorization.clientId !== 'string' || !authorization.clientId || authorization.clientId.length > 2048 || !Array.isArray(authorization.scope) || authorization.scope.length > 4 || authorization.scope.some(scope => !['computer:read', 'computer:write', 'computer:execute', 'offline_access'].includes(scope))) throw new Error('Invalid authorization envelope.');
    }
    catch (error) { return json({ error: error.message || 'Invalid request.' }, error.status || 400); }
    if (body.method === 'notifications/cancelled') {
      const requestId = body.params?.requestId;
      if ('id' in body || !(typeof requestId === 'string' || (typeof requestId === 'number' && Number.isFinite(requestId)))) return json({ error: 'Invalid cancellation notification.' }, 400);
      // Clients may cancel only their own original JSON-RPC request, not another grant's work.
      for (const [id, pending] of this.pending) if (pending.clientId === authorization.clientId && pending.requestId === requestId) {
        this.cancel(id, json({ jsonrpc: '2.0', id: requestId, error: { code: -32800, message: 'Request cancelled.' } }));
      }
      return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
    }
    // Body reads yield to other calls: re-check capacity immediately before insertion.
    if (socket.readyState !== WebSocket.OPEN || socket !== this.connector()) return json({ error: 'Computer disconnected before dispatch.' }, 503);
    const stopping = body.method === 'tools/call' && body.params?.name === 'stop_command';
    if (stopping && !['computer:read', 'computer:execute'].every(scope => authorization.scope.includes(scope))) return json({ error: 'Command control requires execute permission.' }, 403);
    const lane = [...this.pending.values()].filter(item => item.stopping === stopping);
    if (lane.length >= (stopping ? 4 : 16) || (stopping && lane.filter(item => item.clientId === authorization.clientId).length >= 2)) return json({ error: 'Computer is busy.' }, 429, { 'retry-after': '3' });
    const id = crypto.randomUUID();
    const issuedAt = Date.now();
    return new Promise(resolve => {
      const timer = setTimeout(() => this.cancel(id, json({ error: 'Computer request timed out. It may have executed; inspect its result before retrying.' }, 504)), 110000);
      const aborted = () => this.cancel(id, json({ error: 'Client disconnected; operation was not replayed.' }, 499));
      request.signal?.addEventListener('abort', aborted, { once: true });
      this.pending.set(id, { socket, resolve, timer, requestId: body.id, clientId: authorization.clientId, stopping, notification: !('id' in body), signal: request.signal, aborted });
      if (request.signal?.aborted) { aborted(); return; }
      try { socket.send(JSON.stringify({ type: 'request', id, body, authorization, issuedAt, deadline: issuedAt + 110000 })); }
      catch { this.finish(id, json({ error: 'Computer disconnected; operation was not replayed.' }, 502)); }
    });
  }

  async limit(request) {
    const value = await request.json();
    if (typeof value.key !== 'string' || !/^[a-z0-9:-]{1,160}$/.test(value.key) || !Number.isInteger(value.maximum) || value.maximum < 1 || value.maximum > 1000 || !Number.isInteger(value.seconds) || value.seconds < 1 || value.seconds > 86400) return json({ error: 'Invalid limiter input.' }, 400);
    const now = Date.now();
    const key = `limit:${value.key}`;
    const result = await this.ctx.storage.transaction(async storage => {
      const previous = await storage.get(key);
      const bucket = previous && previous.until > now ? previous : { count: 0, until: now + value.seconds * 1000 };
      if (bucket.count >= value.maximum) return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.until - now) / 1000)) };
      bucket.count++;
      await storage.put(key, bucket);
      return { allowed: true, retryAfter: 0 };
    });
    if (now >= this.nextCleanup) {
      this.nextCleanup = now + 3600000;
      const entries = await this.ctx.storage.list({ prefix: 'limit:', limit: 1000 });
      const expired = [...entries].filter(([, item]) => item.until < now).map(([entry]) => entry);
      if (expired.length) await this.ctx.storage.delete(expired);
      const guards = await this.ctx.storage.list({ prefix: 'guard:', limit: 1000 });
      const oldGuards = [...guards].filter(([, item]) => item.until < now).map(([entry]) => entry);
      if (oldGuards.length) await this.ctx.storage.delete(oldGuards);
    }
    return json(result);
  }

  async guard(request) {
    const { action, key, lease } = await request.json();
    if (!['claim', 'commit', 'release', 'consume'].includes(action) || typeof key !== 'string' || !/^(?:consent|code):[a-f0-9]{64}$/.test(key)) return json({ error: 'Invalid guard.' }, 400);
    const now = Date.now();
    const storageKey = `guard:${key}`;
    const result = await this.ctx.storage.transaction(async storage => {
      const previous = await storage.get(storageKey);
      const current = previous && previous.until > now ? previous : null;
      if (action === 'consume' || action === 'claim') {
        if (current) return { acquired: false };
        const id = crypto.randomUUID();
        await storage.put(storageKey, { state: action === 'consume' ? 'consumed' : 'pending', lease: id, until: now + (action === 'consume' ? 600000 : 120000) });
        return { acquired: true, lease: id };
      }
      if (!current || current.state !== 'pending' || typeof lease !== 'string' || current.lease !== lease) return { acquired: false };
      if (action === 'release') await storage.delete(storageKey);
      else await storage.put(storageKey, { state: 'consumed', until: now + 600000 });
      return { acquired: true };
    });
    return json(result);
  }

  finish(id, response) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.aborted);
    pending.resolve(response);
  }

  cancel(id, response) {
    const pending = this.pending.get(id);
    if (pending?.socket.readyState === WebSocket.OPEN) try { pending.socket.send(JSON.stringify({ type: 'cancel', id })); } catch {}
    this.finish(id, response);
  }

  async webSocketMessage(socket, data) {
    await this.currentCredential();
    if (socket.deserializeAttachment()?.credentialVersion !== this.credentialVersion) { socket.close(1008, 'Connector credentials changed.'); this.disconnected(socket); return; }
    if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > MAX_REPLY_BYTES) { socket.close(1009, 'Invalid response size.'); this.disconnected(socket); return; }
    let message;
    try { message = JSON.parse(data); } catch { socket.close(1003, 'Expected JSON.'); this.disconnected(socket); return; }
    if (message?.type === 'ping') { socket.send('{"type":"pong"}'); return; }
    if (message?.type === 'pong') return;
    if (message?.type !== 'response' || typeof message.id !== 'string') return;
    const pending = this.pending.get(message.id);
    if (!pending || pending.socket !== socket) return;
    if (pending.notification) { this.finish(message.id, new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } })); return; }
    const response = message.body;
    const valid = response && !Array.isArray(response) && response.jsonrpc === '2.0' && response.id === pending.requestId && (('result' in response) !== ('error' in response));
    this.finish(message.id, valid ? json(response) : json({ error: 'Computer returned an invalid JSON-RPC response.' }, 502));
  }

  disconnected(socket) {
    for (const [id, request] of this.pending) if (request.socket === socket) this.finish(id, json({ error: 'Computer disconnected. Operations are not replayed automatically.' }, 502));
  }
  webSocketClose(socket, code) { this.disconnected(socket); try { socket.close(code === 1005 ? 1000 : code); } catch {} }
  webSocketError(socket) { this.disconnected(socket); }
}
