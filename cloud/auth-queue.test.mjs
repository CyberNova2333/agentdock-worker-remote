import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthQueue } from './auth-queue.mjs';

test('auth transactions stay serialized and stale queued work never begins', async () => {
  let now = 0, release;
  const queue = new AuthQueue({ now: () => now, waitMs: 100, maximum: 2 });
  const first = queue.run(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  let staleRan = false;
  const stale = queue.run(() => { staleRan = true; return 'unexpected'; });
  assert.equal(await queue.run(() => 'overflow'), null);
  now = 101;
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await stale, null);
  assert.equal(staleRan, false);
  assert.equal(await queue.run(() => 'fresh'), 'fresh');
});

test('cancelled queued authorization cannot issue credentials after its caller leaves', async () => {
  const queue = new AuthQueue();
  let release;
  const first = queue.run(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const controller = new AbortController();
  let issued = false;
  const cancelled = queue.run(() => { issued = true; }, controller.signal);
  controller.abort(); release();
  await first;
  assert.equal(await cancelled, null);
  assert.equal(issued, false);
  await assert.rejects(queue.run(() => { throw new Error('rollback'); }), /rollback/);
  assert.equal(await queue.run(() => 'recovered'), 'recovered');
});
