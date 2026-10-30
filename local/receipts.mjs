import fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from './request-policy.mjs';

const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_RECEIPTS = 10000;

/** Persist intent before invoking a tool. A crashed or completed call is never retried with the same ID. */
export class RequestReceipts {
  constructor(stateDir, { now = Date.now, maximum = MAX_RECEIPTS } = {}) {
    if (!stateDir) throw new Error('A protected state directory is required for replay protection.');
    this.directory = path.join(stateDir, 'request-receipts');
    this.now = now;
    this.maximum = maximum;
    this.queue = Promise.resolve();
    this.count = 0;
    this.ready = this.initialize();
  }
  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.directory)).isSymbolicLink()) throw new Error('Receipt directory must not be a link.');
    await this.cleanup();
  }
  async cleanup() {
    const directory = await fs.opendir(this.directory);
    let count = 0;
    for await (const entry of directory) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error('Unexpected receipt entry.');
      const file = path.join(this.directory, entry.name);
      const stat = await fs.stat(file);
      if (stat.size > 512) throw new Error('Invalid receipt size.');
      let receipt;
      try { receipt = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* A partial receipt is kept: fail closed. */ }
      if (Number.isSafeInteger(receipt?.expiresAt) && receipt.expiresAt < this.now()) await fs.unlink(file);
      else if (++count > this.maximum) throw new Error('Receipt storage limit reached.');
    }
    this.count = count;
    this.nextCleanup = this.now() + 3600000;
  }
  async inspect(message) {
    await this.ready;
    const file = path.join(this.directory, `${digest(message.id)}.json`);
    try {
      const raw = await fs.readFile(file, 'utf8');
      if (Buffer.byteLength(raw) > 512) return { acquired: false, reason: 'duplicate_or_incomplete' };
      const existing = JSON.parse(raw);
      return { acquired: false, reason: existing?.digest === digest(message) ? 'already_attempted' : 'request_id_conflict' };
    } catch (error) {
      return error.code === 'ENOENT' ? { acquired: true } : { acquired: false, reason: 'duplicate_or_incomplete' };
    }
  }
  claim(message) {
    const action = this.queue.then(async () => {
      await this.ready;
      if (this.now() > this.nextCleanup) await this.cleanup();
      const file = path.join(this.directory, `${digest(message.id)}.json`);
      const bodyHash = digest(message);
      let existing;
      try { existing = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') return { acquired: false, reason: 'duplicate_or_incomplete' }; }
      if (existing) return { acquired: false, reason: existing.digest === bodyHash ? 'already_attempted' : 'request_id_conflict' };
      if (this.count >= this.maximum) throw new Error('Receipt storage capacity reached.');
      const handle = await fs.open(file, 'wx', 0o600).catch(error => { if (error.code === 'EEXIST') return null; throw error; });
      if (!handle) return { acquired: false, reason: 'already_attempted' };
      this.count++;
      try { await handle.writeFile(JSON.stringify({ digest: bodyHash, expiresAt: this.now() + KEEP_MS })); await handle.sync(); }
      finally { await handle.close(); }
      return { acquired: true };
    });
    this.queue = action.catch(() => {});
    return action;
  }
}

/** Ordinary controls retain short, client-scoped replay records with fair quotas. */
export class TransientReceipts {
  constructor({ now = Date.now, maximum = 1000, perClientMaximum = Math.min(100, maximum) } = {}) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(perClientMaximum) || perClientMaximum < 1) throw new Error('Invalid transient receipt limits.');
    this.now = now; this.maximum = maximum; this.perClientMaximum = Math.min(perClientMaximum, maximum);
    this.records = new Map(); this.clients = new Map();
  }
  key(message) { return digest([message.authorization.clientId, message.id]); }
  remove(key) {
    const record = this.records.get(key);
    if (!record) return;
    this.records.delete(key);
    const remaining = this.clients.get(record.client) - 1;
    if (remaining) this.clients.set(record.client, remaining);
    else this.clients.delete(record.client);
  }
  inspect(message) {
    const now = this.now();
    for (const [key, record] of this.records) if (record.expiresAt <= now) this.remove(key);
    const previous = this.records.get(this.key(message));
    return previous ? { acquired: false, reason: previous.digest === digest(message) ? 'already_attempted' : 'request_id_conflict' } : { acquired: true };
  }
  claim(message, { evict = false } = {}) {
    const prior = this.inspect(message);
    if (!prior.acquired) return prior;
    const client = digest(message.authorization.clientId);
    if (!evict && this.records.size >= this.maximum) return { acquired: false, reason: 'control_capacity' };
    if (!evict && (this.clients.get(client) || 0) >= this.perClientMaximum) return { acquired: false, reason: 'control_client_capacity' };
    if (this.records.size >= this.maximum) this.remove(this.records.keys().next().value);
    this.records.set(this.key(message), { client, digest: digest(message), expiresAt: this.now() + 120000 });
    this.clients.set(client, (this.clients.get(client) || 0) + 1);
    return { acquired: true };
  }
}

/** Stop is idempotent and owner-checked by the runtime; cache pressure must not block it. */
export class StopReceipts extends TransientReceipts {
  constructor({ now = Date.now, maximum = 128 } = {}) { super({ now, maximum, perClientMaximum: maximum }); }
  // Retain duplicate/conflicting-ID checks for the most recent bounded window.
  // Repeating an evicted stop is safe: the runtime cannot restart a finished job.
  claim(message) { return super.claim(message, { evict: true }); }
}
