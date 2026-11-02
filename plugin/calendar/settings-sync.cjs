const { settings } = require('../settings/settings-model.cjs');
const { calendars } = require('./model.cjs');
const { sourceIdentity } = require('./identity.cjs');
const { calendarRoot } = require('./home.cjs');

module.exports = function installCalendarSettingsSync(plugin) {
  const service = plugin.calendar;
  const unavailable =
    'Calendar settings are temporarily unavailable during sync. Refresh will resume when they are ready.';
  // Called inside the settings queue, including before writes. Never publish a
  // partially copied settings file as an empty or unverified calendar configuration.
  plugin.readCalendarSettings = async () => {
    try {
      const data = await plugin.loadData();
      if (service.disposed) return data;
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        (data.calendars !== undefined && !Array.isArray(data.calendars)) ||
        (data.calendars === undefined && plugin.settings.calendars.length)
      )
        throw new Error();
      const entries = data.calendars || [];
      if (
        calendars(entries).length !== entries.length ||
        entries.some(
          (c) =>
            (c.source != null ||
              plugin.settings.calendars.find((known) => known.id === c.id)?.source) &&
            !sourceIdentity(c.source),
        )
      )
        throw new Error();
      const next = settings(data);
      const recovered = !!service.settingsError;
      service.settingsError = '';
      if (!service.moving) {
        const root = calendarRoot(next.tasksFolder);
        const moved = root !== service.root;
        const changed = moved || JSON.stringify(service.config) !== JSON.stringify(next.calendars);
        plugin.settings = {
          ...plugin.settings,
          calendars: next.calendars,
          tasksFolder: next.tasksFolder,
        };
        if (moved) {
          service.root = root;
          service.states.clear();
          plugin.paintTaskFolder?.();
          plugin.tasksChanged?.();
        }
        if (changed) service.configure(next.calendars);
      }
      if (recovered) {
        for (const state of service.states.values()) state.next = 0;
        service.changed();
      }
      return data;
    } catch {
      if (service.settingsError !== unavailable) {
        service.settingsError = unavailable;
        service.changed();
      }
      throw new Error(unavailable);
    }
  };
  plugin.syncCalendarSettings = () =>
    plugin.withSettingsLock(async () => {
      const before = JSON.stringify([service.root, service.config, service.settingsError || '']);
      await plugin.readCalendarSettings();
      return before !== JSON.stringify([service.root, service.config, service.settingsError || '']);
    });
};
