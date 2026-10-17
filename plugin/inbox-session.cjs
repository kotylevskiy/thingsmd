const { isHidden } = require('./model.cjs');

// Placement history belongs to one visit, never to persisted task metadata.
class InboxSession {
  constructor() {
    this.reset();
  }
  reset() {
    this.seen = new Set();
  }
  update(tasks, active, today, logbook) {
    for (const task of active) this.seen.add(task.meta.id);
    const current = new Set(active.map((task) => task.meta.id));
    return tasks.filter(
      (task) =>
        this.seen.has(task.meta.id) &&
        !current.has(task.meta.id) &&
        !isHidden(task.meta, today, logbook) &&
        task.meta.status !== 'done',
    );
  }
}
module.exports = InboxSession;
