import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { allowedOrigin, equalSecret, escapeHtml, publicOrigin, readLimited, validateRpc, verifyOwnerPassword } from './security.mjs';

test('password verification accepts the exact password and rejects malformed hashes', async () => {
  const salt = randomBytes(16);
  const password = randomBytes(24).toString('base64url');
  const hash = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64url')}`;
  assert.equal(await verifyOwnerPassword(password, hash), true);
  assert.equal(await verifyOwnerPassword(`${password}x`, hash), false);
  assert.equal(await verifyOwnerPassword(password, hash.replace('$100000$', '$999999999$')), false);
  assert.equal(await verifyOwnerPassword(password, 'not-a-password-hash'), false);
});

test('bridge credentials, HTML and request origins are checked explicitly', async () => {
  const secret = randomBytes(32).toString('base64url');
  assert.equal(await equalSecret(secret, secret), true);
  assert.equal(await equalSecret(`${secret}x`, secret), false);
  assert.equal(await equalSecret('', ''), false);
  assert.equal(escapeHtml('<script a="x">&\''), '&#60;script a=&#34;x&#34;&#62;&#38;&#39;');
  assert.equal(allowedOrigin('https://evil.example', 'https://bridge.example.test'), false);
  assert.equal(allowedOrigin('https://chatgpt.com', 'https://bridge.example.test'), true);
  assert.throws(() => publicOrigin({ PUBLIC_ORIGIN: 'http://evil.example' }));
  assert.throws(() => publicOrigin({ PUBLIC_ORIGIN: 'https://bridge.example.test/' }));
  assert.equal(publicOrigin({ PUBLIC_ORIGIN: 'http://127.0.0.1:8797' }), 'http://127.0.0.1:8797');
});

test('RPC envelopes and chunked input limits reject malformed or oversized input', async () => {
  assert.throws(() => validateRpc([{ jsonrpc: '2.0', method: 'initialize' }]));
  assert.throws(() => validateRpc({ jsonrpc: '2.0', method: 'initialize', id: {} }));
  assert.throws(() => validateRpc({ jsonrpc: '2.0', method: 'initialize', params: [] }));
  assert.equal(validateRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }).method, 'notifications/initialized');
  assert.equal(await readLimited(new Request('https://example.test', { method: 'POST', body: 'hello' }), 5), 'hello');
  await assert.rejects(readLimited(new Request('https://example.test', { method: 'POST', body: 'hello!' }), 5), { status: 413 });
  const bytes = new Uint8Array([255]);
  await assert.rejects(readLimited(new Request('https://example.test', { method: 'POST', body: bytes }), 5), { status: 400 });
});

test('stalled or aborted upload readers stop within their budget without awaiting stream cancellation', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const request = new Request('https://example.test/authorize', { method: 'POST', body, duplex: 'half' });
  await assert.rejects(readLimited(request, 8192, 20), { status: 408 });
  assert.equal(cancelled, true);
  const controller = new AbortController();
  const second = new Request('https://example.test/mcp', { method: 'POST', body: new ReadableStream(), duplex: 'half', signal: controller.signal });
  const pending = readLimited(second, 8192, 10000);
  controller.abort();
  await assert.rejects(pending, { status: 408 });
});
