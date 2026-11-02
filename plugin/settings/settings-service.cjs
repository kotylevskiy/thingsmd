const { settings } = require('./settings-model.cjs');
const { WriteQueue } = require('../shared/write-queue.cjs');
const { resolveList } = require('../lists/lists.cjs');

module.exports = async function installSettingsService(plugin) {
  const data = await plugin.loadData();
  plugin.settings = settings(data);
  // Capture the first device's zone once; other devices must retain the saved zone.
  if (data?.timeZone !== plugin.settings.timeZone)
    await plugin.saveData({ ...data, timeZone: plugin.settings.timeZone });
  const writes = new WriteQueue();
  let disposed = false;
  plugin.register?.(() => {
    disposed = true;
  });
  plugin.withSettingsLock = (operation) =>
    writes.run('settings', async () => {
      if (disposed) throw new Error('The plugin has been unloaded.');
      return operation();
    });

  // Stage changes, persist, then publish. In particular, a failed save must not
  // activate immediate Trash deletion in the background maintenance loop.
  // Hotkey registration participates via prepare/rollback in this same queue.
  plugin.persistSettings = (patch, { prepare, rollback, committed } = {}) =>
    plugin.withSettingsLock(async () => {
      // Calendar bindings on disk are authoritative after synchronization. Resolve
      // queued edits against them so an unrelated local edit cannot restore an old source.
      const disk = plugin.readCalendarSettings ? await plugin.readCalendarSettings() : undefined;
      if (disposed) throw new Error('The plugin has been unloaded.');
      const base = disk ? settings(disk) : plugin.settings;
      const change = typeof patch === 'function' ? patch(base) : patch;
      const next = settings({ ...base, ...change });
      // Calendar synchronization applies calendar/home changes live. Preserve
      // unrelated runtime preferences while retaining their latest disk values.
      const published = disk
        ? settings({
            ...plugin.settings,
            ...change,
            calendars: next.calendars,
            tasksFolder: next.tasksFolder,
          })
        : next;
      await prepare?.(next);
      try {
        if (disposed) throw new Error('The plugin has been unloaded.');
        if (disk && JSON.stringify(await plugin.readCalendarSettings()) !== JSON.stringify(disk))
          throw new Error('Settings changed while saving. Try again.');
        await plugin.saveData(disk ? { ...disk, ...next } : next);
      } catch (error) {
        await rollback?.();
        throw error;
      }
      plugin.settings = published;
      if (!disposed) await committed?.();
    });
  plugin.updateSettings = (patch) =>
    plugin.persistSettings(patch, {
      // Preserve already logged tasks when changing the automatic logging policy.
      prepare: () => plugin.maintainArchives(),
      committed: async () => {
        plugin.calendar?.configure(plugin.settings.calendars);
        if (plugin.calendar) void plugin.calendar.reload().then(() => plugin.calendar.refreshAll());
        plugin.mountListLinks();
        plugin.paintTaskFolder?.();
        plugin.refreshMobileNavigation?.();
        plugin.tasksChanged();
        plugin.captureModal?.card?.refreshSettings();
        for (const leaf of plugin.app.workspace.getLeavesOfType('thingsmd-project-view')) {
          // setState resolves unavailable lists when a tab is loaded. Obsidian
          // can also retain an unloaded placeholder while plugins are reloading.
          if (leaf.isDeferred || typeof leaf.view.navigate !== 'function') continue;
          leaf.view.taskEditorController?.refreshSettings();
          const page = resolveList(leaf.view.page, plugin.settings);
          if (page !== leaf.view.page) await leaf.view.navigate(page);
        }
        await plugin.maintainArchives();
      },
    });
};
