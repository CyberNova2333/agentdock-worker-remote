import { AuthQueue } from './auth-queue.mjs';

/** External preparation never owns the commit lock. Optimistic revision checks
 * make completed transactions serializable without making network latency global.
 */
export class AuthTransactions {
  constructor({ now = Date.now, timeoutMs = 25000, attempts = 4, limits = { authorization: 4, consent: 4, token: 8, mcp: 32, stop: 4, other: 4 }, retain = () => {} } = {}) {
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
    this.limits = limits;
    this.retain = retain;
    this.active = new Map();
    this.revision = 0;
    this.queue = new AuthQueue({ now });
  }

  async run(lane, prepare, signal) {
    const current = this.active.get(lane) || 0;
    if (current >= (this.limits[lane] || 1) || signal?.aborted) return null;
    this.active.set(lane, current + 1);
    const deadline = this.now() + this.timeoutMs;
    let stopped = false, timer, cancel;
    const expired = () => stopped || signal?.aborted || this.now() >= deadline;
    const abandoned = new Promise(resolve => {
      cancel = () => { stopped = true; resolve(null); };
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(cancel, this.timeoutMs);
    });
    const work = (async () => {
      try {
        for (let attempt = 0; attempt < this.attempts && !expired(); attempt++) {
          // Nothing awaits between taking the revision and starting preparation.
          // Any interleaved committed write invalidates the entire prepared view.
          const revision = this.revision;
          const prepared = await prepare();
          if (expired()) return null;
          const committed = await this.queue.run(() => {
            if (expired()) return null;
            if (revision !== this.revision) return false;
            // This callback is synchronous: it cannot release the commit lock
            // while storage writes, issuance or revocation are still in flight.
            prepared.commit();
            if (prepared.writes) this.revision++;
            return true;
          }, signal);
          if (committed === true) return prepared.response;
          if (committed === null) return null;
        }
        return null;
      } finally {
        this.active.set(lane, this.active.get(lane) - 1);
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    })();
    // A timeout can answer the caller early, but the capacity reservation stays
    // held until preparation actually settles. Late results can never commit.
    this.retain(work.catch(() => {}));
    return Promise.race([work, abandoned]);
  }
}
