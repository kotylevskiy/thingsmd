const { Modal, Setting, Notice } = require('obsidian');
const { defaultColor } = require('./color.cjs');
const { colorSwatches } = require('./color-swatches.cjs');
const { quietLabel } = require('../shared/quiet-label.cjs');

function intervalLabel(minutes) {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes % 1440 === 0) return minutes === 1440 ? '1 day' : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}
module.exports = class CalendarSettingsDialog extends Modal {
  constructor(plugin, calendar, changed) {
    super(plugin.app);
    Object.assign(this, { plugin, calendar, changed });
  }
  onOpen() {
    this.plugin.calendarDialogs.add(this);
    this.setTitle('Calendar settings');
    this.modalEl.addClass('ot-calendar-configure');
    const { plugin, calendar } = this;
    const group = this.contentEl.createDiv('ot-calendar-options');
    const save = async (id, patch) => {
      try {
        await plugin.updateSettings((settings) => ({
          calendars: settings.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }));
        if (!group.isConnected) this.changed();
        return true;
      } catch {
        new Notice('Unable to save calendar settings.');
        return false;
      }
    };
    new Setting(group).setName('Calendar name').addText((input) => {
      input.setValue(calendar.name);
      quietLabel(input.inputEl, 'Calendar name');
      input.inputEl.addEventListener(
        'change',
        () => void save(calendar.id, { name: input.getValue() }),
      );
    });
    const current = () => plugin.settings.calendars.find((c) => c.id === calendar.id) || calendar;
    const color = new Setting(group)
      .setName('Calendar color')
      .setClass('ot-calendar-color-setting');
    colorSwatches(color.controlEl, {
      current: () => ({
        override: current().color || '',
        sourceColor:
          plugin.calendar?.color({ ...current(), color: '' }) || defaultColor(calendar.id),
      }),
      save: (color) => save(calendar.id, { color }),
    });
    const intervals = [
      ...new Set([5, 10, 15, 30, 60, 120, 240, 480, 720, 1440, 10080, calendar.refreshMinutes]),
    ].sort((a, b) => a - b);
    const interval = new Setting(group)
      .setName('Refresh interval')
      .setClass('ot-calendar-refresh-setting')
      .setDesc('Longer provider refresh hints take precedence.');
    interval.addSlider((slider) => {
      slider.getValuePretty = () => intervalLabel(intervals[slider.getValue()]);
      slider
        .setLimits(0, intervals.length - 1, 1)
        .setValue(intervals.indexOf(calendar.refreshMinutes));
      quietLabel(slider.sliderEl, 'Calendar refresh interval');
      slider.sliderEl.setAttribute('aria-valuetext', intervalLabel(calendar.refreshMinutes));
      slider.onChange(async (index) => {
        const minutes = intervals[index];
        slider.sliderEl.setAttribute('aria-valuetext', intervalLabel(minutes));
        if (!(await save(calendar.id, { refreshMinutes: minutes }))) {
          slider.setValue(intervals.indexOf(current().refreshMinutes));
          slider.sliderEl.setAttribute('aria-valuetext', intervalLabel(current().refreshMinutes));
        }
      });
    });
    if (
      plugin.app.secretStorage &&
      calendar.secretName &&
      !plugin.app.secretStorage.getSecret(calendar.secretName)
    )
      group.createEl('p', {
        text: `To refresh on this device, add the same subscription URL in Obsidian’s Secrets settings under “${calendar.secretName}”.`,
      });
    new Setting(group).setClass('ot-calendar-configure-actions').addButton((button) =>
      button
        .setButtonText('Done')
        .setCta()
        .onClick(() => this.close()),
    );
  }
  onClose() {
    this.plugin.calendarDialogs.delete(this);
    this.contentEl.empty();
    if (!this.plugin.calendar.disposed) this.changed();
  }
};
