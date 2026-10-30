import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createToolRuntime } from '../local/tools.mjs';

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbnv-bridge-test-'));
  const root = path.join(dir, 'project'), state = path.join(dir, 'private');
  await fs.mkdir(root); await fs.mkdir(state);
  const runtime = await createToolRuntime({ roots: [root], defaultCwd: root, stateDir: state, allowExec: false, ...options });
  t.after(async () => { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); });
  let id = 0;
  return { dir, root, state, runtime, call: async (name, args = {}) => runtime.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) };
}
const data = (reply) => { assert.equal(reply.result.isError, undefined, reply.result.content?.[0]?.text); return reply.result.structuredContent; };
const rejects = (reply, pattern) => { assert.equal(reply.result.isError, true); assert.match(reply.result.content[0].text, pattern); };

test('file lifecycle and exact edits detect stale or ambiguous changes', async (t) => {
  const { call, root } = await fixture(t);
  data(await call('write_file', { path: 'hello.txt', content: 'one two\n' }));
  rejects(await call('write_file', { path: 'hello.txt', content: 'oops' }), /already exists/);
  const read = data(await call('read_file', { path: 'hello.txt' }));
  assert.equal(read.content, 'one two\n');
  rejects(await call('edit_file', { path: 'hello.txt', old_text: 'one', new_text: 'three', expected_sha256: '0'.repeat(64) }), /changed/);
  data(await call('edit_file', { path: 'hello.txt', old_text: 'one', new_text: 'two', expected_sha256: read.sha256 }));
  rejects(await call('edit_file', { path: 'hello.txt', old_text: 'two', new_text: 'four' }), /not unique/);
  rejects(await call('delete_file', { path: root }), /regular files/);
  data(await call('delete_file', { path: 'hello.txt' }));
  await assert.rejects(fs.access(path.join(root, 'hello.txt')));
});

test('file paths cannot escape roots or expose connector state', async (t) => {
  const { call, dir, root, state } = await fixture(t);
  await fs.writeFile(path.join(dir, 'outside.txt'), 'secret');
  await fs.writeFile(path.join(state, 'key.txt'), 'secret');
  rejects(await call('read_file', { path: '../outside.txt' }), /outside approved/);
  rejects(await call('read_file', { path: path.join(state, 'key.txt') }), /private connector/);
  rejects(await call('write_file', { path: '../new.txt', content: 'bad' }), /outside approved/);
  rejects(await call('write_file', { path: path.join(state, 'new.txt'), content: 'bad' }), /private connector/);
  const entries = data(await call('list_directory')).entries;
  assert.ok(!entries.some((entry) => entry.name === 'private'));
});

test('symlink/junction escape is denied for both existing and new files', async (t) => {
  const { call, dir, root } = await fixture(t);
  const outside = path.join(dir, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  try { await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Creating symlinks is unavailable.'); return; } throw error; }
  rejects(await call('read_file', { path: 'link/secret.txt' }), /outside approved/);
  rejects(await call('write_file', { path: 'link/new.txt', content: 'bad' }), /outside approved/);
  const found = data(await call('search_files', { query: 'secret' })); assert.equal(found.matches.length, 0);
});

test('Windows alternate streams and device aliases cannot bypass file boundaries', { skip: process.platform !== 'win32' }, async (t) => {
  const { call } = await fixture(t);
  for (const file of ['sample.txt:hidden', 'CON', 'nul.txt', 'COM1', 'LPT1.txt', '\\\\?\\C:\\Windows\\win.ini', 'trailing.']) {
    rejects(await call('write_file', { path: file, content: 'bad' }), /not (?:allowed|exposed)/);
  }
});

test('read pagination and search limits are bounded', async (t) => {
  const { call, root } = await fixture(t);
  await fs.writeFile(path.join(root, 'sample.txt'), 'alpha\nbeta\nALPHA\n');
  const first = data(await call('read_file', { path: 'sample.txt', max_bytes: 6 }));
  assert.equal(first.content, 'alpha\n'); assert.equal(first.next_offset, 6);
  assert.equal(data(await call('read_file', { path: 'sample.txt', offset: 6, max_bytes: 5 })).content, 'beta\n');
  const found = data(await call('search_files', { query: 'alpha', limit: 1 }));
  assert.equal(found.matches.length, 1); assert.equal(found.truncated, true);
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
  rejects(await call('read_file', { path: 'binary.bin' }), /Binary/);
});

test('UTF-8 pagination preserves Chinese and emoji without replacement characters', async (t) => {
  const { call, root } = await fixture(t);
  const original = '你好🙂中文🚀结束';
  await fs.writeFile(path.join(root, 'unicode.txt'), original);
  let offset = 0, joined = '', pages = 0;
  do {
    const reply = data(await call('read_file', { path: 'unicode.txt', offset, max_bytes: 4 }));
    assert.ok(!reply.content.includes('\ufffd'));
    assert.ok(reply.bytes_read <= 4);
    joined += reply.content;
    pages++;
    offset = reply.next_offset;
  } while (offset !== null);
  assert.equal(joined, original);
  assert.ok(pages > 2);
  rejects(await call('read_file', { path: 'unicode.txt', offset: 1, max_bytes: 4 }), /inside a UTF-8 character/);
  rejects(await call('read_file', { path: 'unicode.txt', max_bytes: 1 }), /too small/);
  await fs.writeFile(path.join(root, 'invalid-utf8.txt'), Buffer.from([0xc3]));
  rejects(await call('read_file', { path: 'invalid-utf8.txt' }), /not valid UTF-8/);
});

test('malformed Unicode is rejected before file creation, replacement or path lookup', async t => {
  const { call, root } = await fixture(t);
  const original = '原文🙂与 literal \ufffd 保持不变';
  const existing = path.join(root, 'existing.txt');
  const replacementName = '\ufffd.txt';
  await fs.writeFile(existing, original);
  await fs.writeFile(path.join(root, replacementName), original);
  const before = await fs.stat(existing);
  const malformed = ['\ud800', '\udc00', 'before\ud800after', '\ud800\ud800', '\udc00\udc00'];
  for (const value of malformed) {
    rejects(await call('write_file', { path: 'new.txt', content: value }), /Invalid Unicode/);
    rejects(await call('write_file', { path: 'existing.txt', overwrite: true, content: value }), /Invalid Unicode/);
    rejects(await call('edit_file', { path: 'existing.txt', old_text: '原文', new_text: value }), /Invalid Unicode/);
    rejects(await call('edit_file', { path: 'existing.txt', old_text: value, new_text: 'changed' }), /Invalid Unicode/);
    rejects(await call('search_files', { query: value }), /Invalid Unicode/);
    const badPath = `${value}.txt`;
    rejects(await call('read_file', { path: badPath }), /Invalid Unicode/);
    rejects(await call('write_file', { path: badPath, overwrite: true, content: 'changed' }), /Invalid Unicode/);
    rejects(await call('edit_file', { path: badPath, old_text: '原文', new_text: 'changed' }), /Invalid Unicode/);
    rejects(await call('delete_file', { path: badPath }), /Invalid Unicode/);
  }
  assert.equal(await fs.readFile(existing, 'utf8'), original);
  assert.equal(await fs.readFile(path.join(root, replacementName), 'utf8'), original);
  assert.deepEqual((await fs.readdir(root)).sort(), ['existing.txt', replacementName].sort());
  const after = await fs.stat(existing);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  const validName = '中文🙂.txt';
  data(await call('write_file', { path: validName, content: original }));
  data(await call('edit_file', { path: validName, old_text: '原文🙂', new_text: '修订🚀' }));
  assert.equal(data(await call('read_file', { path: validName })).content, original.replace('原文🙂', '修订🚀'));
});

test('JSON-RPC negotiation, malformed messages and disabled commands', async (t) => {
  const { runtime } = await fixture(t, { allowExec: false });
  const init = await runtime.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(await runtime.handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await runtime.handleRpc([])).error.code, -32600);
  assert.equal((await runtime.handleRpc({ jsonrpc: '2.0', id: 2, method: 'missing' })).error.code, -32601);
  const list = await runtime.handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.ok(!list.result.tools.some((tool) => tool.name === 'exec_command'));
  assert.equal((await runtime.handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'exec_command', arguments: { cmd: 'echo hi' } } })).error.code, -32602);
});

test('file runtime cannot enable host execution or expose command handlers', async t => {
  const { root, state, runtime, call } = await fixture(t);
  await assert.rejects(createToolRuntime({ roots: [root], stateDir: state, allowExec: true }), /Direct host execution is unavailable/);
  assert.equal(data(await call('computer_context')).command_execution, false);
  const listed = await runtime.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const name of ['exec_command', 'command_status', 'stop_command']) {
    assert.ok(!listed.result.tools.some(tool => tool.name === name));
    assert.equal((await call(name, {})).error.code, -32602);
  }
});
