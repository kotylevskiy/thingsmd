const { requestUrl } = require('obsidian');
const { CalendarService, ROOT } = require('./service.cjs');
module.exports = function installCalendar(plugin) {
  const vault = plugin.app.vault;
  const service = new CalendarService({
    storage: {
      async list(folder) {
        if (!(await vault.adapter.exists(folder))) return [];
        return (await vault.adapter.list(folder)).files;
      },
      read: (path) => vault.adapter.read(path),
      async create(path, body) {
        const parts = path.split('/');
        parts.pop();
        let folder = '';
        for (const part of parts) {
          folder = folder ? `${folder}/${part}` : part;
          if (!(await vault.adapter.exists(folder))) {
            try {
              await vault.createFolder(folder);
            } catch (error) {
              if (!(await vault.adapter.exists(folder))) throw error;
            }
          }
        }
        await vault.create(path, body);
      },
      async remove(path) {
        const file = vault.getAbstractFileByPath(path);
        if (file) await vault.delete(file);
      },
    },
    request: (options) => requestUrl(options),
    secret: (name) => (name ? plugin.app.secretStorage?.getSecret(name) : null),
    changed: () => plugin.app.workspace.trigger('thingsmd-calendar-changed'),
  });
  plugin.calendar = service;
  plugin.calendarDialogs = new Set();
  service.configure(plugin.settings.calendars);
  let reloadTimer;
  const refresh = () => {
    void service.reload().then(() => service.refreshAll());
  };
  const onFile = (file, oldPath) => {
    if (![file?.path, oldPath].some((path) => path?.startsWith(ROOT + '/'))) return;
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
  plugin.app.workspace.onLayoutReady(refresh);
  plugin.register(() => {
    clearTimeout(reloadTimer);
    service.dispose();
    for (const dialog of plugin.calendarDialogs) dialog.close();
    plugin.calendarDialogs.clear();
  });
  plugin.addCommand({
    id: 'refresh-calendars',
    name: 'Refresh calendars',
    callback: () => void service.refreshAll(true),
  });
};
