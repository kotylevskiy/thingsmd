const { subscriptionUrl } = require('./model.cjs');
const { parseCalendar, eventsOnDay } = require('./parser.cjs');

async function createCalendar(
  plugin,
  { url },
  { cancelled = () => false, timeoutMs = 30000 } = {},
) {
  const subscription = subscriptionUrl(url);
  let timer, parsed;
  try {
    const response = await Promise.race([
      plugin.calendar.request({
        url: subscription,
        method: 'GET',
        headers: { Accept: 'text/calendar' },
        throw: false,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error()), timeoutMs);
      }),
    ]);
    if (response.status !== 200) throw new Error();
    parsed = parseCalendar(response.text);
    eventsOnDay(parsed);
  } catch {
    throw new Error(
      'Unable to load a valid ICS calendar. Check the subscription URL and connection.',
    );
  } finally {
    clearTimeout(timer);
  }
  const isCancelled = () => cancelled() || plugin.calendar.disposed;
  if (isCancelled()) throw new Error('Calendar creation cancelled.');
  const id = crypto.randomUUID();
  const secretName = `thingsmd-calendar-${id}`;
  const calendar = {
    id,
    name: parsed.name,
    secretName,
    enabled: true,
    refreshMinutes: 15,
    color: '',
  };
  const secrets = plugin.app.secretStorage;
  try {
    secrets.setSecret(secretName, subscription);
    await plugin.updateSettings((settings) => {
      if (isCancelled()) throw new Error('Calendar creation cancelled.');
      return { calendars: [...settings.calendars, calendar] };
    });
  } catch {
    // Persistence can succeed before a post-save UI/maintenance hook fails.
    // Treat an already committed calendar as created, so retry cannot duplicate it.
    if (plugin.settings.calendars.some((entry) => entry.id === id)) return calendar;
    try {
      secrets.deleteSecret(secretName);
    } catch {
      /* Keep the original save error. */
    }
    throw new Error('Unable to add calendar.');
  }
  return calendar;
}
module.exports = { createCalendar };
