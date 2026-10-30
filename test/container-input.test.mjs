import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonInput } from '../container/file-worker.mjs';

test('container input preserves UTF-8 characters split at every pipe boundary', async () => {
  const original = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_file', arguments: { path: '/workspace/unicode.txt', content: '中文与 emoji 😀\n' } } };
  const input = Buffer.from(JSON.stringify(original));
  const chunks = [...input].map(byte => Buffer.from([byte]));
  assert.deepEqual(await readJsonInput(Readable.from(chunks)), original);
});

test('container input rejects malformed UTF-8 and byte-limit overflow', async () => {
  await assert.rejects(readJsonInput(Readable.from([Buffer.from('{"x":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')])), /encoded data/i);
  await assert.rejects(readJsonInput(Readable.from([Buffer.from('"中中"')]), 5), /too large/);
});
