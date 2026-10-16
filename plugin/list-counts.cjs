const { inList } = require('./model.cjs');
const { today } = require('./local-date.cjs');

// Like Things, badge the capture queue and today's work, not every archive/list.
function listCounts(records, day, settings) {
  const counts = { inbox: 0, today: 0 };
  for (const task of records) {
    if (task.meta.type !== 'things-task' || task.meta.status === 'done' || task.meta.repeat)
      continue;
    for (const key of Object.keys(counts)) {
      if (inList(task, key, day, settings.logbook, settings.captureDestination)) counts[key]++;
    }
  }
  return counts;
}

function install(plugin) {
  let counts = { inbox: 0, today: 0 },
    timer,
    generation = 0,
    disposed = false;
  plugin.paintListCounts = () => {
    for (const nav of plugin.listLinks || []) {
      for (const [key, count] of Object.entries(counts)) {
        const row = nav.querySelector(`[data-list="${key}"]`);
        if (!row) continue;
        const badge = row.querySelector('.ot-list-count');
        badge.hidden = count === 0;
        badge.textContent = count ? String(count) : '';
        row.setAttribute(
          'aria-label',
          `${key === 'inbox' ? 'Inbox' : 'Today'}, ${count} unfinished ${count === 1 ? 'task' : 'tasks'}`,
        );
      }
    }
  };
  const refresh = async () => {
    const version = ++generation;
    try {
      // Use reference-aware records so tasks filed in ordinary notes leave Inbox.
      const records = await plugin.records();
      if (disposed || version !== generation) return;
      counts = listCounts(records, today(), plugin.settings);
      plugin.paintListCounts();
    } catch (error) {
      console.error('ThingsMD list counts:', error);
    }
  };
  const schedule = () => {
    // Invalidate pending reads immediately, not only after the debounce fires.
    generation++;
    clearTimeout(timer);
    timer = setTimeout(refresh, 100);
  };
  plugin.registerEvent(plugin.app.workspace.on('things-tasks-changed', schedule));
  for (const event of ['create', 'modify', 'delete', 'rename']) {
    plugin.registerEvent(plugin.app.vault.on(event, schedule));
  }
  plugin.register(() => {
    disposed = true;
    clearTimeout(timer);
    delete plugin.paintListCounts;
  });
  schedule();
}
module.exports = { listCounts, install };
