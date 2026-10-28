const { normalizePath, moment } = require('obsidian');

// Isolate the core-plugin/command integration: Obsidian has no public daily-note
// creation API. Invoke its registered command so templates finish before filing.
module.exports = function installDailyCapture(plugin) {
  plugin.captureDestination = async (fields) => {
    if (plugin.settings.captureDestination !== 'daily-note' || fields.project) return null;
    const app = plugin.app,
      core = app.internalPlugins?.getPluginById('daily-notes');
    const command = app.commands?.commands?.['daily-notes'];
    if (!core?.enabled || !core.instance || typeof command?.callback !== 'function')
      throw new Error('Enable Obsidian’s Daily notes core plugin to capture into a daily note.');
    const daily = core.instance;
    const now = moment();
    const path = daily.getDailyNotePathBeforeAppLoads
      ? await daily.getDailyNotePathBeforeAppLoads(now)
      : normalizePath(
          (daily.options?.folder || app.fileManager.getNewFileParent('').path || '') +
            '/' +
            now.format(daily.options?.format || 'YYYY-MM-DD') +
            '.md',
        );
    if (!path)
      throw new Error('Check the Daily notes folder and date format in Obsidian settings.');
    let file =
      app.vault.getAbstractFileByPathInsensitive?.(path) || app.vault.getAbstractFileByPath(path);
    if (!file) {
      await command.callback();
      file =
        app.vault.getAbstractFileByPathInsensitive?.(path) || app.vault.getAbstractFileByPath(path);
    }
    if (file?.extension !== 'md')
      throw new Error(
        'Obsidian could not create today’s daily note. Check its folder and template settings, then retry.',
      );
    return file.path;
  };
};
