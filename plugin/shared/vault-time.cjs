const formatters = new Map();
const systemTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function validTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
function dayKey(date, timeZone = systemTimeZone()) {
  if (!formatters.has(timeZone))
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en', {
        timeZone,
        calendar: 'iso8601',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );
  const parts = Object.fromEntries(
    formatters
      .get(timeZone)
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// Find the first instant of the calendar day, including DST changes at midnight.
function startOfDay(key, timeZone = systemTimeZone()) {
  const utc = Date.parse(`${key}T00:00:00.000Z`);
  let low = utc - 36 * 3600000,
    high = utc + 36 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dayKey(new Date(middle), timeZone) < key) low = middle + 1;
    else high = middle;
  }
  return new Date(low).toISOString();
}
module.exports = { systemTimeZone, validTimeZone, dayKey, startOfDay };
