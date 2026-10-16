const { PluginSettingTab, Setting, Notice, Platform } = require('obsidian');

module.exports = function installSettingsUI(plugin) {
  class SettingsTab extends PluginSettingTab {
    hide() {
      this.disposeHotkey?.();
    }
    display() {
      this.disposeHotkey?.();
      this.containerEl.empty();
      new Setting(this.containerEl)
        .setName('Default capture destination')
        .setDesc(
          'Daily note uses Obsidian’s Daily notes folder, date format, and template. Missing notes are created with its standard command. Inbox is hidden; existing Inbox tasks remain in Anytime.',
        )
        .addDropdown((d) => {
          d.addOption('inbox', 'Inbox').addOption('daily-note', 'Daily note');
          d.selectEl.setAttribute('aria-label', 'Default capture destination');
          d.setValue(plugin.settings.captureDestination).onChange((v) =>
            plugin.updateSettings({ captureDestination: v }).catch((e) => new Notice(e.message)),
          );
        });
      if (Platform.isDesktopApp)
        this.disposeHotkey = require('./global-hotkey-setting.cjs')(plugin, this.containerEl);
      new Setting(this.containerEl)
        .setName('Move completed tasks to Logbook')
        .setDesc(
          'Daily logs on the next local day. Weekly and monthly keep completed tasks in place for that long. Manually waits for Log Completed.',
        )
        .addDropdown((d) => {
          for (const [key, label] of [
            ['immediately', 'Immediately'],
            ['daily', 'Daily'],
            ['weekly', 'After one week'],
            ['monthly', 'After one month'],
            ['manually', 'Manually'],
          ])
            d.addOption(key, label);
          d.selectEl.setAttribute('aria-label', 'Logbook frequency');
          d.setValue(plugin.settings.logbook).onChange((v) =>
            plugin.updateSettings({ logbook: v }).catch((e) => new Notice(e.message)),
          );
        });
      new Setting(this.containerEl)
        .setName('Keep tasks in Trash')
        .setDesc(
          'Retention starts when a task is trashed. Expired task files and their standalone note references are permanently removed while Obsidian is open. Delete permanently also clears existing Trash and hides it.',
        )
        .addDropdown((d) => {
          for (const [key, label] of [
            ['never', 'Never delete'],
            ['5-years', '5 years'],
            ['3-years', '3 years'],
            ['1-year', '1 year'],
            ['3-months', '3 months'],
            ['1-month', '1 month'],
            ['1-week', '1 week'],
            ['immediately', 'Delete permanently'],
          ])
            d.addOption(key, label);
          d.selectEl.setAttribute('aria-label', 'Trash retention');
          d.setValue(plugin.settings.trashRetention).onChange((v) =>
            plugin.updateSettings({ trashRetention: v }).catch((e) => new Notice(e.message)),
          );
        });
      new Setting(this.containerEl)
        .setName('Group waiting tasks in Today')
        .setDesc(
          'Show waiting tasks scheduled for Today in a separate Waiting For section after This Evening. Turning this off keeps them in their normal Today or Evening section.',
        )
        .addToggle((t) => {
          t.toggleEl.setAttribute('aria-label', 'Group waiting tasks in Today');
          t.setValue(plugin.settings.showWaitingInToday).onChange((v) =>
            plugin.updateSettings({ showWaitingInToday: v }).catch((e) => new Notice(e.message)),
          );
        });
      new Setting(this.containerEl)
        .setName('Show project progress')
        .setDesc(
          'Show a progress pie beside notes containing tasks, in the file sidebar, grouped list headings, and Move popup. The filled portion shows completed tasks, including logged tasks. Trashed tasks and repeating templates are excluded.',
        )
        .addToggle((t) => {
          t.toggleEl.setAttribute('aria-label', 'Show project progress');
          t.setValue(plugin.settings.showProjectProgress).onChange((v) =>
            plugin.updateSettings({ showProjectProgress: v }).catch((e) => new Notice(e.message)),
          );
        });
    }
  }
  plugin.addSettingTab(new SettingsTab(plugin.app, plugin));
  plugin.addCommand({
    id: 'log-completed',
    name: 'Log Completed',
    callback: () => plugin.logCompleted().catch((e) => new Notice(e.message)),
  });
};
