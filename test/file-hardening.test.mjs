import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createToolRuntime } from '../local/tools.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-file-hardening-'));
  const root = path.join(base, 'workspace'), stateDir = path.join(base, 'state'), sourceRoot = path.join(base, 'runtime');
  await Promise.all([root, stateDir, sourceRoot].map(value => fs.mkdir(value)));
  const runtime = await createToolRuntime({ roots: [root], stateDir, sourceRoot, allowExec: false });
  t.after(async () => {
    await runtime.close();
    assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(base).startsWith('bridge-file-hardening-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  let id = 0;
  return { base, root, stateDir, sourceRoot, runtime, call: (name, args = {}, options = {}) => runtime.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, options) };
}
const ok = response => { assert.notEqual(response.result?.isError, true, response.result?.content?.[0]?.text); return response.result.structuredContent; };
const denied = response => { assert.equal(response.result?.isError, true); return response.result.content[0].text; };

test('runtime refuses workspaces overlapping private state or trusted code', async t => {
  const { base, root, stateDir, sourceRoot, call } = await fixture(t);
  await assert.rejects(createToolRuntime({ roots: [base], stateDir, sourceRoot }), /separate/);
  await assert.rejects(createToolRuntime({ roots: [sourceRoot], stateDir, sourceRoot }), /separate/);
  const source = path.join(sourceRoot, 'canary.mjs');
  await fs.writeFile(source, 'original');
  denied(await call('write_file', { path: source, content: 'replacement', overwrite: true }));
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  assert.equal(ok(await call('computer_context')).roots[0], root);
});

test('hard-linked files cannot be read, edited, overwritten or deleted', async t => {
  const { root, stateDir, call } = await fixture(t);
  const protectedFile = path.join(stateDir, 'fake-canary.txt'), linked = path.join(root, 'linked.txt');
  await fs.writeFile(protectedFile, 'fake protected content');
  await fs.link(protectedFile, linked);
  denied(await call('read_file', { path: linked }));
  denied(await call('write_file', { path: linked, overwrite: true, content: 'replacement' }));
  denied(await call('edit_file', { path: linked, old_text: 'fake', new_text: 'changed' }));
  denied(await call('delete_file', { path: linked }));
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'fake protected content');
});

test('namespace substitution at open is rejected before returned content', async t => {
  const { base, root, call } = await fixture(t);
  const inside = path.join(root, 'safe'), saved = path.join(root, 'saved'), outside = path.join(base, 'outside');
  await fs.mkdir(inside); await fs.mkdir(outside);
  await fs.writeFile(path.join(inside, 'canary.txt'), 'inside');
  await fs.writeFile(path.join(outside, 'canary.txt'), 'outside fixture');
  const open = fs.open;
  let swapped = false;
  fs.open = async function (file, ...args) {
    if (file === path.join(inside, 'canary.txt') && !swapped) {
      swapped = true;
      await fs.rename(inside, saved);
      await fs.symlink(outside, inside, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return open.call(this, file, ...args);
  };
  try { denied(await call('read_file', { path: path.join(inside, 'canary.txt') })); assert.equal(swapped, true); }
  finally { fs.open = open; }
});

test('failed temporary write leaves original intact and removes temporary file', async t => {
  const { root, call } = await fixture(t);
  const file = path.join(root, 'important.txt');
  await fs.writeFile(file, 'original complete contents');
  const open = fs.open;
  fs.open = async function (target, ...args) {
    const handle = await open.call(this, target, ...args);
    if (path.basename(String(target)).startsWith('.agentdock-write-')) {
      const write = handle.write.bind(handle);
      handle.write = async (...writeArgs) => {
        await write(writeArgs[0], writeArgs[1], Math.min(3, writeArgs[2]), writeArgs[3]);
        throw Object.assign(new Error('Simulated disk failure'), { code: 'ENOSPC' });
      };
    }
    return handle;
  };
  try { denied(await call('edit_file', { path: file, old_text: 'original', new_text: 'updated' })); }
  finally { fs.open = open; }
  assert.equal(await fs.readFile(file, 'utf8'), 'original complete contents');
  assert.deepEqual(await fs.readdir(root), ['important.txt']);
});

test('directory traversal and list results have explicit work limits', async t => {
  const { root, call } = await fixture(t);
  await Promise.all(Array.from({ length: 200 }, (_, index) => fs.mkdir(path.join(root, `empty-${index}`))));
  const found = ok(await call('search_files', { query: 'not present', limit: 1 }));
  assert.equal(found.inspected_files, 0);
  assert.ok(found.inspected_directories <= 128);
  assert.ok(found.inspected_entries <= 5000);
  assert.equal(found.truncated, true);
  assert.equal(found.budget_exhausted, 'directories');
  const list = ok(await call('list_directory', { limit: 3 }));
  assert.equal(list.entries.length, 3);
  assert.equal(list.total, null);
  assert.equal(list.truncated, true);
});

test('pre-cancelled operations have no file side effects', async t => {
  const { root, call } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  assert.match(denied(await call('write_file', { path: 'must-not-exist.txt', content: 'cancelled' }, { signal: controller.signal })), /cancelled/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('cancellation during temporary write preserves prior content', async t => {
  const { root, call } = await fixture(t);
  const target = path.join(root, 'keep.txt');
  await fs.writeFile(target, 'keep original');
  const controller = new AbortController(), open = fs.open;
  fs.open = async function (file, ...args) {
    const handle = await open.call(this, file, ...args);
    if (path.basename(String(file)).startsWith('.agentdock-write-')) {
      const write = handle.write.bind(handle);
      handle.write = async (...parameters) => { const value = await write(...parameters); controller.abort(); return value; };
    }
    return handle;
  };
  try { assert.match(denied(await call('write_file', { path: target, overwrite: true, content: 'x'.repeat(128 * 1024) }, { signal: controller.signal })), /cancelled/); }
  finally { fs.open = open; }
  assert.equal(await fs.readFile(target, 'utf8'), 'keep original');
  assert.deepEqual(await fs.readdir(root), ['keep.txt']);
});

test('search byte budget includes rejected binary files', async t => {
  const { root, call } = await fixture(t);
  for (let i = 0; i < 20; i++) await fs.writeFile(path.join(root, `binary-${i}.dat`), Buffer.alloc(1024 * 1024));
  const found = ok(await call('search_files', { query: 'none' }));
  assert.ok(found.read_bytes <= 16 * 1024 * 1024);
  assert.equal(found.budget_exhausted, 'bytes');
  assert.equal(found.truncated, true);
});

test('paginated reads reject content modified while the handle is being read', async t => {
  const { root, call } = await fixture(t);
  const file = path.join(root, 'changing.txt');
  await fs.writeFile(file, 'original contents');
  const open = fs.open;
  let changed = false;
  fs.open = async function (target, ...args) {
    const handle = await open.call(this, target, ...args);
    if (target === file) {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        const result = await read(...parameters);
        if (!changed) { changed = true; await fs.appendFile(file, ' appended concurrently'); }
        return result;
      };
    }
    return handle;
  };
  try { assert.match(denied(await call('read_file', { path: file, max_bytes: 4 })), /changed during read/); }
  finally { fs.open = open; }
  assert.equal(changed, true);
});
