const { isFinished } = require('./task-status.cjs');
const { inList } = require('./model.cjs');
const { PAGES } = require('./lists.cjs');
const { today } = require('./local-date.cjs');
const lists = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'waiting'];

function moveMessage(before, after, settings = {}, day = today(), preferred) {
  if (!after || before.meta.deleted || after.meta.deleted || isFinished(after.meta)) return null;
  const membership = (task) =>
    lists.filter((list) =>
      inList(
        task,
        list,
        day,
        settings.logbook,
        settings.captureDestination,
        settings.enableWaiting,
      ),
    );
  const oldLists = membership(before),
    newLists = membership(after);
  const placementChanged =
    (before.meta.project || null) !== (after.meta.project || null) ||
    JSON.stringify(before.references || []) !== JSON.stringify(after.references || []);
  const scheduleChanged =
    (before.meta.when || null) !== (after.meta.when || null) ||
    (before.meta.evening || null) !== (after.meta.evening || null);
  if (
    JSON.stringify(oldLists) === JSON.stringify(newLists) &&
    !placementChanged &&
    !scheduleChanged
  )
    return null;
  let destinations = preferred ? [preferred] : newLists;
  if (!preferred && placementChanged && after.meta.project)
    destinations = [after.meta.project.replace(/\.md$/, ''), ...destinations];
  const labels = destinations.map((key) => PAGES.find(([id]) => id === key)?.[1] || key);
  if (!labels.length) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(after.meta.when) ? ` (${after.meta.when})` : '';
  return `“${after.meta.title || 'Task'}” moved to ${labels.join(' · ')}${date}`;
}

function install(plugin) {
  const { Notice } = require('obsidian');
  let current;
  plugin.register?.(() => current?.hide());
  plugin.notifyTaskMove = (before, after, preferred) => {
    const message = moveMessage(before, after, plugin.settings, today(), preferred);
    if (message) {
      // Rapid moves should replace the previous destination, not cover a phone
      // screen with a stack of notices that intercepts task interactions.
      current?.hide();
      current = new Notice(message, 5000);
    }
  };
}
module.exports = { moveMessage, install };
