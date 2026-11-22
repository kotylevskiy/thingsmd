const { calendarSecretName, subscriptionUrl } = require('./model.cjs');
const { sourceKey, sameUrl, rememberSource } = require('./identity.cjs');

module.exports = async function bootstrapIdentities(plugin) {
  for (const config of plugin.settings.calendars) {
    if (config.source?.uid && config.source.urlHash) continue;
    const cached = await plugin.calendar.load(config);
    const uid = cached?.parsed.uid || '';
    const secretName = calendarSecretName(config.id);
    const value = secretName && plugin.app.secretStorage?.getSecret(secretName);
    if (!config.source && uid) {
      // Verify an existing secret against the cached UID before trusting its URL.
      const source = { salt: crypto.randomUUID(), urlHash: '', uid, generation: '' };
      await plugin.persistSettings((settings) => ({
        calendars: settings.calendars.map((current) =>
          current.id === config.id && sourceKey(current.source) === sourceKey(config.source)
            ? { ...current, source }
            : current,
        ),
      }));
      plugin.calendar.configure(plugin.settings.calendars);
      continue;
    }
    if (value) {
      let url;
      try {
        url = subscriptionUrl(value);
      } catch {
        continue;
      }
      if (!config.source || (await sameUrl(config.source, url)))
        await rememberSource(plugin, config, url, { uid });
    }
  }
};
