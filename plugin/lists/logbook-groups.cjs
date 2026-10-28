const { firstWeekday } = require('../shared/date-picker-model.cjs');
const { dayKey } = require('../shared/vault-time.cjs');
const { date, daysBetween, addDays } = require('../shared/local-date.cjs');

function completionTime(task) {
  for (const stamp of [task.meta.completed, task.meta.loggedAt]) {
    if (!stamp) continue;
    const time = new Date(stamp).getTime();
    if (Number.isFinite(time)) return time;
  }
  return null;
}
function logbookGroups(tasks, { now = new Date(), timeZone, locale = 'en' } = {}) {
  const today = dayKey(now, timeZone);
  // Recent day sections stop at the locale’s calendar-week boundary.
  const weekStart = addDays(today, -((date(today).getDay() - firstWeekday(locale) + 7) % 7));
  const lastWeekStart = addDays(weekStart, -7);
  const groups = new Map();
  // Parse once per task, rather than on every sort comparison. Missing dates
  // stay visible at the end; group membership uses the same timestamp as rows.
  const sorted = tasks.map((task) => ({ task, time: completionTime(task) }));
  sorted.sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity));
  for (const { task, time } of sorted) {
    let key = 'undated',
      title = 'No completion date';
    if (time !== null) {
      const day = dayKey(new Date(time), timeZone);
      const age = daysBetween(day, today);
      if (age >= 0 && day >= weekStart) {
        key = day;
        title = age === 0 ? 'Today' : age === 1 ? 'Yesterday' : `${age} Days Ago`;
      } else if (day >= lastWeekStart && day < weekStart) {
        key = `week:${lastWeekStart}`;
        title = 'Last Week';
      } else {
        key = day.slice(0, 7);
        title = new Intl.DateTimeFormat(locale, {
          month: 'long',
          ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
        }).format(date(day));
      }
    }
    if (!groups.has(key)) groups.set(key, { key, title, tasks: [] });
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()];
}
module.exports = { logbookGroups, completionTime };
