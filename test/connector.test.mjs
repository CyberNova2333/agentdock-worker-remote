import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { once, EventEmitter } from 'node:events';
import { BridgeConnector } from '../local/connector.mjs';
import { RequestReceipts, TransientReceipts } from '../local/receipts.mjs';
import { LocalApprovals } from '../local/approvals.mjs';
import { approveRequest, safeText } from '../local/approval-cli.mjs';
import { validateRequestEnvelope } from '../local/request-policy.mjs';
import { atomicJson, ApprovalRecordTooLargeError } from '../local/approval-store.mjs';
import { connectionLiveness } from '../cloud/liveness.mjs';

const auth = { userId: 'owner', clientId: 'isolated-test-client', scope: ['computer:read', 'computer:write', 'computer:execute'] };
const frame = (body, changes = {}) => ({ type: 'request', id: randomUUID(), issuedAt: Date.now(), deadline: Date.now() + 100000, authorization: structuredClone(auth), body, ...changes });
const call = (name, args = {}, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) throw new Error('Condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function state(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-transport-safe-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('bridge-transport-safe-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
async function harness(t, runtime) {
  const stateDir = await state(t);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const sockets = [];
  const received = new Map();
  server.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer fake-unit-test-token');
    sockets.push(socket);
    socket.on('message', data => {
      const message = JSON.parse(data);
      if (message.type === 'ping') socket.send('{"type":"pong"}');
      else if (message.type === 'response') received.set(message.id, message);
    });
  });
  const options = { origin: `http://127.0.0.1:${server.address().port}`, bridgeToken: 'fake-unit-test-token', runtime, stateDir, proxyProvider: () => [null] };
  let connector = new BridgeConnector(options);
  await connector.start();
  await until(() => sockets.length === 1);
  t.after(async () => { await connector.stop(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  return {
    stateDir, sockets, options, get connector() { return connector; },
    async request(message) {
      received.delete(message.id);
      sockets.at(-1).send(JSON.stringify(message));
      await until(() => received.has(message.id));
      return received.get(message.id).body;
    },
    async restart() { await connector.stop(); connector = new BridgeConnector(options); await connector.start(); await until(() => sockets.length === 2); },
  };
}

test('connector validates authorization, records requests durably, and rejects duplicate IDs across restarts', async t => {
  let calls = 0;
  const h = await harness(t, { handleRpc: async body => ({ jsonrpc: '2.0', id: body.id, result: { calls: ++calls } }), close: async () => {} });
  const body = call('read_file', { path: '/workspace/fake-canary.txt' });
  const needed = await h.request(frame(body));
  const directory = path.join(h.stateDir, 'approvals');
  const pending = JSON.parse(await fs.readFile(path.join(directory, `${needed.error.data.approval_id}.request.json`), 'utf8'));
  await approveRequest(directory, pending);
  const message = frame({ ...body, id: 2 });
  assert.equal((await h.request(message)).result.calls, 1);
  assert.equal((await h.request(message)).error.data.reason, 'already_attempted');
  assert.equal((await h.request({ ...message, body: { ...message.body, id: 3 } })).error.data.reason, 'request_id_conflict');
  await h.restart();
  assert.equal((await h.request(message)).error.data.reason, 'already_attempted');
  assert.equal(calls, 1);
});

test('sensitive reads require exact local approval, a changed RPC ID is allowed, and approval is single use', async t => {
  let calls = 0;
  const h = await harness(t, { handleRpc: async body => ({ jsonrpc: '2.0', id: body.id, result: { calls: ++calls } }), close: async () => {} });
  const first = await h.request(frame(call('read_file', { path: '/workspace/canary.txt' })));
  assert.equal(first.error.data.code, 'LOCAL_APPROVAL_REQUIRED');
  assert.equal(calls, 0);
  const directory = path.join(h.stateDir, 'approvals');
  const pending = JSON.parse(await fs.readFile(path.join(directory, `${first.error.data.approval_id}.request.json`), 'utf8'));
  await approveRequest(directory, pending);
  const changed = await h.request(frame(call('read_file', { path: '/workspace/different.txt' }, 2)));
  assert.equal(changed.error.data.code, 'LOCAL_APPROVAL_REQUIRED');
  const approved = await h.request(frame(call('read_file', { path: '/workspace/canary.txt' }, 3)));
  assert.equal(approved.result.calls, 1);
  const again = await h.request(frame(call('read_file', { path: '/workspace/canary.txt' }, 4)));
  assert.equal(again.error.data.code, 'LOCAL_APPROVAL_REQUIRED');
  assert.equal(calls, 1);
});

test('approval size rejection is actionable without exposing arbitrary local errors', async t => {
  let calls = 0;
  const h = await harness(t, { handleRpc: async () => { calls++; }, close: async () => {} });
  h.connector.approvals.authorize = async () => { throw new ApprovalRecordTooLargeError(); };
  const rejected = await h.request(frame(call('read_file', { path: '/workspace/canary.txt' })));
  assert.match(rejected.error.message, /approval size limit/i);
  assert.equal(rejected.error.data.code, 'APPROVAL_RECORD_TOO_LARGE');
  assert.equal(rejected.error.data.approval_id, undefined);
  assert.deepEqual(await fs.readdir(path.join(h.stateDir, 'approvals')), []);
  h.connector.approvals.authorize = async () => { throw new Error('synthetic-private-error-marker'); };
  const ordinary = await h.request(frame(call('read_file', { path: '/workspace/canary.txt' })));
  assert.ok(ordinary.error);
  assert.doesNotMatch(JSON.stringify(ordinary), /synthetic-private-error-marker/);
  assert.equal(calls, 0);
});

test('connector denies missing client identity, insufficient scopes, stale requests and unknown tools', async t => {
  let calls = 0;
  const h = await harness(t, { handleRpc: async () => { calls++; }, close: async () => {} });
  const samples = [
    frame(call('exec_command'), { authorization: undefined }),
    frame(call('exec_command'), { authorization: { ...auth, scope: ['computer:read'] } }),
    frame(call('unknown_tool')),
    frame(call('read_file'), { deadline: Date.now() - 1 }),
    frame(call('read_file'), { issuedAt: Date.now() + 60000 }),
  ];
  for (const message of samples) assert.ok((await h.request(message)).error);
  assert.equal(calls, 0);
});

test('cloud cancellation and disconnect abort local in-flight work without replay', async t => {
  let calls = 0, cancelled = 0;
  const h = await harness(t, {
    handleRpc: async (body, { signal }) => {
      calls++;
      await new Promise(resolve => signal.addEventListener('abort', () => { cancelled++; resolve(); }, { once: true }));
      return { jsonrpc: '2.0', id: body.id, result: {} };
    }, close: async () => {},
  });
  const first = frame({ jsonrpc: '2.0', id: 1, method: 'ping' });
  h.sockets[0].send(JSON.stringify(first));
  await until(() => calls === 1);
  h.sockets[0].send(JSON.stringify({ type: 'cancel', id: first.id }));
  await until(() => cancelled === 1);
  const second = frame({ jsonrpc: '2.0', id: 2, method: 'ping' });
  h.sockets[0].send(JSON.stringify(second));
  await until(() => calls === 2);
  h.sockets[0].terminate();
  await until(() => cancelled === 2 && h.sockets.length === 2);
  assert.equal((await h.request(second)).error.data.reason, 'already_attempted');
  assert.equal(calls, 2);
});

test('receipt storage is bounded, fails closed on incomplete records and does not retain request text', async t => {
  const directory = await state(t);
  const receipts = new RequestReceipts(directory, { maximum: 1 });
  const message = frame(call('write_file', { path: 'fake.txt', content: 'private-canary-never-recorded' }));
  assert.equal((await receipts.claim(message)).acquired, true);
  await assert.rejects(receipts.claim(frame({ jsonrpc: '2.0', id: 2, method: 'ping' })), /capacity/);
  const file = path.join(receipts.directory, (await fs.readdir(receipts.directory))[0]);
  assert.equal((await fs.readFile(file, 'utf8')).includes('private-canary'), false);
  await fs.writeFile(file, '{');
  assert.equal((await receipts.claim(message)).reason, 'duplicate_or_incomplete');
});

test('approval binds client and scopes, expires, and refuses a changed local record', async t => {
  const directory = await state(t);
  let now = Date.now();
  const approvals = new LocalApprovals(directory, 'https://example.test', { now: () => now });
  const body = call('exec_command', { cmd: 'echo safe', network: 'none' });
  const first = await approvals.authorize(body, auth);
  const pendingFile = path.join(approvals.directory, `${first.id}.request.json`);
  const pending = JSON.parse(await fs.readFile(pendingFile, 'utf8'));
  const otherClient = await approvals.authorize(body, { ...auth, clientId: 'another-client' });
  assert.notEqual(otherClient.id, first.id);
  const otherNetwork = await approvals.authorize(call('exec_command', { cmd: 'echo safe', network: 'outbound' }), auth);
  assert.notEqual(otherNetwork.id, first.id);
  await fs.writeFile(pendingFile, JSON.stringify({ ...pending, createdAt: pending.createdAt + 1 }));
  await assert.rejects(approveRequest(approvals.directory, pending), /changed/);
  now += 300001;
  const expired = await approvals.authorize(body, auth);
  assert.notEqual(expired.id, first.id);
});

test('approval remains valid when the clock ticks during record creation', async t => {
  const directory = await state(t);
  let now = Date.now();
  const approvals = new LocalApprovals(directory, 'https://example.test', { now: () => now++ });
  const body = call('read_file', { path: '/workspace/disposable-canary.txt' });
  const first = await approvals.authorize(body, auth);
  const pending = JSON.parse(await fs.readFile(path.join(approvals.directory, `${first.id}.request.json`), 'utf8'));
  assert.equal(pending.expiresAt - pending.createdAt, 300000);
  await approveRequest(approvals.directory, pending, now++);
  assert.equal((await approvals.authorize(body, auth)).approved, true);
  assert.equal((await approvals.authorize(body, auth)).approved, false);
});

test('health requires a recent heartbeat and console previews escape control and bidi characters', () => {
  assert.equal(connectionLiveness(1000, undefined, 1001).online, false);
  assert.equal(connectionLiveness(1000, undefined, 1001).reserved, true);
  assert.equal(connectionLiveness(1000, undefined, 11000).reserved, false);
  assert.equal(connectionLiveness(1000, 1200, 65000).online, true);
  assert.equal(connectionLiveness(1000, 1200, 66200).reserved, false);
  assert.equal(safeText('a\x1b[2J\u202eb'), 'a\\u001b[2J\\u202eb');
});

test('connector rejects insecure origins and a missing protected receipt directory', () => {
  const runtime = { handleRpc() {}, close() {} };
  for (const origin of ['http://example.com', 'https://owner:password@example.com', 'https://example.com/mcp', 'https://example.com/?token=secret']) assert.throws(() => new BridgeConnector({ origin, runtime, bridgeToken: 'fake' }));
  assert.throws(() => new BridgeConnector({ origin: 'https://example.com', runtime, bridgeToken: 'fake' }), /state directory/);
  assert.throws(() => validateRequestEnvelope(frame(call('read_file'), { deadline: Date.now() + 999999 })), /deadline/);
});

test('unapproved and control traffic cannot exhaust the durable execution journal', async t => {
  const h = await harness(t, { handleRpc: async body => ({ jsonrpc: '2.0', id: body.id, result: {} }), close: async () => {} });
  h.connector.receipts.maximum = 1;
  h.connector.controlReceipts = new TransientReceipts({ maximum: 2 });
  for (let id = 0; id < 2; id++) assert.ok((await h.request(frame({ jsonrpc: '2.0', id, method: 'ping' }))).result);
  assert.equal((await h.request(frame({ jsonrpc: '2.0', id: 3, method: 'ping' }))).error.data.reason, 'control_capacity');
  const body = call('read_file', { path: '/workspace/canary.txt' });
  const needed = await h.request(frame(body));
  assert.equal(needed.error.data.code, 'LOCAL_APPROVAL_REQUIRED');
  assert.equal((await fs.readdir(path.join(h.stateDir, 'request-receipts'))).length, 0);
  const pending = JSON.parse(await fs.readFile(path.join(h.stateDir, 'approvals', `${needed.error.data.approval_id}.request.json`), 'utf8'));
  await approveRequest(path.join(h.stateDir, 'approvals'), pending);
  assert.ok((await h.request(frame(body))).result, 'approved work still runs when the separate control cache is full');
  assert.equal((await fs.readdir(path.join(h.stateDir, 'request-receipts'))).length, 1);
});

test('ordinary control saturation cannot deny an authorized stop or mix client replay identities', async t => {
  const stateDir = await state(t);
  const received = new Map();
  let stopped = 0;
  class FakeSocket extends EventEmitter {
    readyState = 1;
    send(text) { const response = JSON.parse(text); if (response.type === 'response') received.get(response.id)?.(response.body); }
    close() { this.readyState = 3; this.emit('close', 1000); }
    terminate() { this.close(); }
  }
  const socket = new FakeSocket();
  const connector = new BridgeConnector({ origin: 'http://127.0.0.1', bridgeToken: 'fake', stateDir, proxyProvider: () => [null], socketFactory: () => socket,
    runtime: { async handleRpc(body, options) {
      if (body.params?.name === 'stop_command') { assert.equal(options.authorization.clientId, 'job-owner'); stopped++; }
      return { jsonrpc: '2.0', id: body.id, result: {} };
    }, async close() {} },
  });
  await connector.start();
  t.after(() => connector.stop());
  const request = message => new Promise(resolve => { received.set(message.id, value => { received.delete(message.id); resolve(value); }); socket.emit('message', Buffer.from(JSON.stringify(message)), false); });
  const readAuth = clientId => ({ userId: 'owner', clientId, scope: ['computer:read'] });
  for (let index = 0; index < 100; index++) assert.ok((await request(frame(call('computer_context'), { authorization: readAuth('noisy-client') }))).result);
  assert.equal((await request(frame(call('computer_context'), { authorization: readAuth('noisy-client') }))).error.data.reason, 'control_client_capacity');
  assert.ok((await request(frame({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { authorization: readAuth('independent-client') }))).result);
  // Fill the remaining shared ordinary cache without touching the stop lane.
  for (let client = 0; client < 20; client++) for (let index = 0; index < 100; index++) connector.controlReceipts.claim(frame(call('computer_context'), { authorization: readAuth(`bulk-${client}`) }));
  assert.equal(connector.controlReceipts.records.size, 1000);
  const stop = frame(call('stop_command', { command_id: '11111111-1111-4111-8111-111111111111' }), { authorization: { ...auth, clientId: 'job-owner' } });
  assert.ok((await request(stop)).result);
  assert.equal(stopped, 1);
  assert.equal((await request(stop)).error.data.reason, 'already_attempted');
  assert.equal((await request({ ...stop, body: call('stop_command', { command_id: '22222222-2222-4222-8222-222222222222' }) })).error.data.reason, 'request_id_conflict');
  assert.ok((await request(frame(stop.body, { authorization: readAuth('noisy-client') }))).error);
  assert.equal(stopped, 1, 'insufficient scopes and duplicates never reach the runtime');
});

test('local stop admission remains bounded and available when ordinary requests are in flight', async t => {
  const waiting = [];
  const h = await harness(t, { handleRpc: async (body, { authorization, signal }) => {
    if (body.params?.name === 'stop_command') return { jsonrpc: '2.0', id: body.id, result: { owner: authorization.clientId } };
    await new Promise(resolve => { waiting.push(resolve); signal.addEventListener('abort', resolve, { once: true }); });
    return { jsonrpc: '2.0', id: body.id, result: {} };
  }, close: async () => { waiting.forEach(resolve => resolve()); } });
  try {
    for (let id = 0; id < 16; id++) h.sockets[0].send(JSON.stringify(frame({ jsonrpc: '2.0', id, method: 'ping' })));
    await until(() => waiting.length === 16);
    const busy = await h.request(frame({ jsonrpc: '2.0', id: 17, method: 'ping' }));
    assert.equal(busy.error.data.reason, 'inflight_capacity');
    const stop = await h.request(frame(call('stop_command', { command_id: '11111111-1111-4111-8111-111111111111' }, 18)));
    assert.equal(stop.result.owner, auth.clientId);
    assert.equal(h.sockets[0].readyState, 1, 'rejected ordinary overload must not disconnect active work');
    assert.equal(h.connector.inflight.size, 16);
  } finally { waiting.forEach(resolve => resolve()); }
});

test('a concurrent duplicate stop is rejected before reaching the task runtime twice', async t => {
  const stateDir = await state(t);
  const received = [];
  let stops = 0, release;
  class FakeSocket extends EventEmitter {
    readyState = 1;
    send(text) { const value = JSON.parse(text); if (value.type === 'response') received.push(value.body); }
    close() { this.readyState = 3; this.emit('close', 1000); }
    terminate() { this.close(); }
  }
  const socket = new FakeSocket();
  const connector = new BridgeConnector({ origin: 'http://127.0.0.1', bridgeToken: 'fake', stateDir, proxyProvider: () => [null], socketFactory: () => socket,
    runtime: { async handleRpc(body, { signal }) {
      stops++;
      await new Promise(resolve => { release = resolve; signal.addEventListener('abort', resolve, { once: true }); });
      return { jsonrpc: '2.0', id: body.id, result: { stopped: true } };
    }, async close() { release?.(); } },
  });
  await connector.start();
  t.after(() => connector.stop());
  const message = frame(call('stop_command', { command_id: '11111111-1111-4111-8111-111111111111' }));
  const emit = () => socket.emit('message', Buffer.from(JSON.stringify(message)), false);
  try {
    emit(); await until(() => stops === 1);
    emit(); await until(() => received.length === 1);
    assert.match(received[0].error.message, /already being processed/);
    release(); await until(() => received.length === 2);
    assert.equal(received[1].result.stopped, true);
    assert.equal(stops, 1);
  } finally { release?.(); }
});

test('approval storage recovers partial files and one client cannot fill every pending slot', async t => {
  const directory = await state(t);
  const approvals = new LocalApprovals(directory, 'https://example.test');
  await approvals.ready;
  const broken = randomUUID();
  await fs.writeFile(path.join(approvals.directory, `${broken}.request.json`), '{');
  await fs.writeFile(path.join(approvals.directory, `${broken}.approved.json`), '{');
  const body = call('read_file', { path: '/workspace/canary.txt' });
  const first = await approvals.authorize(body, auth);
  assert.equal(first.approved, false);
  assert.equal(await fs.access(path.join(approvals.directory, `${broken}.request.json`)).then(() => true, () => false), false);
  await fs.writeFile(path.join(approvals.directory, `${first.id}.approved.json`), '{');
  assert.equal((await approvals.authorize(body, auth)).approved, false);
  const pending = JSON.parse(await fs.readFile(path.join(approvals.directory, `${first.id}.request.json`), 'utf8'));
  await approveRequest(approvals.directory, pending);
  assert.equal((await approvals.authorize(body, auth)).approved, true);
  for (let n = 0; n < 8; n++) await approvals.authorize(call('read_file', { path: `/workspace/file-${n}.txt` }), auth);
  await assert.rejects(approvals.authorize(call('read_file', { path: '/workspace/ninth.txt' }), auth), /this client/);
  assert.equal((await approvals.authorize(body, { ...auth, clientId: 'other-authorized-client' })).approved, false);
});

test('failed approval publication leaves no final record and abort cannot consume a valid approval', async t => {
  const directory = await state(t);
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.tmp')) handle.writeFile = async () => { await handle.write('{'); throw new Error('Injected bounded write failure'); };
    return handle;
  };
  try { await assert.rejects(atomicJson(path.join(directory, 'final.json'), { safe: true }), /Injected/); }
  finally { fs.open = originalOpen; }
  assert.deepEqual(await fs.readdir(directory), []);
  const approvals = new LocalApprovals(directory, 'https://example.test');
  const body = call('read_file', { path: '/workspace/canary.txt' });
  const first = await approvals.authorize(body, auth);
  const pending = JSON.parse(await fs.readFile(path.join(approvals.directory, `${first.id}.request.json`), 'utf8'));
  await approveRequest(approvals.directory, pending);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(approvals.authorize(body, auth, { signal: controller.signal }), /abort/i);
  assert.equal((await approvals.authorize(body, auth)).approved, true);
});

test('shutdown refuses newly arriving frames before the close handshake completes', async t => {
  const stateDir = await state(t);
  let calls = 0;
  class FakeSocket extends EventEmitter {
    readyState = WebSocket.OPEN;
    send() {}
    close() {
      this.emit('message', Buffer.from(JSON.stringify(frame(call('computer_context')))), false);
      setTimeout(() => { this.readyState = WebSocket.CLOSED; this.emit('close', 1000); }, 50);
    }
    terminate() { this.readyState = WebSocket.CLOSED; this.emit('close', 1000); }
  }
  const connector = new BridgeConnector({ origin: 'http://127.0.0.1', bridgeToken: 'fake', stateDir, proxyProvider: () => [null], socketFactory: () => new FakeSocket(), runtime: { handleRpc: async () => { calls++; }, close: async () => {} } });
  await connector.start(); await connector.stop();
  assert.equal(calls, 0);
});

test('local request parsing rejects nonfinite IDs, malformed params and excessive structure', () => {
  assert.throws(() => validateRequestEnvelope(frame({ jsonrpc: '2.0', id: Infinity, method: 'ping' })), /JSON-RPC/);
  assert.throws(() => validateRequestEnvelope(frame({ jsonrpc: '2.0', id: 1, method: 'ping', params: [] })), /parameters/);
  let nested = {}; for (let n = 0; n < 40; n++) nested = { next: nested };
  assert.throws(() => validateRequestEnvelope(frame(call('read_file', { nested }))), /budget/);
});

test('stop during asynchronous startup cannot reopen a connector after shutdown', async t => {
  const stateDir = await state(t);
  let opened = 0, release;
  const connector = new BridgeConnector({ origin: 'http://127.0.0.1', bridgeToken: 'fake', stateDir, proxyProvider: () => [null], socketFactory: () => { opened++; throw new Error('Must remain stopped'); }, runtime: { close: async () => {}, handleRpc() {} } });
  await Promise.all([connector.receipts.ready, connector.approvals.ready]);
  connector.receipts.ready = new Promise(resolve => { release = resolve; });
  const starting = connector.start();
  await connector.stop();
  release(); await starting;
  assert.equal(opened, 0); assert.equal(connector.running, false);
});
