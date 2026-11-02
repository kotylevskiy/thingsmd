const { Modal, Setting } = require('obsidian');
const { createCalendar } = require('./create.cjs');
const { quietLabel } = require('../shared/quiet-label.cjs');

module.exports = class CreateCalendarDialog extends Modal {
  constructor(plugin, created) {
    super(plugin.app);
    this.plugin = plugin;
    this.created = created;
  }
  onOpen() {
    this.plugin.calendarDialogs.add(this);
    this.setTitle('Add calendar');
    this.modalEl.addClass('ot-calendar-create');
    let url;
    new Setting(this.contentEl)
      .setName('Subscription URL')
      .setDesc('Paste an ICS or webcal link. The URL is stored securely on this device.')
      .addText((input) => {
        url = input;
        input.inputEl.type = 'password';
        input.inputEl.autocomplete = 'off';
        input.inputEl.spellcheck = false;
        quietLabel(input.inputEl, 'Subscription URL');
        input.setPlaceholder('https://… or webcal://…');
      });
    const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
    const submit = async () => {
      if (this.saving) return;
      this.saving = true;
      add.setDisabled(true).setButtonText('Checking calendar…');
      url.inputEl.readOnly = true;
      error.setText('');
      try {
        await createCalendar(
          this.plugin,
          { url: url.getValue() },
          { cancelled: () => this.cancelled },
        );
        this.close();
        this.created();
      } catch (failure) {
        if (!this.cancelled) error.setText(failure.message);
      } finally {
        this.saving = false;
        url.inputEl.readOnly = false;
        add.setDisabled(false).setButtonText('Add calendar');
      }
    };
    let add;
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((button) => {
        add = button;
        button.setButtonText('Add calendar').setCta().onClick(submit);
      });
    this.scope.register([], 'Enter', () => {
      if (url.inputEl.ownerDocument.activeElement !== url.inputEl) return true;
      void submit();
      return false;
    });
  }
  onClose() {
    this.plugin.calendarDialogs.delete(this);
    this.cancelled = true;
    this.contentEl.empty();
  }
};
