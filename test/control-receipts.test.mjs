import test from 'node:test';
import assert from 'node:assert/strict';
import { TransientReceipts, StopReceipts } from '../local/receipts.mjs';

const frame = (clientId, id, method = 'ping') => ({ id, authorization: { clientId }, body: { jsonrpc: '2.0', id, method } });

test('ordinary control receipts are fair per client, client-scoped, and bounded after expiry', () => {
  let now = 1000;
  const cache = new TransientReceipts({ now: () => now, maximum: 12, perClientMaximum: 3 });
  const original = frame('noisy-client', 'same-id');
  for (const message of [original, frame('noisy-client', 'second'), frame('noisy-client', 'third')]) assert.equal(cache.claim(message).acquired, true);
  assert.equal(cache.claim(frame('noisy-client', 'fourth')).reason, 'control_client_capacity');
  assert.equal(cache.claim(original).reason, 'already_attempted');
  assert.equal(cache.claim({ ...original, body: { ...original.body, method: 'initialize' } }).reason, 'request_id_conflict');
  assert.equal(cache.claim(frame('independent-client', 'same-id')).acquired, true);
  for (let index = 0; index < 100; index++) cache.claim(frame(`client-${index}`, 'first'));
  assert.equal(cache.records.size, 12);
  assert.ok(cache.clients.size <= 12);
  assert.equal(cache.claim(frame('new-client', 'first')).reason, 'control_capacity');
  now += 120001;
  assert.equal(cache.claim(frame('noisy-client', 'fresh')).acquired, true);
  assert.equal(cache.records.size, 1);
  assert.equal(cache.clients.size, 1);
});

test('stop receipts retain recent duplicate conflicts without a capacity rejection', () => {
  const cache = new StopReceipts({ now: () => 1000, maximum: 2 });
  const original = frame('owner-client', 'stop-1', 'stop_command');
  assert.equal(cache.claim(original).acquired, true);
  assert.equal(cache.claim(original).reason, 'already_attempted');
  assert.equal(cache.claim({ ...original, body: { ...original.body, id: 'changed' } }).reason, 'request_id_conflict');
  for (let index = 0; index < 100; index++) assert.equal(cache.claim(frame(`client-${index}`, `stop-${index}`, 'stop_command')).acquired, true);
  assert.equal(cache.records.size, 2);
  assert.equal(cache.clients.size, 2);
  // The bounded old record has been evicted. A repeated stop is harmless and
  // is still checked against the current job owner by the runtime.
  assert.equal(cache.claim(original).acquired, true);
  assert.equal(cache.records.size, 2);
});
