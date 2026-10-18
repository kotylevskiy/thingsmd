const { dayKey, date, addDays, daysBetween, validDate } = require('./local-date.cjs');

// Changing the anchor and changing the unit use the same initial day pattern.
function patternOnDate(unit, key) {
  const value = date(key);
  if (unit === 'week') return [{ weekday: value.getDay() }];
  if (unit === 'month') return [{ day: value.getDate() }];
  if (unit === 'year') return [{ month: value.getMonth() + 1, day: value.getDate() }];
  return [];
}
function addInterval(key, amount, unit) {
  if (unit === 'day' || unit === 'week') return addDays(key, amount * (unit === 'week' ? 7 : 1));
  const d = date(key),
    day = d.getDate();
  d.setDate(1);
  if (unit === 'month') d.setMonth(d.getMonth() + amount);
  else d.setFullYear(d.getFullYear() + amount);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return dayKey(d);
}
function validate(rule) {
  if (
    !['regular', 'completion'].includes(rule.mode) ||
    !['day', 'week', 'month', 'year'].includes(rule.unit)
  )
    throw new Error('Choose a repeat pattern.');
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 999)
    throw new Error('Repeat interval must be between 1 and 999.');
  if (!validDate(rule.anchor) || (rule.next != null && !validDate(rule.next)))
    throw new Error('Choose a valid next date.');
  if (rule.end && (!validDate(rule.end) || rule.end < rule.anchor))
    throw new Error('End date must be on or after the first date.');
  if (!Number.isInteger(rule.leadDays) || rule.leadDays < 0 || rule.leadDays > 3650)
    throw new Error('Days earlier must be between 0 and 3650.');
  if (rule.mode === 'regular' && rule.unit !== 'day') {
    if (!Array.isArray(rule.on) || !rule.on.length)
      throw new Error('Choose at least one repeat day.');
    for (const p of rule.on) {
      if (rule.unit === 'year' && (!Number.isInteger(p.month) || p.month < 1 || p.month > 12))
        throw new Error('Choose a month.');
      if (rule.unit === 'week' || p.ordinal != null) {
        if (!Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6)
          throw new Error('Choose a weekday.');
        if (rule.unit !== 'week' && ![1, 2, 3, 4, 5, -1].includes(p.ordinal))
          throw new Error('Choose a weekday position.');
      } else if (!Number.isInteger(p.day) || (p.day !== -1 && p.day < 1) || p.day > 31)
        throw new Error('Choose a day from 1 to 31.');
    }
  }
  return rule;
}
function matches(rule, key) {
  const d = date(key),
    a = date(rule.anchor),
    days = daysBetween(rule.anchor, key);
  if (days < 0) return false;
  if (rule.unit === 'day') return days % rule.interval === 0;
  if (rule.unit === 'week') {
    const start = addDays(rule.anchor, -((a.getDay() + 6) % 7));
    return (
      Math.floor(daysBetween(start, key) / 7) % rule.interval === 0 &&
      rule.on.some((p) => p.weekday === d.getDay())
    );
  }
  const months = (d.getFullYear() - a.getFullYear()) * 12 + d.getMonth() - a.getMonth();
  if (rule.unit === 'month' && months % rule.interval !== 0) return false;
  if (rule.unit === 'year' && (d.getFullYear() - a.getFullYear()) % rule.interval !== 0)
    return false;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return rule.on.some((p) => {
    if (rule.unit === 'year' && p.month !== d.getMonth() + 1) return false;
    if (p.ordinal != null)
      return (
        p.weekday === d.getDay() &&
        (p.ordinal === -1 ? d.getDate() + 7 > last : Math.ceil(d.getDate() / 7) === p.ordinal)
      );
    // A date past the end of a month lands on its final day (including leap years).
    return d.getDate() === (p.day === -1 ? last : Math.min(p.day, last));
  });
}
function nextDate(rule, after, inclusive = false) {
  validate(rule);
  if (rule.mode === 'completion') {
    const next = addInterval(after, rule.interval, rule.unit);
    return rule.end && next > rule.end ? null : next;
  }
  let key = inclusive ? after : addDays(after, 1);
  if (key < rule.anchor) key = rule.anchor;
  // Covers the maximum supported interval, plus leap-year/ordinal gaps.
  const limit = rule.interval * 366 + 366 * 8;
  for (let i = 0; i < limit; i++, key = addDays(key, 1)) {
    if (rule.end && key > rule.end) return null;
    if (matches(rule, key)) return key;
  }
  throw new Error('No matching date found. Adjust the repeat pattern.');
}
const availableDate = (rule) =>
  rule.next ? addDays(rule.next, rule.deadline ? -rule.leadDays : 0) : null;
function summary(rule) {
  const unit = rule.unit + (rule.interval === 1 ? '' : 's');
  let text =
    rule.mode === 'completion'
      ? `Repeat ${rule.interval} ${unit} after completion`
      : `Every ${rule.interval === 1 ? '' : rule.interval + ' '}${unit}`;
  if (rule.mode === 'regular' && rule.unit !== 'day') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const ordinals = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' };
    text +=
      ' on ' +
      rule.on
        .map((p) => {
          if (rule.unit === 'week') return days[p.weekday];
          const day =
            p.ordinal != null
              ? `${ordinals[p.ordinal]} ${days[p.weekday]}`
              : p.day === -1
                ? 'the last day'
                : String(p.day);
          return rule.unit === 'year' ? `${day} ${months[p.month - 1]}` : day;
        })
        .join(', ');
  }
  return (
    text +
    (rule.paused ? ' · Paused' : rule.waitingFor ? ' · Waiting' : !rule.next ? ' · Ended' : '')
  );
}
module.exports = {
  patternOnDate,
  addInterval,
  validate,
  nextDate,
  availableDate,
  summary,
};
