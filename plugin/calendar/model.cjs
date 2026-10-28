const { normalizeColor } = require('./color.cjs');
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
function calendars(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((entry) => {
      if (!entry || typeof entry.id !== 'string' || !ID.test(entry.id) || seen.has(entry.id))
        return false;
      seen.add(entry.id);
      return true;
    })
    .map((entry) => ({
      id: entry.id,
      name: String(entry.name || 'Calendar').slice(0, 100),
      secretName: typeof entry.secretName === 'string' ? entry.secretName : '',
      enabled: entry.enabled !== false,
      color: normalizeColor(entry.color),
      refreshMinutes: Math.max(5, Math.min(10080, Number(entry.refreshMinutes) || 15)),
    }));
}
function subscriptionUrl(value) {
  let url;
  try {
    url = new URL(
      String(value)
        .trim()
        .replace(/^webcal:/i, 'https:'),
    );
  } catch {
    throw new Error('Invalid calendar subscription URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Use an HTTPS calendar URL (HTTP is allowed only on localhost for tests).');
  return url.href;
}
function retryDelay(value, now) {
  const seconds = Number(value);
  if (value && Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
module.exports = { calendars, subscriptionUrl, retryDelay };
