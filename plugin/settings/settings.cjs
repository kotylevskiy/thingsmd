const { PluginSettingTab, Setting, Notice, Platform } = require('obsidian');
const { WEEK_START_OPTIONS } = require('./settings-model.cjs');

module.exports = function installSettingsUI(plugin) {
  class SettingsTab extends PluginSettingTab {
    hide() {
      this.disposeHotkey?.();
    }
    display() {
      // Rebuilding after a calendar dialog closes must keep the user's place,
      // including settings hosted in a separate Obsidian window.
      const scroll = [];
      for (let el = this.containerEl; el; el = el.parentElement)
        if (el.scrollTop) scroll.push([el, el.scrollTop]);
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
      if (Platform.isDesktopApp && !Platform.isMobile)
        this.disposeHotkey = require('./global-hotkey-setting.cjs')(plugin, this.containerEl);
      new Setting(this.containerEl)
        .setName('Enable Waiting For')
        .setDesc(
          'Show the Waiting For list and airplane controls. When off, waiting tasks appear in their normal lists. Their waiting status is kept.',
        )
        .addToggle((toggle) => {
          toggle.toggleEl.setAttribute('aria-label', 'Enable Waiting For');
          toggle.setValue(plugin.settings.enableWaiting).onChange(async (value) => {
            try {
              await plugin.updateSettings({ enableWaiting: value });
            } catch (error) {
              new Notice(error.message);
            } finally {
              this.display();
              this.containerEl.querySelector('[aria-label="Enable Waiting For"]')?.focus();
            }
          });
        });
      new Setting(this.containerEl)
        .setName('Group waiting tasks in Today')
        .setClass('ot-dependent-setting')
        .setDesc(
          'Show waiting tasks scheduled for Today in a separate Waiting For section after This Evening. Turning this off keeps them in their normal Today or Evening section.',
        )
        .setDisabled(!plugin.settings.enableWaiting)
        .addToggle((t) => {
          t.toggleEl.setAttribute('aria-label', 'Group waiting tasks in Today');
          t.setDisabled(!plugin.settings.enableWaiting);
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
      new Setting(this.containerEl)
        .setName('Open task notes in')
        .setDesc(
          'Choose where clicking task notes or pressing Tab from the title opens the editor. Cmd/Ctrl+click always opens a new tab.',
        )
        .addDropdown((dropdown) => {
          dropdown.addOption('new', 'New tab').addOption('current', 'Current tab');
          dropdown.selectEl.setAttribute('aria-label', 'Open task notes in');
          dropdown
            .setValue(plugin.settings.taskNotesTab)
            .onChange((value) =>
              plugin
                .updateSettings({ taskNotesTab: value })
                .catch((error) => new Notice(error.message)),
            );
        });
      new Setting(this.containerEl)
        .setName('ThingsMD home folder')
        .setDesc(
          'Vault-relative folder for task notes and calendars. Press Enter or leave the field to move existing data and update task references.',
        )
        .addText((input) => {
          input.setValue(plugin.settings.tasksFolder);
          input.inputEl.setAttribute('aria-label', 'ThingsMD home folder');
          let saving = false;
          const save = async () => {
            if (saving || input.getValue() === plugin.settings.tasksFolder) return;
            saving = true;
            input.inputEl.readOnly = true;
            try {
              await plugin.changeTasksFolder(input.getValue());
            } catch (error) {
              new Notice(error.message);
            } finally {
              input.setValue(plugin.settings.tasksFolder);
              input.inputEl.readOnly = false;
              saving = false;
            }
          };
          input.inputEl.addEventListener('blur', save);
          input.inputEl.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            void save();
          });
        });
      new Setting(this.containerEl)
        .setName('Hide ThingsMD folder')
        .setDesc('The ThingsMD home folder contains task notes and cached calendar events.')
        .addToggle((toggle) => {
          toggle.toggleEl.setAttribute('aria-label', 'Hide ThingsMD folder');
          toggle
            .setValue(plugin.settings.tasksFolderDisplay === 'hidden')
            .onChange(async (hide) => {
              toggle.setDisabled(true);
              try {
                await plugin.updateSettings({ tasksFolderDisplay: hide ? 'hidden' : 'normal' });
              } catch (error) {
                toggle.setValue(plugin.settings.tasksFolderDisplay === 'hidden');
                new Notice(error.message);
              } finally {
                toggle.setDisabled(false);
              }
            });
        });
      new Setting(this.containerEl)
        .setName('Move completed tasks to Logbook')
        .setDesc(
          'Daily logs on the next day in the vault time zone. Weekly and monthly keep completed tasks in place for that long. Manually waits for Log Completed.',
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
      const mobileNavigation = new Setting(this.containerEl)
        .setName('Use task actions in mobile navigation')
        .setDesc(
          'Replace New note with New task and Search with Search Tasks in the mobile bottom bar.',
        )
        .addToggle((toggle) => {
          toggle.toggleEl.setAttribute('aria-label', 'Use task actions in mobile navigation');
          toggle.setValue(plugin.settings.mobileTaskNavigation).onChange(async (value) => {
            try {
              await plugin.updateSettings({ mobileTaskNavigation: value });
            } catch (error) {
              toggle.setValue(plugin.settings.mobileTaskNavigation);
              new Notice(error.message);
            }
          });
        });
      mobileNavigation.nameEl.createSpan({
        cls: 'flair ot-setting-badge',
        text: 'Experimental',
      });
      new Setting(this.containerEl)
        .setName('First day of the week')
        .setDesc(
          'Sets the week boundary in date pickers and the Logbook. Automatic uses the browser locale.',
        )
        .addDropdown((dropdown) => {
          const format = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
          dropdown.addOption('auto', 'Automatic');
          for (const day of WEEK_START_OPTIONS)
            dropdown.addOption(String(day), format.format(new Date(2024, 0, 7 + day, 12)));
          dropdown.selectEl.setAttribute('aria-label', 'First day of the week');
          const selection = () => String(plugin.settings.weekStartsOn ?? 'auto');
          dropdown.setValue(selection()).onChange(async (value) => {
            try {
              await plugin.updateSettings({
                weekStartsOn: value === 'auto' ? null : Number(value),
              });
            } catch (error) {
              dropdown.setValue(selection());
              new Notice(error.message);
            }
          });
        });
      new Setting(this.containerEl)
        .setName('Vault time zone')
        .setDesc(
          'All devices using this vault share the same moment of midnight, so automatically created and logged tasks get matching timestamps and avoid sync conflicts. Set from the system time zone on first setup, then saved with the vault.',
        )
        .addDropdown((dropdown) => {
          const zones = new Set([
            'UTC',
            plugin.settings.timeZone,
            ...(Intl.supportedValuesOf?.('timeZone') || []),
          ]);
          for (const zone of [...zones].sort()) dropdown.addOption(zone, zone.replaceAll('_', ' '));
          dropdown.selectEl.setAttribute('aria-label', 'Vault time zone');
          dropdown.setValue(plugin.settings.timeZone).onChange(async (timeZone) => {
            try {
              await plugin.updateSettings({ timeZone });
            } catch (error) {
              dropdown.setValue(plugin.settings.timeZone);
              new Notice(error.message);
            }
          });
        });
      require('../calendar/settings.cjs')(plugin, this.containerEl, () => this.display());
      require('../conversion/settings.cjs')(plugin, this.containerEl);
      for (const [el, top] of scroll) el.scrollTop = top;
    }
  }
  const tab = new SettingsTab(plugin.app, plugin);
  plugin.addSettingTab(tab);
  plugin.register(() => tab.hide());
  plugin.addCommand({
    id: 'log-completed',
    name: 'Log Completed',
    callback: () => plugin.logCompleted().catch((e) => new Notice(e.message)),
  });
};
