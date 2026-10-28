// Serialize operations for one resource without blocking unrelated resources.
// Failed work must not poison later writes, and settled entries must not leak.
class WriteQueue {
  constructor() {
    this.pending = new Map();
  }
  async run(key, operation) {
    const previous = this.pending.get(key) || Promise.resolve();
    const work = previous.catch(() => {}).then(operation);
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      if (this.pending.get(key) === work) this.pending.delete(key);
    }
  }
}
module.exports = { WriteQueue };
