import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFilePolicy } from '../local/file-safety.mjs';

test('file policy refuses malformed Unicode before opening any file for writing', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdock-unicode-policy-'));
  const root = path.join(base, 'workspace'), stateDir = path.join(base, 'state');
  await fs.mkdir(root); await fs.mkdir(stateDir);
  t.after(async () => {
    assert.equal(path.dirname(base), os.tmpdir());
    assert.ok(path.basename(base).startsWith('agentdock-unicode-policy-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  const policy = await createFilePolicy({ roots: [root], stateDir }, () => {});
  const file = path.join(root, 'canary.txt');
  await fs.writeFile(file, 'unchanged');
  const prior = await fs.stat(file);
  const open = fs.open;
  let opened = 0;
  fs.open = async (...args) => { opened++; return open(...args); };
  try {
    await assert.rejects(policy.atomicWrite(file, '\ud800', { overwrite: true, prior }), /Invalid Unicode file content/);
    await assert.rejects(policy.atomicWrite(path.join(root, 'new.txt'), '\udc00'), /Invalid Unicode file content/);
    await assert.rejects(policy.resolve(path.join(root, '\ud800.txt')), /Invalid Unicode file path/);
    assert.equal(opened, 0, 'invalid text must be rejected before temporary-file creation');
  } finally { fs.open = open; }
  assert.equal(await fs.readFile(file, 'utf8'), 'unchanged');
  assert.deepEqual(await fs.readdir(root), ['canary.txt']);
});
