const { trashExpired } = require('./archive-policy.cjs');
const { isLogged } = require('./model.cjs');
const { removeReferences } = require('./task-references.cjs');
const { dayKey: localDay } = require('./local-date.cjs');

module.exports = function installArchives(plugin, hasOpenDraft) {
  plugin.logCompleted = async (task = null) => {
    for (const t of task ? [task] : await plugin.taskRecords())
      if (t.meta.status === 'done' && !t.meta.deleted && !t.meta.loggedAt)
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
      const edits = [];
      try {
        for (const file of plugin.app.vault.getMarkdownFiles()) {
          const view = plugin.app.workspace
            .getLeavesOfType('markdown')
            .find((l) => l.view.file?.path === file.path && l.view.getMode() === 'source')?.view;
          if (view) {
            const before = view.editor.getValue(),
              after = removeReferences(before, path);
            if (before !== after) {
              view.editor.replaceRange(
                after,
                { line: 0, ch: 0 },
                view.editor.offsetToPos(before.length),
              );
              edits.push({ file, view, before, after });
              await view.save();
            }
          } else {
            const before = await plugin.app.vault.read(file),
              after = removeReferences(before, path);
            if (before !== after) {
              await plugin.app.vault.process(file, (text) => {
                if (text !== before) throw new Error('Note changed during cleanup.');
                return after;
              });
              edits.push({ file, before, after });
            }
          }
        }
        if ((await plugin.readTask(task.file)) !== raw)
          throw new Error('Task changed during cleanup; its file was retained.');
        await plugin.app.vault.adapter.remove(path);
        plugin.tasksChanged();
      } catch (error) {
        for (const edit of edits.reverse())
          try {
            if (edit.view) {
              if (edit.view.editor.getValue() === edit.after) {
                edit.view.editor.replaceRange(
                  edit.before,
                  { line: 0, ch: 0 },
                  edit.view.editor.offsetToPos(edit.after.length),
                );
                await edit.view.save();
              }
            } else
              await plugin.app.vault.process(edit.file, (text) =>
                text === edit.after ? edit.before : text,
              );
          } catch {}
        throw error;
      }
    });
  };
  let maintenance = null,
    disposed = false;
  plugin.register?.(() => {
    disposed = true;
  });
  plugin.maintainArchives = (now = new Date()) => {
    if (maintenance) return maintenance;
    maintenance = (async () => {
      const tasks = await plugin.taskRecords();
      for (const t of tasks) {
        if (disposed) return;
        if (
          !t.meta.deleted &&
          !t.meta.loggedAt &&
          isLogged(t.meta, localDay(now), plugin.settings.logbook)
        )
          await plugin.patchTask(t, { loggedAt: now.toISOString() });
        if (trashExpired(t.meta, plugin.settings.trashRetention, now))
          await plugin.purgeTask(t, now);
      }
    })().finally(() => {
      maintenance = null;
    });
    return maintenance;
  };
};
