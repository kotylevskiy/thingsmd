const { Notice } = require('obsidian');
const { today } = require('../shared/local-date.cjs');
const { dayKey: vaultDay } = require('../shared/vault-time.cjs');
const { renamedLocations } = require('./trash-locations.cjs');
const { trashExpiresAt } = require('./archive-policy.cjs');

// Poll as a fallback for external file changes and date-based maintenance.
module.exports = async function installTaskRefresh(plugin) {
  let disposed = false;
  plugin.register(() => {
    disposed = true;
  });
  const indexed = () => plugin.indexedTasks();
  await indexed()
    .then((records) => plugin.repeating.tick(undefined, records))
    .catch((error) => new Notice('Repeating tasks: ' + error.message));
  if (disposed) return;
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      (async () => {
        for (const task of await plugin.taskRecords()) {
          if (disposed) return;
          // Placement snapshots outlive their source note's original filename.
          const patch = renamedLocations(task.meta, oldPath, file.path);
          if (Object.keys(patch).length) await plugin.patchTask(task, patch);
        }
      })().catch((error) => new Notice(error.message));
    }),
  );
  let previous, nextPurge, nextProbe;
  let scanning = false,
    moreDue = false;
  const days = (now) => `${today()}/${vaultDay(now, plugin.settings?.timeZone)}`;
  let currentDay = days(new Date());
  const preferences = () => {
    const { timeZone, logbook, trashRetention } = plugin.settings;
    return `${timeZone}/${logbook}/${trashRetention}`;
  };
  let settings = preferences();
  plugin.registerInterval(
    window.setInterval(async () => {
      if (disposed || scanning || plugin.movingTasks || plugin.conversionBusy) return;
      scanning = true;
      try {
        const now = new Date();
        const day = days(now);
        const dayChanged = currentDay !== day;
        let detected = false;
        if (!nextProbe || now >= nextProbe) {
          detected = await plugin.probeTaskFiles();
          nextProbe = now.getTime() + 5000;
        }
        if (disposed) return;
        const records = await indexed();
        if (disposed) return;
        const prefs = preferences();
        const changed = records !== previous || settings !== prefs || dayChanged;
        if (changed || moreDue) moreDue = await plugin.repeating.tick(now, records);
        if (disposed) return;
        if (changed || now >= nextPurge) {
          const latest = await indexed();
          if (disposed) return;
          await plugin.maintainArchives(now, latest);
          nextPurge = records.reduce(
            (next, task) =>
              Math.min(next, trashExpiresAt(task.meta, plugin.settings.trashRetention)),
            Infinity,
          );
        }
        if (disposed) return;
        if (detected || dayChanged) plugin.tasksChanged();
        previous = records;
        currentDay = day;
        settings = prefs;
      } catch (error) {
        console.error('ThingsMD task refresh:', error);
      } finally {
        scanning = false;
      }
    }, 1500),
  );
};
