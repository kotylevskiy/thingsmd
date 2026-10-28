const { Setting, Notice, ButtonComponent } = require('obsidian');
const { quietLabel } = require('../shared/quiet-label.cjs');
const { defaultColor } = require('./color.cjs');
const CreateCalendarDialog = require('./create-dialog.cjs');
const CalendarSettingsDialog = require('./settings-dialog.cjs');

module.exports = function calendarSettings(plugin, container, redisplay) {
  const section = container.createDiv('ot-calendar-settings-section');
  const supported = !!plugin.app.secretStorage;
  new Setting(section)
    .setClass('ot-calendar-settings-header')
    .setName('Calendars')
    .setHeading()
    .setDesc('Sync your calendars to the vault to view them in Today and Upcoming.');
  if (!supported)
    section.createEl('p', {
      text: 'Obsidian 1.11.4 or newer is required to add calendars. Synced snapshots remain available.',
    });
  for (const calendar of plugin.settings.calendars) {
    const row = new Setting(section).setClass('ot-calendar-settings-row').setName(calendar.name);
    const dot = row.nameEl.createSpan('ot-calendar-color-dot');
    dot.style.backgroundColor =
      plugin.calendar?.color(calendar) || calendar.color || defaultColor(calendar.id);
    row.nameEl.prepend(dot);
    row.addToggle((toggle) => {
      quietLabel(toggle.toggleEl, 'Show in Today and Upcoming');
      toggle.setValue(calendar.enabled).onChange(async (enabled) => {
        toggle.setDisabled(true);
        try {
          await plugin.updateSettings((settings) => ({
            calendars: settings.calendars.map((c) =>
              c.id === calendar.id ? { ...c, enabled } : c,
            ),
          }));
        } catch {
          toggle.setValue(
            plugin.settings.calendars.find((c) => c.id === calendar.id)?.enabled ??
              calendar.enabled,
          );
          new Notice('Unable to save calendar settings.');
        } finally {
          toggle.setDisabled(false);
        }
      });
    });
    row.addButton((button) => {
      button.setIcon('settings');
      button.buttonEl.addClass('ot-calendar-row-action');
      quietLabel(button.buttonEl, 'Configure calendar');
      button.onClick(() => {
        new CalendarSettingsDialog(plugin, calendar, redisplay).open();
      });
    });
    row.addButton((button) => {
      button.setIcon('trash-2');
      button.buttonEl.addClass('ot-calendar-row-action', 'ot-calendar-remove');
      quietLabel(button.buttonEl, 'Remove calendar');
      button.onClick(async () => {
        button.setDisabled(true);
        try {
          await plugin.updateSettings((settings) => ({
            calendars: settings.calendars.filter((c) => c.id !== calendar.id),
          }));
          redisplay();
        } catch {
          button.setDisabled(false);
          new Notice('Unable to remove calendar.');
        }
      });
    });
  }
  new ButtonComponent(section.createDiv('ot-calendar-add'))
    .setButtonText('Add calendar')
    .setDisabled(!supported)
    .onClick(() => {
      new CreateCalendarDialog(plugin, redisplay).open();
    });
};
