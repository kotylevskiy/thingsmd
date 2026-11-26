const { isFinished } = require('./task-status.cjs');
const { rollbackNotes, recoveryError } = require('../shared/note-rollback.cjs');
const { trashExpired, plannedLogAt } = require('./archive-policy.cjs');
const { isLogged } = require('./model.cjs');
const { removeReferences } = require('../notes/task-references.cjs');
const { dayKey: vaultDay } = require('../shared/vault-time.cjs');

module.exports = function installArchives(plugin, hasOpenDraft) {
  const notes = require('../shared/note-access.cjs').noteAccess(plugin.app);
  plugin.logCompleted = async (task = null) => {
    for (const t of task ? [task] : await plugin.taskRecords())
      if (isFinished(t.meta) && !t.meta.deleted && !t.meta.loggedAt)
        await plugin.patchTask(t, { loggedAt: new Date().toISOString() });
  };
  plugin.purgeTask = async (task, now = new Date()) => {
    const path = task.file.path;
    return plugin.taskQueue.run(path, async () => {
      const raw = await plugin.readTask(task.file);
      const current = (await plugin.taskRecords()).find((t) => t.file.path === path);
      if (
        !current?.meta.deleted ||
        !trashExpired(current.meta, plugin.settings.trashRetention, now)
      )
        return;
      // Remove only standalone task references, preserving prose and code examples.
      // Refuse unsaved open drafts so permanent cleanup cannot discard an edit.
      if (hasOpenDraft(path)) return;
      await plugin.assertTaskAuthority?.(task.file, current.meta.id);
      const edits = [];
      try {
        for (const file of plugin.app.vault.getMarkdownFiles()) {
          const before = await notes.read(file),
            after = removeReferences(before, path);
          if (before !== after) {
            // Record before writing: a failing editor save still needs rollback.
            edits.push({ file, before, after });
            await notes.write(file, before, after, { save: true });
          }
        }
        if ((await plugin.readTask(task.file)) !== raw)
          throw new Error('Task changed during cleanup; its file was retained.');
        await plugin.assertTaskAuthority?.(task.file, current.meta.id);
        await plugin.app.vault.adapter.remove(path);
        plugin.invalidateVaultPath?.(path);
        plugin.tasksChanged();
      } catch (error) {
        const failures = await rollbackNotes(edits, (file, before, after) =>
          notes.write(file, before, after, { save: true }),
        );
        throw recoveryError(error, failures);
      }
    });
  };
  let maintenance = null,
    disposed = false;
  plugin.register?.(() => {
    disposed = true;
  });
  plugin.maintainArchives = (now = new Date(), records) => {
    if (maintenance) return maintenance;
    maintenance = (async () => {
      const tasks = records ?? (await plugin.taskRecords());
      const day = vaultDay(now, plugin.settings.timeZone);
      for (const t of tasks) {
        if (disposed || plugin.conversionBusy) return;
        if (
          !t.meta.deleted &&
          !t.meta.loggedAt &&
          isLogged(t.meta, day, plugin.settings.logbook, plugin.settings.timeZone)
        ) {
          const loggedAt = plannedLogAt(t.meta, plugin.settings.logbook, plugin.settings.timeZone);
          if (loggedAt) await plugin.patchTask(t, { loggedAt });
        }
        if (trashExpired(t.meta, plugin.settings.trashRetention, now))
          await plugin.purgeTask(t, now);
      }
    })().finally(() => {
      maintenance = null;
    });
    return maintenance;
  };
};
