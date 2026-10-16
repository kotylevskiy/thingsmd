const { settings } = require('./archive-policy.cjs');
const { WriteQueue } = require('./write-queue.cjs');

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
        for (const leaf of plugin.app.workspace.getLeavesOfType('things-project-view')) {
          if (plugin.settings.captureDestination === 'daily-note' && leaf.view.page === 'inbox')
            await leaf.view.navigate('today');
          if (plugin.settings.trashRetention === 'immediately' && leaf.view.page === 'trash')
            await leaf.view.navigate('inbox');
        }
        await plugin.maintainArchives();
      },
    });
};
