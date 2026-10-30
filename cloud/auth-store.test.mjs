import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AuthStore } from './auth-store.mjs';

function storageFixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE oauth_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER, metadata TEXT)');
  return {
    sql: { exec(query, ...params) { const rows = db.prepare(query).all(...params); return { toArray: () => rows }; } },
    transactionSync(callback) {
      db.exec('BEGIN');
      try { const result = callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

test('OAuth state writes remain invisible until one atomic commit', async t => {
  const storage = storageFixture(t);
  const transaction = new AuthStore(storage);
  await transaction.put('grant:owner:test', '{"version":1}');
  await transaction.put('token:owner:test:token', '{"valid":true}');
  const separate = new AuthStore(storage);
  assert.equal(await separate.get('grant:owner:test'), null);
  assert.equal(await separate.get('token:owner:test:token'), null);
  transaction.commit();
  assert.deepEqual(await separate.get('grant:owner:test', 'json'), {version:1});
  assert.deepEqual(await separate.get('token:owner:test:token', 'json'), {valid:true});
});

test('a commit failure rolls back every staged issuance or revocation write', async t => {
  const storage = storageFixture(t);
  const seed = new AuthStore(storage);
  await seed.put('grant:owner:test', 'original');
  seed.commit();
  const transaction = new AuthStore(storage);
  await transaction.put('grant:owner:test', 'changed');
  await transaction.put('token:owner:test:new', 'must-not-escape');
  const execute = storage.sql.exec;
  storage.sql.exec = (sql, ...args) => {
    if (sql.startsWith('INSERT') && args[0] === 'token:owner:test:new') throw new Error('Simulated storage failure');
    return execute(sql, ...args);
  };
  assert.throws(() => transaction.commit(), /Simulated storage failure/);
  storage.sql.exec = execute;
  const check = new AuthStore(storage);
  assert.equal(await check.get('grant:owner:test'), 'original');
  assert.equal(await check.get('token:owner:test:new'), null);
});

test('OAuth state pagination includes pending changes and hides expired records', async t => {
  const storage = storageFixture(t);
  const seed = new AuthStore(storage);
  for (const name of ['a','b','c','d']) await seed.put(`token:${name}`, name);
  await seed.put('token:expired', 'expired', {expiration:1});
  seed.commit();
  const transaction = new AuthStore(storage);
  await transaction.delete('token:b');
  await transaction.put('token:bb', 'new');
  const first = await transaction.list({prefix:'token:',limit:2});
  assert.deepEqual(first.keys.map(key=>key.name), ['token:a','token:bb']);
  assert.equal(first.list_complete, false);
  const second = await transaction.list({prefix:'token:',limit:2,cursor:first.cursor});
  assert.deepEqual(second.keys.map(key=>key.name), ['token:c','token:d']);
  assert.equal(second.list_complete, true);
});

test('refresh reuse records survive new store instances and retain the fixed family expiry', async t => {
  const storage = storageFixture(t);
  const expiresAt = Math.floor(Date.now()/1000) + 300;
  const first = new AuthStore(storage);
  await first.put('grant:owner:test', JSON.stringify({clientId:'client',scope:['computer:read','offline_access'],expiresAt,previousRefreshTokenId:'legacy'}));
  await first.recordIssuedRefresh('owner:test:first');
  first.commit();
  const second = new AuthStore(storage);
  await second.recordIssuedRefresh('owner:test:second', 'owner:test:first');
  second.commit();
  const restarted = new AuthStore(storage);
  assert.equal((await restarted.refreshRecord('owner:test:first')).state, 'spent');
  assert.equal((await restarted.refreshRecord('owner:test:second')).state, 'current');
  assert.equal((await restarted.refreshRecord('owner:test:second')).expiresAt, expiresAt);
  assert.equal((await restarted.get('grant:owner:test','json')).previousRefreshTokenId, undefined);
  await restarted.revokeFamily(await restarted.refreshRecord('owner:test:first'));
  restarted.commit();
  assert.equal(await new AuthStore(storage).get('grant:owner:test'), null);
});

test('grant metadata preserves client, resource and callback on updates and normalizes legacy rows', async t => {
  const storage = storageFixture(t);
  const grant = { clientId: 'https://client.example/metadata.json', resource: 'https://gateway.example/mcp', redirectUri: 'https://client.example/callback', scope: ['computer:read','offline_access'], expiresAt: Math.floor(Date.now()/1000) + 300 };
  // Seed precisely the incomplete metadata emitted by the previous release.
  storage.sql.exec('INSERT INTO oauth_state(key,value,expires,metadata) VALUES(?,?,?,?)', 'grant:owner:test', JSON.stringify(grant), grant.expiresAt, JSON.stringify({ clientId: grant.clientId }));
  const store = new AuthStore(storage);
  const expected = { clientId: grant.clientId, resource: grant.resource, redirectUri: grant.redirectUri };
  assert.deepEqual((await store.list({ prefix: 'grant:' })).keys[0].metadata, expected);
  await store.recordIssuedRefresh('owner:test:first');
  store.commit();
  assert.deepEqual(JSON.parse(storage.sql.exec('SELECT metadata FROM oauth_state WHERE key=?', 'grant:owner:test').toArray()[0].metadata), expected);
  const next = new AuthStore(storage);
  await next.disableRefresh({ refresh_token: 'owner:test:first', access_token: 'owner:test:access', scope: 'computer:read', expires_in: 60 });
  next.commit();
  assert.deepEqual((await new AuthStore(storage).list({ prefix: 'grant:' })).keys[0].metadata, expected);
});
