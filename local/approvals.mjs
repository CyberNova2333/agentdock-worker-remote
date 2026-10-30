import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requiresApproval, approvalSubject, digest } from './request-policy.mjs';
import { REQUEST_FILE, MAX_APPROVED_RECORD_BYTES, readJson, validRequest, atomicJson, removeRequest } from './approval-store.mjs';

const TTL = 5 * 60 * 1000;
const MAX_PENDING = 64;
const MAX_PER_CLIENT = 8;

export class LocalApprovals {
  constructor(stateDir, origin, { now = Date.now } = {}) {
    this.directory = path.join(stateDir, 'approvals');
    this.origin = origin;
    this.now = now;
    this.queue = Promise.resolve();
    this.ready = fs.mkdir(this.directory, { recursive: true, mode: 0o700 }).then(async () => {
      if ((await fs.lstat(this.directory)).isSymbolicLink()) throw new Error('Approval directory must not be a link.');
    });
  }
  authorize(body, authorization, { signal } = {}) {
    if (!requiresApproval(body)) return Promise.resolve({ approved: true });
    const action = this.queue.then(async () => {
      await this.ready;
      signal?.throwIfAborted();
      const subject = approvalSubject(this.origin, body, authorization);
      const hash = digest(subject);
      const entries = await fs.readdir(this.directory);
      if (entries.length > 1024) throw new Error('Approval storage requires local maintenance.');
      let count = 0, clientCount = 0;
      let match;
      for (const name of entries) {
        signal?.throwIfAborted();
        const identified = REQUEST_FILE.exec(name);
        if (!identified) {
          // Recover old interrupted publications without touching an active writer.
          if (/^(?:\.approval-[a-f0-9-]{36}\.tmp|[a-f0-9-]{36}\.approved\.json)$/.test(name)) {
            const orphan = path.join(this.directory, name);
            const stat = await fs.lstat(orphan).catch(() => null);
            if (stat?.isFile() && stat.mtimeMs < this.now() - TTL * 2) await fs.unlink(orphan).catch(() => {});
          }
          continue;
        }
        const file = path.join(this.directory, name);
        let pending;
        try { pending = await readJson(file); } catch {}
        if (!validRequest(pending, identified[1], this.now())) {
          // A partial/corrupt request is never an approval and cannot poison others.
          await removeRequest(this.directory, identified[1]);
          continue;
        }
        count++;
        if (pending.request.authorization?.clientId === authorization.clientId) clientCount++;
        if (pending.hash === hash && digest(pending.request) === hash) match = pending;
      }
      if (match) {
        const approvedFile = path.join(this.directory, `${match.id}.approved.json`);
        let approval;
        try { approval = await readJson(approvedFile, MAX_APPROVED_RECORD_BYTES); } catch (error) { if (error.code !== 'ENOENT') await fs.unlink(approvedFile).catch(() => {}); }
        if (approval?.hash === hash && approval.expiresAt === match.expiresAt && approval.expiresAt > this.now()) {
          signal?.throwIfAborted();
          // Consume the approval before starting any side effect; a crash cannot reuse it.
          await fs.unlink(approvedFile);
          await fs.unlink(path.join(this.directory, `${match.id}.request.json`));
          return { approved: true };
        }
        return { approved: false, id: match.id, expiresAt: match.expiresAt };
      }
      if (count >= MAX_PENDING || clientCount >= MAX_PER_CLIENT) throw new Error('Approval queue is full for this client. Review pending requests or wait for expiry.');
      const createdAt = this.now();
      const pending = { id: randomUUID(), hash, createdAt, expiresAt: createdAt + TTL, request: subject };
      signal?.throwIfAborted();
      await atomicJson(path.join(this.directory, `${pending.id}.request.json`), pending);
      return { approved: false, id: pending.id, expiresAt: pending.expiresAt };
    });
    this.queue = action.catch(() => {});
    return action;
  }
}
