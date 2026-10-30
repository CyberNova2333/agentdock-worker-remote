/** Serialize transactions, while discarding cancelled or stale work before it starts. */
export class AuthQueue {
  constructor({ now = Date.now, maximum = 64, waitMs = 15000 } = {}) {
    this.now = now;
    this.maximum = maximum;
    this.waitMs = waitMs;
    this.pending = 0;
    this.tail = Promise.resolve();
  }
  async run(operation, signal) {
    if (this.pending >= this.maximum) return null;
    this.pending++;
    const queuedAt = this.now();
    const task = this.tail.then(() => {
      if (signal?.aborted || this.now() - queuedAt >= this.waitMs) return null;
      return operation();
    });
    // A running transaction always keeps its place until it settles. A caller
    // timeout must never release the lock while that transaction can still write.
    this.tail = task.catch(() => {});
    try { return await task; }
    finally { this.pending--; }
  }
}
