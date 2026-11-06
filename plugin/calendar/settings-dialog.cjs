const { Modal, Setting, Notice } = require('obsidian');
const { defaultColor } = require('./color.cjs');
const { colorSwatches } = require('./color-swatches.cjs');
const { quietLabel } = require('../shared/quiet-label.cjs');
const { saveSubscription, SubscriptionMismatch } = require('./subscription.cjs');
const CalendarSourceWarningDialog = require('./source-warning-dialog.cjs');

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
    if (plugin.app.secretStorage && calendar.secretName) {
      const hasSecret = !!plugin.app.secretStorage.getSecret(calendar.secretName);
      let url, apply, change, cancel;
      const subscription = new Setting(group)
        .setName('Subscription URL')
        .setClass('ot-calendar-subscription-setting')
        .setDesc(
          hasSecret
            ? 'The subscription URL is saved securely on this device.'
            : 'Paste the same ICS or webcal link to refresh this calendar on this device.',
        );
      subscription.addText((input) => {
        url = input;
        input.inputEl.type = 'password';
        input.inputEl.autocomplete = 'off';
        input.inputEl.spellcheck = false;
        quietLabel(input.inputEl, 'Subscription URL');
        input.setPlaceholder('https://… or webcal://…');
        input.onChange((value) => {
          apply.setDisabled(!value.trim());
          error.empty();
          this.warningDialog?.close();
        });
      });
      const error = group.createDiv({ attr: { role: 'alert' } });
      const setEditing = (editing) => {
        const saved = !!plugin.app.secretStorage.getSecret(calendar.secretName);
        url.inputEl.style.display = editing ? '' : 'none';
        apply.buttonEl.style.display = editing ? '' : 'none';
        change.buttonEl.style.display = editing ? 'none' : '';
        cancel.buttonEl.style.display = editing && saved ? '' : 'none';
        subscription.setDesc(
          saved
            ? editing
              ? 'Paste a URL to replace the subscription saved on this device.'
              : 'The subscription URL is saved securely on this device.'
            : 'Paste the same ICS or webcal link to refresh this calendar on this device.',
        );
        url.setValue('');
        apply.setDisabled(true);
        error.empty();
      };
      const submit = async (options = {}) => {
        if (this.saving || !url.getValue().trim()) return;
        this.saving = true;
        apply.setDisabled(true).setButtonText('Checking calendar…');
        url.inputEl.readOnly = true;
        error.setText('');
        const candidateUrl = url.getValue();
        let replacement;
        try {
          await saveSubscription(plugin, calendar, candidateUrl, {
            ...options,
            cancelled: () => this.cancelled,
          });
          if (!this.cancelled) {
            setEditing(false);
            change.buttonEl.focus({ preventScroll: true });
          }
        } catch (failure) {
          if (!this.cancelled && failure instanceof SubscriptionMismatch) {
            const warning = (this.warningDialog = new CalendarSourceWarningDialog(
              plugin,
              current().name,
              failure.calendarName,
            ));
            warning.open();
            if (await warning.result) replacement = { replace: true, expected: failure.expected };
            this.warningDialog = undefined;
          } else if (!this.cancelled) error.setText(failure.message);
        } finally {
          this.saving = false;
          url.inputEl.readOnly = false;
          apply.setButtonText('Save URL').setDisabled(!url.getValue().trim());
        }
        if (replacement && !this.cancelled && url.getValue() === candidateUrl)
          await submit(replacement);
      };
      subscription.addButton((button) => {
        apply = button;
        button
          .setButtonText('Save URL')
          .setDisabled(true)
          .onClick(() => submit());
      });
      subscription.addButton((button) => {
        change = button;
        button.setButtonText('Change URL').onClick(() => {
          setEditing(true);
          url.inputEl.focus();
        });
      });
      subscription.addButton((button) => {
        cancel = button;
        button.setButtonText('Cancel').onClick(() => {
          if (this.saving) return;
          setEditing(false);
          change.buttonEl.focus({ preventScroll: true });
        });
      });
      setEditing(!hasSecret);
      this.scope.register([], 'Enter', () => {
        if (url.inputEl.ownerDocument.activeElement !== url.inputEl) return true;
        void submit();
        return false;
      });
    }
    new Setting(group).setClass('ot-calendar-configure-actions').addButton((button) =>
      button
        .setButtonText('Done')
        .setCta()
        .onClick(() => this.close()),
    );
  }
  onClose() {
    this.cancelled = true;
    this.warningDialog?.close();
    this.plugin.calendarDialogs.delete(this);
    this.contentEl.empty();
    if (!this.plugin.calendar.disposed) this.changed();
  }
};
