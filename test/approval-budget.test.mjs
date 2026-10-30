import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalApprovals } from '../local/approvals.mjs';
import { approveRequest } from '../local/approval-cli.mjs';
import { validateRequestEnvelope } from '../local/request-policy.mjs';
import { atomicJson, readJson, MAX_RECORD_BYTES, MAX_APPROVED_RECORD_BYTES, ApprovalRecordTooLargeError } from '../local/approval-store.mjs';

const origin = 'https://example.test';
const auth = { userId: 'owner', clientId: 'approval-budget-test', scope: ['computer:read'] };
const call = metadata => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/workspace/canary.txt' }, _meta: metadata } });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdock-approval-budget-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('agentdock-approval-budget-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('valid nested metadata remains readable, exactly bound and approvable once', async t => {
  const directory = await fixture(t);
  const approvals = new LocalApprovals(directory, origin);
  let metadata = Array(19000).fill(10);
  for (let n = 0; n < 28; n++) metadata = { next: metadata };
  const body = call(metadata);
  const now = Date.now();
  const validated = validateRequestEnvelope({ type: 'request', id: randomUUID(), issuedAt: now, deadline: now + 100000, authorization: auth, body }, now);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 60000);
  const first = await approvals.authorize(validated.body, validated.authorization);
  assert.equal(first.approved, false);
  const pendingFile = path.join(approvals.directory, `${first.id}.request.json`);
  const pending = await readJson(pendingFile);
  assert.ok(Buffer.byteLength(JSON.stringify(pending, null, 2)) > MAX_RECORD_BYTES, 'This request reproduces the old indentation expansion');
  assert.deepEqual(pending.request.params, body.params);
  assert.ok((await fs.stat(pendingFile)).size < 61000);
  await approveRequest(approvals.directory, pending);
  const changed = structuredClone(body);
  changed.params._meta.extra = true;
  assert.equal((await approvals.authorize(changed, auth)).approved, false, 'Metadata remains part of the exact approval');
  assert.equal((await approvals.authorize(body, auth)).approved, true);
  const replay = await approvals.authorize(body, auth);
  assert.equal(replay.approved, false);
  assert.notEqual(replay.id, first.id);
});

test('approval publication uses identical UTF-8 byte limits on write and read', async t => {
  const directory = await fixture(t);
  for (const maximum of [MAX_RECORD_BYTES, MAX_APPROVED_RECORD_BYTES]) {
    // Account for the two JSON quote bytes, including multibyte content.
    const payloadBytes = maximum - 2;
    const value = '中'.repeat(Math.floor(payloadBytes / 3)) + 'x'.repeat(payloadBytes % 3);
    const file = path.join(directory, `${maximum}.json`);
    await atomicJson(file, value, maximum);
    assert.equal((await fs.stat(file)).size, maximum);
    assert.equal(await readJson(file, maximum), value);
    const before = await fs.readdir(directory);
    await assert.rejects(atomicJson(file, value + 'x', maximum), ApprovalRecordTooLargeError);
    assert.equal(await readJson(file, maximum), value, 'Oversize rejection cannot replace an existing record');
    await assert.rejects(atomicJson(path.join(directory, `${maximum}-too-large.json`), value + 'x', maximum), ApprovalRecordTooLargeError);
    assert.deepEqual(await fs.readdir(directory), before, 'Rejected publication creates neither a final nor temporary file');
  }
});

test('oversize requests fail before creating a pending approval and do not poison later requests', async t => {
  const directory = await fixture(t);
  const approvals = new LocalApprovals(directory, origin);
  const tooLarge = call({ text: '中'.repeat(MAX_RECORD_BYTES / 3) });
  await assert.rejects(approvals.authorize(tooLarge, auth), error => error instanceof ApprovalRecordTooLargeError && error.code === 'APPROVAL_RECORD_TOO_LARGE');
  assert.deepEqual(await fs.readdir(approvals.directory), []);
  const body = call({ purpose: 'ordinary request' });
  const first = await approvals.authorize(body, auth);
  const pending = await readJson(path.join(approvals.directory, `${first.id}.request.json`));
  await approveRequest(approvals.directory, pending);
  const approvedFile = path.join(approvals.directory, `${first.id}.approved.json`);
  const approvalText = await fs.readFile(approvedFile, 'utf8');
  assert.ok(Buffer.byteLength(approvalText) <= MAX_APPROVED_RECORD_BYTES);
  await fs.writeFile(approvedFile, approvalText + ' '.repeat(MAX_APPROVED_RECORD_BYTES));
  assert.equal((await approvals.authorize(body, auth)).approved, false, 'Oversize approved records still fail closed');
  await approveRequest(approvals.directory, pending);
  assert.equal((await approvals.authorize(body, auth)).approved, true);
  assert.equal((await approvals.authorize(body, auth)).approved, false);
});
