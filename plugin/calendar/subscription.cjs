const { calendarSecretName, subscriptionUrl } = require('./model.cjs');
const { parseCalendar, eventsOnDay } = require('./parser.cjs');
const {
  sourceKey,
  generation,
  newSource,
  matchesSource,
  urlFingerprint,
} = require('./identity.cjs');

async function validateSubscription(plugin, url, timeoutMs = 30000) {
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
  return { subscription, parsed };
}

class SubscriptionMismatch extends Error {
  constructor(name, expected) {
    super('This subscription could not be verified as the same calendar.');
    this.name = 'SubscriptionMismatch';
    this.calendarName = name;
    this.expected = expected;
  }
}

async function saveSubscription(
  plugin,
  calendar,
  url,
  { cancelled = () => false, timeoutMs, replace = false, expected } = {},
) {
  const secrets = plugin.app.secretStorage;
  const secretName = calendarSecretName(calendar.id);
  if (!secrets || !secretName) throw new Error('Secret storage is unavailable for this calendar.');
  const service = plugin.calendar;
  await plugin.syncCalendarSettings?.();
  if (service.moving)
    throw new Error('Finish changing the ThingsMD home folder before saving the link.');
  const originalRoot = service.root;
  const initial = plugin.settings.calendars.find((c) => c.id === calendar.id);
  const previous = secrets.getSecret(secretName);
  const originalKey = sourceKey(initial?.source);
  const ensureCurrent = (settings = plugin.settings) => {
    if (cancelled() || service.disposed) throw new Error('Calendar setup cancelled.');
    const current = settings.calendars.find((c) => c.id === calendar.id);
    if (!current || sourceKey(current.source) !== originalKey)
      throw new Error('Calendar source changed. Check the subscription URL again.');
    if (secrets.getSecret(secretName) !== previous)
      throw new Error('The subscription URL changed while checking this calendar. Try again.');
    return current;
  };
  ensureCurrent();
  if (
    replace &&
    (!expected ||
      expected.sourceKey !== originalKey ||
      expected.secretHash !==
        (await urlFingerprint(expected.secretSalt, JSON.stringify(previous ?? null))))
  )
    throw new Error('Calendar source changed. Check the subscription URL again.');
  const { subscription, parsed } = await validateSubscription(plugin, url, timeoutMs);
  await plugin.syncCalendarSettings?.();
  ensureCurrent();
  const snapshot = await service.load?.(initial);
  const cachedUid =
    snapshot?.parsed.uid || service.states.get(calendar.id)?.snapshot?.parsed?.uid || '';
  let baseline = initial.source;
  if (!baseline && cachedUid) baseline = { uid: cachedUid };
  if (!baseline && previous) {
    try {
      baseline = await newSource(subscriptionUrl(previous), cachedUid);
    } catch {
      /* An invalid existing secret cannot establish identity. */
    }
  }
  const matches = await matchesSource(baseline, subscription, parsed.uid);
  ensureCurrent();
  if (!matches && !replace) {
    const secretSalt = crypto.randomUUID();
    const secretHash = await urlFingerprint(secretSalt, JSON.stringify(previous ?? null));
    ensureCurrent();
    throw new SubscriptionMismatch(parsed.name, { sourceKey: originalKey, secretSalt, secretHash });
  }
  const source = !matches
    ? await newSource(subscription, parsed.uid, crypto.randomUUID(), [
        ...(initial.source?.retiredGenerations || []),
        '',
        generation(initial),
      ])
    : !initial.source?.urlHash
      ? await newSource(
          subscription,
          parsed.uid || initial.source?.uid || '',
          generation(initial),
          initial.source?.retiredGenerations,
        )
      : { ...initial.source, uid: initial.source.uid || parsed.uid };
  const oldState = service.states.get(calendar.id);
  await plugin.persistSettings(
    (settings) => {
      ensureCurrent(settings);
      return {
        calendars: settings.calendars.map((c) => (c.id === calendar.id ? { ...c, source } : c)),
      };
    },
    {
      prepare: () => {
        ensureCurrent();
        if (service.moving)
          throw new Error('Finish changing the ThingsMD home folder before saving the link.');
        try {
          secrets.setSecret(secretName, subscription);
        } catch {
          throw new Error('Unable to save the subscription URL on this device.');
        }
        // A request using the previous URL must not publish after this save.
        service.states.delete(calendar.id);
      },
      rollback: () => {
        // Do not overwrite a concurrent external secret edit while rolling back.
        if (secrets.getSecret(secretName) === subscription) {
          if (previous == null) secrets.deleteSecret(secretName);
          else secrets.setSecret(secretName, previous);
        }
        const current = plugin.settings.calendars.find((c) => c.id === calendar.id);
        if (
          oldState &&
          !service.states.has(calendar.id) &&
          sourceKey(current?.source) === originalKey &&
          service.root === originalRoot
        )
          service.states.set(calendar.id, oldState);
      },
    },
  );
  service.configure(plugin.settings.calendars);
  const current = plugin.settings.calendars.find((c) => c.id === calendar.id);
  service.states.set(calendar.id, {
    generation: generation(current),
    next: 0,
    failures: 0,
    snapshot:
      generation(initial) === generation(current) && service.root === originalRoot
        ? oldState?.snapshot
        : undefined,
  });
  await service.pending.get(calendar.id);
  await service.refresh(current, true);
}

module.exports = { validateSubscription, saveSubscription, SubscriptionMismatch };
