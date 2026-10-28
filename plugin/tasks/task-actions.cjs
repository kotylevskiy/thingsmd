const { captureLocations, restoreLocations } = require('./trash-locations.cjs');
const { isFinished } = require('./task-status.cjs');
const { normalizeSchedule, applySchedulePolicy } = require('./task-schedule.cjs');

// Application actions coordinate storage, repeat rules and user decisions.
// Views call these commands; the repository remains responsible only for files.
const actions = {
  async patchTask(task, patch, body, { notify = true } = {}) {
    patch = normalizeSchedule(patch);
    if (task.meta.repeat && isFinished(patch)) {
      await this.repeating.createNext(task.meta.id, true, task.meta.repeat.next, patch.status);
      return;
    }
    if (task.meta.repeat && Object.hasOwn(patch, 'when') && patch.when !== task.meta.when) {
      const decision =
        task.meta.repeat.mode === 'regular' ? await this.chooseRepeatReschedule() : 'rule';
      if (decision !== 'cancel')
        await this.repeating.reschedule(
          task.meta.id,
          patch.when,
          decision === 'rule' && task.meta.repeat.mode === 'regular',
        );
      patch = { ...patch };
      delete patch.when;
      if (decision === 'cancel') {
        delete patch.evening;
        delete patch.deadlineDeferredOn;
      }
    }
    if (task.meta.repeatSource && Object.hasOwn(patch, 'when') && patch.when !== task.meta.when) {
      const template = (await this.taskRecords()).find((t) => t.meta.id === task.meta.repeatSource);
      if (template?.meta.repeat?.mode === 'regular') {
        const decision = await this.chooseRepeatReschedule();
        if (decision === 'rule') await this.repeating.shiftRule(template.meta.id, patch.when);
        if (decision === 'cancel') {
          patch = { ...patch };
          delete patch.when;
          delete patch.evening;
          delete patch.deadlineDeferredOn;
        }
      }
    }
    // Derive placement only after the user accepts or cancels rescheduling.
    patch = applySchedulePolicy(task.meta, patch);
    if (Object.hasOwn(patch, 'status') && !Object.hasOwn(patch, 'completed'))
      patch = { ...patch, completed: isFinished(patch) ? new Date().toISOString() : null };
    if (Object.hasOwn(patch, 'status')) patch = { ...patch, loggedAt: null };
    let before;
    const saved = await this.update(task.file, (current) => {
      before = { ...task, ...current };
      for (const key of Object.keys(patch)) {
        // Changing completion always resets logging. A background archive stamp
        // must not block that intent; status and completion time still conflict.
        if (key === 'loggedAt' && Object.hasOwn(patch, 'status')) continue;
        if (JSON.stringify(current.meta[key] ?? null) !== JSON.stringify(task.meta[key] ?? null))
          throw new Error(
            'This task changed elsewhere. Your draft is still open; copy it before refreshing.',
          );
      }
      if (body !== undefined && current.body !== task.body)
        throw new Error(
          'Task notes changed elsewhere. Your draft is still open; copy it before refreshing.',
        );
      return {
        meta: { ...current.meta, ...patch },
        body: body === undefined ? current.body : body,
      };
    });
    if (task.meta.repeatSource && Object.hasOwn(patch, 'status')) await this.repeating.tick();
    if (notify) this.notifyTaskMove?.(before, { ...saved, references: task.references });
    return saved;
  },
  async trashTask(task) {
    if (!task.meta.deleted)
      task = {
        ...task,
        ...(await this.patchTask(task, {
          deleted: true,
          deletedAt: new Date().toISOString(),
          deletedFrom: await captureLocations(this, task),
        })),
      };
    if (this.settings.trashRetention === 'immediately') await this.purgeTask(task);
    return task;
  },
  async restoreTask(task, reopen = false) {
    const restore = () =>
      this.patchTask(
        task,
        reopen
          ? { status: 'todo', completed: null, loggedAt: null }
          : { deleted: null, deletedAt: null, deletedFrom: null },
      );
    return reopen ? restore() : restoreLocations(this, task, restore);
  },
};
module.exports = (plugin) => Object.assign(plugin, actions);
