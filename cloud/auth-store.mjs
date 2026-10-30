import { sha256 } from './security.mjs';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const digest = async value => [...await sha256(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');

function completeMetadata(key, value, metadata) {
  if (!key.startsWith('grant:')) return metadata;
  // The provider uses listed metadata to select old grants for revocation. Build
  // it from the canonical record, including rows written by earlier releases.
  let grant;
  try { grant = JSON.parse(value); } catch { return null; }
  if (typeof grant?.clientId !== 'string') return null;
  const normalized = JSON.stringify({ clientId: grant.clientId, ...(grant.resource === undefined ? {} : { resource: grant.resource }), ...(grant.redirectUri === undefined ? {} : { redirectUri: grant.redirectUri }) });
  return new TextEncoder().encode(normalized).byteLength <= 1024 ? normalized : null;
}

/** A request-local KV adapter. Writes are staged, then committed together in SQLite. */
export class AuthStore {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.pending = new Map();
  }

  async get(key, options = {}) {
    const entry = this.pending.has(key) ? this.pending.get(key) : this.sql.exec('SELECT value, expires, metadata FROM oauth_state WHERE key = ?', key).toArray()[0];
    if (!entry || (entry.expires !== null && entry.expires <= nowSeconds())) return null;
    const type = typeof options === 'string' ? options : options.type;
    if (type === 'json') return JSON.parse(entry.value);
    if (type === 'arrayBuffer') return new TextEncoder().encode(entry.value).buffer;
    if (type === 'stream') return new Response(entry.value).body;
    return entry.value;
  }

  async put(key, value, options = {}) {
    if (typeof value !== 'string') throw new TypeError('OAuth state must be text.');
    const expires = options.expiration ?? (options.expirationTtl === undefined ? null : nowSeconds() + options.expirationTtl);
    this.pending.set(key, { value, expires, metadata: completeMetadata(key, value, options.metadata === undefined ? null : JSON.stringify(options.metadata)) });
  }

  async delete(key) { this.pending.set(key, null); }

  async list({ prefix = '', cursor, limit = 1000 } = {}) {
    // Provider list operations are internal, bounded pages; cursors are last keys.
    const after = cursor ? decodeURIComponent(cursor) : '';
    const maximum = Math.max(1, Math.min(1000, limit));
    const rows = this.sql.exec('SELECT key, value, expires, metadata FROM oauth_state WHERE key >= ? AND key < ? AND key > ? AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT ?', prefix, `${prefix}\uffff`, after, nowSeconds(), maximum + this.pending.size + 1).toArray();
    const merged = new Map(rows.map(row => [row.key, row]));
    for (const [key, entry] of this.pending) {
      if (!key.startsWith(prefix) || key <= after) continue;
      if (!entry || (entry.expires !== null && entry.expires <= nowSeconds())) merged.delete(key);
      else merged.set(key, { key, ...entry });
    }
    const ordered = [...merged.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const page = ordered.slice(0, maximum);
    const complete = ordered.length <= maximum;
    return { keys: page.map(row => {
      const metadata = completeMetadata(row.key, row.value, row.metadata);
      return { name: row.key, ...(row.expires === null ? {} : { expiration: row.expires }), ...(metadata === null ? {} : { metadata: JSON.parse(metadata) }) };
    }), list_complete: complete, cursor: complete ? '' : encodeURIComponent(page.at(-1).key) };
  }

  commit() {
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM oauth_state WHERE expires IS NOT NULL AND expires <= ?', nowSeconds());
      for (const [key, entry] of this.pending) {
        if (entry === null) this.sql.exec('DELETE FROM oauth_state WHERE key = ?', key);
        else this.sql.exec('INSERT INTO oauth_state(key, value, expires, metadata) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires, metadata=excluded.metadata', key, entry.value, entry.expires, entry.metadata);
      }
    });
  }

  async refreshRecord(token) { return this.get(`refresh:${await digest(token)}`, 'json'); }
  async codeWasUsed(code) { return !!await this.get(`used-code:${await digest(code)}`); }
  async consumeCode(code) { await this.put(`used-code:${await digest(code)}`, '1', { expirationTtl: 600 }); }

  async revokeFamily(record) {
    const prefix = `token:${record.userId}:${record.grantId}:`;
    let cursor;
    do {
      const page = await this.list({ prefix, cursor });
      for (const item of page.keys) await this.delete(item.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    await this.delete(`grant:${record.userId}:${record.grantId}`);
  }

  async recordIssuedRefresh(token, previousToken) {
    const parts = token.split(':');
    if (parts.length !== 3) throw new Error('Unexpected provider refresh format.');
    const [userId, grantId] = parts;
    const grant = await this.get(`grant:${userId}:${grantId}`, 'json');
    if (!grant?.expiresAt || !grant.scope?.includes('offline_access')) throw new Error('Unexpected persistent authorization.');
    if (previousToken) {
      const previous = await this.refreshRecord(previousToken);
      if (!previous || previous.state !== 'current' || previous.userId !== userId || previous.grantId !== grantId) throw new Error('Refresh transaction is inconsistent.');
      await this.put(`refresh:${await digest(previousToken)}`, JSON.stringify({ ...previous, state: 'spent' }), { expiration: previous.expiresAt });
    }
    const record = { userId, grantId, clientId: grant.clientId, state: 'current', expiresAt: grant.expiresAt };
    await this.put(`refresh:${await digest(token)}`, JSON.stringify(record), { expiration: grant.expiresAt });
    // The provider's compatibility fallback must never retain a usable old token.
    delete grant.previousRefreshTokenId;
    delete grant.previousRefreshTokenWrappedKey;
    await this.put(`grant:${userId}:${grantId}`, JSON.stringify(grant), { expiration: grant.expiresAt, metadata: { clientId: grant.clientId } });
  }

  async disableRefresh(tokens) {
    const record = await this.refreshRecord(tokens.refresh_token);
    if (!record) throw new Error('Missing refresh transaction.');
    const grantKey = `grant:${record.userId}:${record.grantId}`;
    const grant = await this.get(grantKey, 'json');
    delete grant.refreshTokenId;
    delete grant.refreshTokenWrappedKey;
    delete grant.previousRefreshTokenId;
    delete grant.previousRefreshTokenWrappedKey;
    grant.scope = tokens.scope.split(' ').filter(Boolean);
    grant.expiresAt = Math.min(grant.expiresAt, nowSeconds() + tokens.expires_in);
    await this.put(grantKey, JSON.stringify(grant), {expiration:grant.expiresAt,metadata:{clientId:grant.clientId}});
    await this.put(`refresh:${await digest(tokens.refresh_token)}`, JSON.stringify({...record,state:'disabled'}), {expiration:record.expiresAt});
    // Narrowing to session-only access invalidates older, potentially broader access tokens.
    const prefix = `token:${record.userId}:${record.grantId}:`;
    const retained = `${prefix}${await digest(tokens.access_token)}`;
    let cursor;
    do {
      const page = await this.list({prefix,cursor});
      for (const item of page.keys) if (item.name !== retained) await this.delete(item.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
}
