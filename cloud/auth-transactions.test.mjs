import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthTransactions } from './auth-transactions.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const prepared = (response, commit = () => {}, writes = false) => ({ response, commit, writes });

test('slow authorization preparation cannot occupy authenticated or stop transaction admission', async () => {
  const tx = new AuthTransactions({ limits: { authorization: 1, mcp: 1, stop: 1 } });
  const gate = deferred();
  let committed = false;
  const slow = tx.run('authorization', async () => { await gate.promise; return prepared('consent', () => { committed = true; }, true); });
  assert.equal(await tx.run('authorization', async () => prepared('overflow')), null);
  assert.equal(await tx.run('mcp', async () => prepared('authenticated')), 'authenticated');
  assert.equal(await tx.run('stop', async () => prepared('stopped')), 'stopped');
  assert.equal(committed, false);
  gate.resolve();
  assert.equal(await slow, 'consent');
  assert.equal(committed, true);
});

test('conflicting prepared writes re-evaluate current state and never publish the stale response', async () => {
  const tx = new AuthTransactions();
  const gate = deferred(), started = deferred();
  let state = 0, preparations = 0, commits = 0;
  const first = tx.run('token', async () => {
    const snapshot = state;
    if (++preparations === 1) { started.resolve(); await gate.promise; }
    return prepared(snapshot + 1, () => { state = snapshot + 1; commits++; }, true);
  });
  await started.promise;
  assert.equal(await tx.run('token', async () => prepared('other', () => { state = 10; }, true)), 'other');
  gate.resolve();
  assert.equal(await first, 11);
  assert.equal(state, 11);
  assert.equal(preparations, 2);
  assert.equal(commits, 1);
});

test('a cancelled preparation retains its budget until settled and cannot issue late credentials', async () => {
  const tx = new AuthTransactions({ limits: { token: 1 } });
  const gate = deferred(), controller = new AbortController();
  let commits = 0;
  const request = tx.run('token', async () => { await gate.promise; return prepared('credential', () => commits++, true); }, controller.signal);
  controller.abort();
  assert.equal(await request, null);
  assert.equal(await tx.run('token', async () => prepared('over capacity')), null);
  gate.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(commits, 0);
  assert.equal(await tx.run('token', async () => prepared('next')), 'next');
});

test('timed-out preparation never commits even after its external work finishes', async () => {
  const tx = new AuthTransactions({ timeoutMs: 20, limits: { authorization: 1 } });
  const gate = deferred();
  let commits = 0;
  assert.equal(await tx.run('authorization', async () => { await gate.promise; return prepared('credential', () => commits++, true); }), null);
  assert.equal(await tx.run('authorization', async () => prepared('over capacity')), null);
  gate.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(commits, 0);
  assert.equal(await tx.run('authorization', async () => prepared('next')), 'next');
});

test('read-only checks do not force a slow write to retry and failed commits do not publish responses', async () => {
  const tx = new AuthTransactions();
  const gate = deferred();
  let attempts = 0;
  const slow = tx.run('authorization', async () => { attempts++; await gate.promise; return prepared('consent', () => {}, true); });
  for (let n = 0; n < 20; n++) assert.equal(await tx.run('mcp', async () => prepared('valid')), 'valid');
  gate.resolve(); assert.equal(await slow, 'consent'); assert.equal(attempts, 1);
  await assert.rejects(tx.run('token', async () => prepared('must not escape', () => { throw new Error('storage unavailable'); }, true)), /storage unavailable/);
});

test('persistent conflicts stop at the retry bound without committing or exposing a stale prepared result', async () => {
  const tx = new AuthTransactions({ attempts: 4 });
  let attempts = 0, staleCommits = 0;
  const result = await tx.run('authorization', async () => {
    attempts++;
    await tx.run('other', async () => prepared('competing write', () => {}, true));
    return prepared('stale credential', () => staleCommits++, true);
  });
  assert.equal(result,null);
  assert.equal(attempts,4);
  assert.equal(staleCommits,0);
});
