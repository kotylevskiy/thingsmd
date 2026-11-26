const { dayKey: localDay, addDays, validDate } = require('../shared/local-date.cjs');
const { shouldLog } = require('./archive-policy.cjs');
const { dayKey: vaultDay } = require('../shared/vault-time.cjs');

function compareTasks(a, b) {
  return (
    (Number(a.meta.order) || 0) - (Number(b.meta.order) || 0) ||
    String(a.meta.id).localeCompare(String(b.meta.id))
  );
}
function insertionOrder(tasks, beforeId) {
  const ordered = [...tasks].sort(compareTasks);
  const index = beforeId ? ordered.findIndex((t) => t.meta.id === beforeId) : ordered.length;
  if (index < 0) throw new Error('The target task moved. Try again.');
  const before = index ? Number(ordered[index - 1].meta.order) || 0 : null;
  const after = index < ordered.length ? Number(ordered[index].meta.order) || 0 : null;
  const rank =
    before === null
      ? (after ?? 2048) - 1024
      : after === null
        ? before + 1024
        : (before + after) / 2;
  if (rank === before || rank === after)
    throw new Error('Ordering needs rebalancing. Move this task to the end first.');
  return rank;
}
const dateReached = (value, today) => validDate(value) && value <= today;
const isTodayWhen = (when, today) => when === 'today' || dateReached(when, today);
// Explicit future scheduling wins over a deadline, even an overdue one.
const inToday = (meta, today) =>
  isTodayWhen(meta.when, today) ||
  (!futureDate(meta.when, today) &&
    meta.deadlineDeferredOn !== today &&
    dateReached(meta.deadline, today));
const inEvening = (meta, today) => meta.evening === today && inToday(meta, today);
function upcomingGroups(tasks, today) {
  const groups = new Map(Array.from({ length: 7 }, (_, i) => [addDays(today, i + 1), []]));
  for (const task of tasks) {
    for (const date of upcomingDates(task.meta, today)) {
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(task);
    }
  }
  return [...groups.keys()].sort().map((date) => [date, groups.get(date)]);
}
const futureDate = (value, today) => validDate(value) && value > today;
const inInbox = (task, today = localDay(new Date())) =>
  !task.meta.project && !task.references?.length && !task.meta.when && !inToday(task.meta, today);
// Upcoming is an agenda, not a second entry for each deadline. A dated When
// determines placement; otherwise an unstarted task can appear on its deadline.
const upcomingDates = (meta, today) => {
  if (meta.when === 'today' || dateReached(meta.when, today)) return [];
  const date = futureDate(meta.when, today) ? meta.when : meta.deadline;
  return futureDate(date, today) ? [date] : [];
};
const isLogged = (meta, today, mode = 'daily', timeZone) =>
  shouldLog(meta, today ?? vaultDay(new Date(), timeZone), mode, timeZone);
const isHidden = (meta, today, mode = 'daily', timeZone) =>
  !!meta.deleted || isLogged(meta, today, mode, timeZone);
function inList(
  task,
  list,
  today,
  mode = 'daily',
  captureDestination = 'inbox',
  enableWaiting = true,
  timeZone,
  vaultToday,
) {
  if (list === 'trash') return !!task.meta.deleted;
  if (task.meta.deleted) return false;
  const logged = isLogged(task.meta, vaultToday ?? (timeZone ? undefined : today), mode, timeZone);
  if (list === 'logbook') return logged;
  if (logged) return false;
  if (list === 'repeating') return !!(task.meta.repeat || task.meta.repeatSource);
  if (task.meta.repeat)
    return (
      list === 'upcoming' &&
      !task.meta.repeat.paused &&
      !!task.meta.repeat.next &&
      upcomingDates(task.meta, today).length > 0
    );
  if (list === 'waiting') return enableWaiting && task.meta.is_waiting === true;
  if (enableWaiting && task.meta.is_waiting === true && ['inbox', 'anytime'].includes(list))
    return false;
  if (list === 'inbox') return inInbox(task, today);
  if (list === 'today') return inToday(task.meta, today);
  if (list === 'someday') return task.meta.when === 'someday' && !inToday(task.meta, today);
  if (list === 'upcoming')
    return (
      (captureDestination === 'daily-note' || !inInbox(task, today)) &&
      upcomingDates(task.meta, today).length > 0
    );
  if (list === 'anytime')
    return (
      (captureDestination === 'daily-note' || !inInbox(task, today)) &&
      (task.meta.when !== 'someday' || inToday(task.meta, today)) &&
      !futureDate(task.meta.when, today)
    );
  return false;
}
module.exports = {
  inEvening,
  upcomingGroups,
  isLogged,
  isHidden,
  inList,
  inInbox,
  upcomingDates,
  compareTasks,
  insertionOrder,
  isTodayWhen,
  inToday,
};
