const { validateSubscription } = require('./subscription.cjs');
const { newSource } = require('./identity.cjs');

async function createCalendar(
  plugin,
  { url },
  { cancelled = () => false, timeoutMs = 30000 } = {},
) {
  const { subscription, parsed } = await validateSubscription(plugin, url, timeoutMs);
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
    source: await newSource(subscription, parsed.uid),
  };
  const secrets = plugin.app.secretStorage;
  if (isCancelled()) throw new Error('Calendar creation cancelled.');
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
