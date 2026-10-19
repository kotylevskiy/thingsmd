const { isFinished } = require('./task-status.cjs');
const RETENTION_MONTHS = {
  '5-years': 60,
  '3-years': 36,
  '1-year': 12,
  '3-months': 3,
  '1-month': 1,
};
function shouldLog(meta, today, mode = 'daily') {
  if (!isFinished(meta)) return false;
  if (meta.loggedAt) return true;
  if (mode === 'manually') return false;
  if (mode === 'immediately') return true;
  const completed = new Date(meta.completed);
  if (!meta.completed || Number.isNaN(completed.getTime())) return true;
  const day = new Date(today + 'T12:00:00');
  const end = new Date(completed.getFullYear(), completed.getMonth(), completed.getDate(), 12);
  if (mode === 'weekly') end.setDate(end.getDate() + 7);
  else if (mode === 'monthly') {
    const date = end.getDate();
    end.setDate(1);
    end.setMonth(end.getMonth() + 1);
    end.setDate(Math.min(date, new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()));
  } else end.setDate(end.getDate() + 1);
  return end <= day;
}
function trashExpired(meta, retention, now = new Date()) {
  if (!meta.deleted || retention === 'never') return false;
  if (retention === 'immediately') return true;
  const deleted = new Date(meta.deletedAt);
  if (!meta.deletedAt || Number.isNaN(deleted.getTime())) return false;
  const expires = new Date(deleted);
  if (retention === '1-week') expires.setDate(expires.getDate() + 7);
  else if (RETENTION_MONTHS[retention]) {
    const day = expires.getDate();
    expires.setDate(1);
    expires.setMonth(expires.getMonth() + RETENTION_MONTHS[retention]);
    expires.setDate(
      Math.min(day, new Date(expires.getFullYear(), expires.getMonth() + 1, 0).getDate()),
    );
  } else return false;
  return expires <= now;
}
module.exports = { shouldLog, trashExpired };
