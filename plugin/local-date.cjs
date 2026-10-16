// Task dates use the local calendar day, never a UTC conversion.
const dayKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => dayKey(new Date());
const dayAfter = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return dayKey(date);
};
function fromParts(year, month, day) {
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}
function parseDate(value, now = new Date()) {
  const text = value.trim().toLowerCase();
  const relative = { today: 0, tomorrow: 1, 'next week': 7 };
  if (Object.hasOwn(relative, text)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + relative[text], 12);
    return dayKey(d);
  }
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let date = m ? fromParts(+m[1], +m[2], +m[3]) : null;
  if (!m) {
    m = text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
    if (m) date = fromParts(m[3] ? +m[3] : now.getFullYear(), +m[2], +m[1]);
  }
  return date ? dayKey(date) : null;
}

module.exports = { dayKey, today, dayAfter, parseDate };
