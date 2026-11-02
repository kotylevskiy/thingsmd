const { requestUrl } = require('obsidian');
const { CalendarService } = require('./service.cjs');
const { calendarRoot, LEGACY_ROOT, moveCalendarHome } = require('./home.cjs');
const { rememberSource } = require('./identity.cjs');
const { calendarVaultStorage } = require('./vault-storage.cjs');
const { CalendarRefreshCoordinator } = require('./refresh-coordinator.cjs');
module.exports = async function installCalendar(plugin) {
  const vault = plugin.app.vault;
  // Composition root: adapt Obsidian APIs, then wire domain services and triggers.
  const service = new CalendarService({
    root: calendarRoot(plugin.settings.tasksFolder),
    storage: calendarVaultStorage(vault),
    request: (options) => requestUrl(options),
    secret: (name) => (name ? plugin.app.secretStorage?.getSecret(name) : null),
    changed: () => plugin.app.workspace.trigger('thingsmd-calendar-changed'),
    verified: (config, url, parsed) => rememberSource(plugin, config, url, parsed),
  });
  plugin.calendar = service;
  require('./settings-sync.cjs')(plugin);
  const coordinator = new CalendarRefreshCoordinator(service, () => plugin.syncCalendarSettings());
  service.synchronize = () => coordinator.synchronize();
  plugin.calendarDialogs = new Set();
  let reloadTimer;
  // Register cleanup before asynchronous migration/bootstrap: failed startup
  // must release pending triggers and dialogs just like a normal unload.
  plugin.register(() => {
    clearTimeout(reloadTimer);
    coordinator.dispose();
    service.dispose();
    for (const dialog of plugin.calendarDialogs) dialog.close();
    plugin.calendarDialogs.clear();
  });
  service.configure(plugin.settings.calendars);
  await moveCalendarHome(plugin, plugin.settings.tasksFolder, undefined, LEGACY_ROOT);
  await require('./identity-bootstrap.cjs')(plugin);
  const refresh = () => void coordinator.refresh();
  const onFile = (file, oldPath) => {
    if (![file?.path, oldPath].some((path) => path?.startsWith(service.root + '/'))) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void service.reload(), 300);
  };
  for (const event of ['create', 'modify', 'delete', 'rename'])
    plugin.registerEvent(vault.on(event, onFile));
  plugin.registerDomEvent(document, 'visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  plugin.registerDomEvent(window, 'focus', refresh);
  plugin.registerInterval(
    setInterval(() => {
      if (!document.hidden) refresh();
    }, 60000),
  );
  plugin.registerInterval(
    setInterval(() => {
      if (!document.hidden) void coordinator.poll();
    }, 1000),
  );
  plugin.app.workspace.onLayoutReady(refresh);
  plugin.addCommand({
    id: 'refresh-calendars',
    name: 'Refresh calendars',
    callback: () => void service.refreshAll(true),
  });
};
