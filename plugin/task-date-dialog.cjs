const { Modal, setIcon } = require('obsidian');
const { datePicker } = require('./date-picker.cjs');
const { removeModalCloseButton } = require('./dom.cjs');
const { inEvening } = require('./model.cjs');
const { today } = require('./local-date.cjs');

// Context menus use the same calendar as task forms. Keep the opening snapshot
// so storage rejects conflicting external changes while the calendar is open.
module.exports = class TaskDateDialog extends Modal {
  constructor(plugin, task, kind) {
    super(plugin.app);
    this.hasInitialInputFocus = false;
    this.plugin = plugin;
    this.task = task;
    this.kind = kind;
  }
  onOpen() {
    this.modalEl.addClass('ot-task-date-modal');
    this.modalEl.setAttribute('aria-label', this.kind === 'when' ? 'When' : 'Deadline');
    removeModalCloseButton(this.modalEl);
    this.picker = this.contentEl.createDiv();
    const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
    datePicker(this.picker, {
      kind: this.kind,
      value:
        this.kind === 'when' && inEvening(this.task.meta, today())
          ? 'evening'
          : this.task.meta[this.kind],
      inline: true,
      setIcon,
      onClose: () => {
        if (!this.closed) this.close();
      },
      onSelect: async (value) => {
        if (this.busy || this.closed) return;
        this.busy = true;
        error.textContent = '';
        this.contentEl.setAttribute('aria-busy', 'true');
        try {
          await this.plugin.patchTask(this.task, {
            [this.kind]: this.kind === 'when' && value === null ? 'anytime' : value,
          });
          if (!this.closed) this.close();
        } catch (failure) {
          if (!this.closed) error.textContent = failure.message;
        } finally {
          this.busy = false;
          this.contentEl.setAttribute('aria-busy', 'false');
        }
      },
    });
  }
  onClose() {
    this.closed = true;
    this.picker?.close(false);
    this.contentEl.empty();
  }
};
