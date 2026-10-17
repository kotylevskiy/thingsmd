const { settings } = require('./archive-policy.cjs');
const { WriteQueue } = require('./write-queue.cjs');
const { resolveList } = require('./lists.cjs');

module.exports = async function installSettingsService(plugin) {
  plugin.settings = settings(await plugin.loadData());
  const writes = new WriteQueue();
  let disposed = false;
  plugin.register?.(() => {
    disposed = true;
  });

  // Stage changes, persist, then publish. In particular, a failed save must not
  // activate immediate Trash deletion in the background maintenance loop.
  // Hotkey registration participates via prepare/rollback in this same queue.
  plugin.persistSettings = (patch, { prepare, rollback, committed } = {}) =>
    writes.run('settings', async () => {
      if (disposed) throw new Error('The plugin has been unloaded.');
      const next = settings({ ...plugin.settings, ...patch });
      await prepare?.(next);
      try {
        if (disposed) throw new Error('The plugin has been unloaded.');
        await plugin.saveData(next);
      } catch (error) {
        await rollback?.();
        throw error;
      }
      plugin.settings = next;
      if (!disposed) await committed?.();
    });
  plugin.updateSettings = (patch) =>
    plugin.persistSettings(patch, {
      // Preserve already logged tasks when changing the automatic logging policy.
      prepare: () => plugin.maintainArchives(),
      committed: async () => {
        plugin.mountListLinks();
        plugin.tasksChanged();
        plugin.captureModal?.card?.refreshSettings();
        for (const leaf of plugin.app.workspace.getLeavesOfType('things-project-view')) {
          leaf.view.taskEditorController?.refreshSettings();
          const page = resolveList(leaf.view.page, plugin.settings);
          if (page !== leaf.view.page) await leaf.view.navigate(page);
        }
        await plugin.maintainArchives();
      },
    });
};
