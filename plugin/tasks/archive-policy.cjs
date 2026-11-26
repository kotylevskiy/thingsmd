const { isFinished } = require('./task-status.cjs');
const { dayKey: localDay } = require('../shared/local-date.cjs');
const { dayKey: vaultDay, startOfDay } = require('../shared/vault-time.cjs');
const RETENTION_MONTHS = {
  '5-years': 60,
  '3-years': 36,
  '1-year': 12,
  '3-months': 3,
  '1-month': 1,
};
function loggingDay(meta, mode, timeZone) {
  const completed = new Date(meta.completed);
  if (!meta.completed || Number.isNaN(completed.getTime())) return null;
  const key = timeZone ? vaultDay(completed, timeZone) : localDay(completed);
  const end = new Date(`${key}T12:00:00Z`),
    day = end.getUTCDate();
  if (mode !== 'monthly') {
    end.setUTCDate(day + (mode === 'weekly' ? 7 : 1));
    return end.toISOString().slice(0, 10);
  }
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(
    Math.min(day, new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()),
  );
  return end.toISOString().slice(0, 10);
}
function plannedLogAt(meta, mode = 'daily', timeZone) {
  if (mode === 'manually' || !meta.completed) return null;
  const completed = new Date(meta.completed);
  if (Number.isNaN(completed.getTime())) return null;
  if (mode === 'immediately') return completed.toISOString();
  return startOfDay(loggingDay(meta, mode, timeZone), timeZone);
}
function shouldLog(meta, today, mode = 'daily', timeZone) {
  if (!isFinished(meta)) return false;
  if (meta.loggedAt) return true;
  if (mode === 'manually') return false;
  if (mode === 'immediately') return true;
  const end = loggingDay(meta, mode, timeZone);
  return !end || end <= today;
}
function trashExpiresAt(meta, retention) {
  if (!meta.deleted || retention === 'never') return Infinity;
  if (retention === 'immediately') return -Infinity;
  const deleted = new Date(meta.deletedAt);
  if (!meta.deletedAt || Number.isNaN(deleted.getTime())) return Infinity;
  const expires = new Date(deleted);
  if (retention === '1-week') expires.setDate(expires.getDate() + 7);
  else if (RETENTION_MONTHS[retention]) {
    const day = expires.getDate();
    expires.setDate(1);
    expires.setMonth(expires.getMonth() + RETENTION_MONTHS[retention]);
    expires.setDate(
      Math.min(day, new Date(expires.getFullYear(), expires.getMonth() + 1, 0).getDate()),
    );
  } else return Infinity;
  return expires.getTime();
}
const trashExpired = (meta, retention, now = new Date()) => trashExpiresAt(meta, retention) <= now;
module.exports = { shouldLog, plannedLogAt, trashExpired, trashExpiresAt };
