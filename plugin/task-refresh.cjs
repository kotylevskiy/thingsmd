const { Notice } = require('obsidian');
const { today } = require('./local-date.cjs');
const { dayKey: vaultDay } = require('./vault-time.cjs');

// Poll as a fallback for external file changes and date-based maintenance.
module.exports = async function installTaskRefresh(plugin) {
  let disposed = false;
  plugin.register(() => {
    disposed = true;
  });
  await plugin.repeating.tick().catch((error) => new Notice('Repeating tasks: ' + error.message));
  if (disposed) return;
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      (async () => {
        for (const task of await plugin.taskRecords()) {
          if (disposed) return;
          const path = task.meta.project;
          if (path === oldPath || (typeof path === 'string' && path.startsWith(oldPath + '/')))
            await plugin.patchTask(task, { project: file.path + path.slice(oldPath.length) });
        }
      })().catch((error) => new Notice(error.message));
    }),
  );
  let fingerprint;
  let scanning = false;
  const days = () => `${today()}/${vaultDay(new Date(), plugin.settings?.timeZone)}`;
  let currentDay = days();
  plugin.registerInterval(
    window.setInterval(async () => {
      if (disposed || scanning || plugin.movingTasks) return;
      scanning = true;
      try {
        await plugin.repeating.tick();
        if (disposed) return;
        await plugin.maintainArchives();
        if (disposed) return;
        if (currentDay !== days()) {
          currentDay = days();
          plugin.tasksChanged();
        }
        if (disposed) return;
        const next = JSON.stringify(await plugin.taskRecords());
        if (disposed) return;
        if (next !== fingerprint) plugin.tasksChanged();
        fingerprint = next;
      } catch (error) {
        console.error('ThingsMD task refresh:', error);
      } finally {
        scanning = false;
      }
    }, 1500),
  );
};
