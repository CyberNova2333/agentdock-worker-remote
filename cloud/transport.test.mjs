import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

async function fixture(t) {
  const { outputFiles } = await build({
    stdin: { contents: [
      "import { BridgeRelay as BaseRelay } from './cloud/relay.mjs';",
      "const actualNow = Date.now.bind(Date); let advance = 0;",
      "Date.now = () => actualNow() + advance;",
      "export class BridgeRelay extends BaseRelay { async fetch(request) {",
      " const url = new URL(request.url);",
      " if (url.pathname === '/test/rotate') { this.env = {...this.env, BRIDGE_TOKEN: 'rotated-fake-credential-that-is-long-enough'}; return new Response('ok'); }",
      " if (url.pathname === '/test/advance') { advance = Number(url.searchParams.get('ms')); return new Response('ok'); }",
      " return super.fetch(request);",
      "}}",
      "export default { fetch(request, env) { return env.RELAY.getByName('test').fetch(request); }};",
    ].join('\n'), resolveDir: process.cwd(), sourcefile: 'transport-harness.mjs' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'],
  });
  const instance = new Miniflare(convertV4MiniflareOptions({ name: 'transport-test',
    modules: [{ type: 'ESModule', path: 'index.mjs', contents: outputFiles[0].text }],
    compatibilityDate: '2026-10-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { RELAY: { className: 'BridgeRelay', useSQLite: true } },
    bindings: { BRIDGE_TOKEN: 'original-fake-credential-that-is-long-enough' },
  }));
  t.after(() => instance.dispose());
  return (pathname, init) => instance.dispatchFetch('https://isolated.test' + pathname, init);
}
async function connect(request, t, heartbeat = true) {
  const response = await request('/socket', { headers: { upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  socket.accept();
  t.after(() => { try { socket.close(); } catch {} });
  if (heartbeat) {
    const pong = new Promise(resolve => socket.addEventListener('message', event => { if (event.data === '{"type":"pong"}') resolve(); }, { once: true }));
    socket.send('{"type":"ping"}'); await pong;
  }
  return socket;
}
const authorization = { userId: 'owner', clientId: 'test-client', scope: ['computer:read'] };
const rpc = (request, body, auth = authorization) => request('/rpc', { method: 'POST', body: JSON.stringify({ body, authorization: auth }) });

test('relay health uses actual heartbeat timestamps and permits stale-connection replacement', { timeout: 30000 }, async t => {
  const request = await fixture(t);
  assert.equal((await request('/status')).status, 503);
  const socket = await connect(request, t, false);
  assert.equal((await request('/status')).status, 503);
  assert.equal((await request('/socket', { headers: { upgrade: 'websocket' } })).status, 409);
  const pong = new Promise(resolve => socket.addEventListener('message', event => { if (event.data === '{"type":"pong"}') resolve(); }, { once: true }));
  socket.send('{"type":"ping"}'); await pong;
  assert.equal((await request('/status')).status, 200);
  let observed;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type !== 'request') return;
    observed = message;
    socket.send(JSON.stringify({ type: 'response', id: message.id, body: { jsonrpc: '2.0', id: message.body.id, result: {} } }));
  });
  assert.equal((await rpc(request, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
  assert.deepEqual(observed.authorization, authorization);
  assert.equal(observed.deadline - observed.issuedAt, 110000);
  await request('/test/advance?ms=66000');
  assert.equal((await request('/status')).status, 503);
  await connect(request, t, false);
  assert.equal((await request('/status')).status, 503);
});

test('MCP cancellation is client-bound and works even when every relay slot is occupied', { timeout: 30000 }, async t => {
  const request = await fixture(t);
  const socket = await connect(request, t);
  const waiting = [], cancels = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'request') waiting.push(message);
    if (message.type === 'cancel') cancels.push(message.id);
  });
  const inFlight = Array.from({ length: 16 }, (_, id) => rpc(request, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'fake' } } }));
  for (const pending of inFlight) pending.catch(() => {});
  const deadline = Date.now() + 3000;
  while (waiting.length < 16 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(waiting.length, 16);
  const cancel = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } };
  assert.equal((await rpc(request, cancel, { ...authorization, clientId: 'different-client' })).status, 202);
  assert.equal(cancels.length, 0);
  assert.equal((await rpc(request, cancel)).status, 202);
  assert.equal((await (await inFlight[0]).json()).error.code, -32800);
  const expectedId = waiting.find(item => item.body.id === 0).id;
  const end = Date.now() + 1000;
  while (!cancels.length && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(cancels, [expectedId]);
  for (const item of waiting.filter(item => item.body.id !== 0)) socket.send(JSON.stringify({ type: 'response', id: item.id, body: { jsonrpc: '2.0', id: item.body.id, result: {} } }));
  assert.equal((await Promise.all(inFlight.slice(1))).filter(response => response.status === 200).length, 15);
});

test('bridge credential rotation invalidates previously accepted sockets', { timeout: 30000 }, async t => {
  const request = await fixture(t);
  await connect(request, t);
  assert.equal((await request('/status')).status, 200);
  await request('/test/rotate');
  assert.equal((await request('/status')).status, 503);
  await connect(request, t);
  assert.equal((await request('/status')).status, 200);
});

test('relay reserves a bounded and client-fair stop lane while ordinary RPC capacity is full', { timeout: 30000 }, async t => {
  const request = await fixture(t);
  const socket = await connect(request, t);
  const waiting = [];
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.type === 'request') waiting.push(message); });
  const calls = Array.from({ length: 16 }, (_, id) => rpc(request, { jsonrpc: '2.0', id, method: 'ping' }));
  const untilCount = async length => {
    const deadline = Date.now() + 3000;
    while (waiting.length < length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(waiting.length, length);
  };
  try {
    await untilCount(16);
    assert.equal((await rpc(request, { jsonrpc: '2.0', id: 16, method: 'ping' })).status, 429);
    const stopBody = id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'stop_command', arguments: { command_id: '11111111-1111-4111-8111-111111111111' } } });
    assert.equal((await rpc(request, stopBody(17))).status, 403, 'read permission cannot consume stop reservations');
    const executeAuth = clientId => ({ ...authorization, clientId, scope: ['computer:read', 'computer:execute'] });
    calls.push(rpc(request, stopBody(20), executeAuth('owner-a')), rpc(request, stopBody(21), executeAuth('owner-a')));
    await untilCount(18);
    assert.equal((await rpc(request, stopBody(22), executeAuth('owner-a'))).status, 429, 'one client cannot occupy every stop slot');
    calls.push(rpc(request, stopBody(23), executeAuth('owner-b')), rpc(request, stopBody(24), executeAuth('owner-b')));
    await untilCount(20);
    assert.equal((await rpc(request, stopBody(25), executeAuth('owner-c'))).status, 429, 'total in-flight stop work stays bounded');
  } finally {
    for (const item of waiting) socket.send(JSON.stringify({ type: 'response', id: item.id, body: { jsonrpc: '2.0', id: item.body.id, result: {} } }));
    const responses = await Promise.all(calls);
    assert.equal(responses.length, 20);
    assert.ok(responses.every(response => response.status === 200));
  }
});
