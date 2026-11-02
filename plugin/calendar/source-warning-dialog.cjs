const { Modal, Setting } = require('obsidian');
const destructiveButton = require('../shared/destructive-button.cjs');

module.exports = class CalendarSourceWarningDialog extends Modal {
  constructor(plugin, calendarName, linkedName) {
    super(plugin.app);
    Object.assign(this, { plugin, calendarName, linkedName });
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
  onOpen() {
    this.plugin.calendarDialogs.add(this);
    this.setTitle('Check calendar subscription');
    this.modalEl.addClass('ot-calendar-source-warning');
    this.contentEl.createEl('p', {
      text: `This link could not be verified as “${this.calendarName}”. The linked calendar is named “${this.linkedName}”. Check that you copied the correct subscription URL.`,
    });
    this.contentEl.createEl('p', {
      text: 'Replacing the source keeps this calendar’s settings and switches its events across synced devices. Other devices may need the new subscription URL.',
    });
    new Setting(this.contentEl)
      .setClass('ot-calendar-configure-actions')
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => this.close());
        button.buttonEl.focus();
      })
      .addButton((button) =>
        destructiveButton(button)
          .setButtonText('Save link')
          .onClick(() => {
            if (this.closed) return;
            this.replace = true;
            this.close();
          }),
      );
  }
  onClose() {
    this.closed = true;
    this.plugin.calendarDialogs.delete(this);
    this.contentEl.empty();
    this.resolve(this.replace === true);
  }
};
