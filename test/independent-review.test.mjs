import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createToolRuntime } from '../local/tools.mjs';

test('concurrent stale-hash overwrites have one winner', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cbnv-review-'));
  const root = path.join(base, 'root');
  const stateDir = path.join(base, 'state');
  await fs.mkdir(root); await fs.mkdir(stateDir);
  const runtime = await createToolRuntime({ roots: [root], defaultCwd: root, stateDir, allowExec: false });
  t.after(async () => { await runtime.close(); await fs.rm(base, { recursive: true, force: true }); });
  const original = 'a'.repeat(128 * 1024);
  const file = path.join(root, 'shared.txt');
  await fs.writeFile(file, original);
  const hash = crypto.createHash('sha256').update(original).digest('hex');
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => runtime.handleRpc({
    jsonrpc: '2.0', id: i, method: 'tools/call', params: {
      name: 'write_file', arguments: { path: file, content: `writer-${i}`, overwrite: true, expected_sha256: hash },
    },
  })));
  assert.equal(replies.filter((reply) => !reply.result?.isError).length, 1,
    'All writes read the same old hash: serialize same-file changes before checking and writing.');
});
