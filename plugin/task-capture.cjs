const { Modal } = require('obsidian');
const TaskEditor = require('./task-editor.cjs');
class TaskCapture extends Modal {
  constructor(plugin, fields) {
    super(plugin.app);
    this.plugin = plugin;
    this.fields = { project: null, order: Date.now(), ...fields };
    this.returnFocus = document.activeElement;
  }
  onOpen() {
    this.modalEl.addClass('ot-capture-modal');
    this.contentEl.addClass('ot-root');
    this.modalEl.setAttribute('aria-label', 'New task');
    const row = this.contentEl.createDiv('ot-task is-expanded');
    const line = row.createDiv('ot-task-line');
    const check = line.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Completed' } });
    const card = (this.card = new TaskEditor(this.plugin, this.contentEl));
    card.queueTaskSave = () => {
      card.taskDraft.dirty = true;
    };
    card.finishTask = () => this.close();
    card.openRepeat = async () => {
      if ((await this.close()) && this.createdTask)
        await this.plugin.showRepeat(this.createdTask.meta.id);
    };
    card.taskEditor(row, line, { meta: { title: '', ...this.fields }, body: '' });
    this.scope.register([], 'Enter', (event) => {
      if (
        event.isComposing ||
        this.contentEl.ownerDocument.activeElement !== line.querySelector('.ot-title-input')
      )
        return;
      this.close();
      return false;
    });
    this.scope.register([], 'Escape', () => {
      const pop = this.contentEl.querySelector('.ot-popover');
      if (pop) {
        if (pop.close) pop.close();
        else pop.remove();
      } else this.close();
      return false;
    });
    check.onchange = () => {
      this.completed = check.checked;
    };
    queueMicrotask(() => line.querySelector('.ot-title-input')?.focus());
  }
  async close() {
    if (this.saving) return this.saving;
    const draft = this.card?.taskDraft;
    if (!draft) {
      super.close();
      return true;
    }
    const values = JSON.parse(JSON.stringify(draft.values));
    const hasContent =
      values.title.trim() || draft.body.trim() || values.checklist.some((item) => item.text.trim());
    if (!hasContent) {
      super.close();
      return true;
    }
    this.saving = (async () => {
      try {
        // Keep the capture draft local until it closes, and create the complete
        // Markdown task in one write. Empty captures never leave blank files.
        for (const input of this.contentEl.querySelectorAll('input,textarea,button'))
          input.disabled = true;
        const destination =
          this.fields.project || (await this.plugin.captureDestination(this.fields));
        const fields = {
          ...this.fields,
          ...values,
          title: values.title.trim() || 'New task',
          status: this.completed ? 'done' : 'todo',
          ...(destination ? { project: destination } : {}),
        };
        // Retain the task on placement failure; retry must never duplicate it.
        if (this.createdTask)
          this.createdTask = await this.plugin.patchTask(this.createdTask, fields, draft.body);
        else this.createdTask = await this.plugin.createTask(fields, undefined, draft.body);
        if (destination) {
          await this.plugin.transferTask({ id: this.createdTask.meta.id, destination });
          this.createdTask =
            (await this.plugin.taskRecords()).find((t) => t.meta.id === this.createdTask.meta.id) ||
            this.createdTask;
          const view = this.app.workspace
            .getLeavesOfType('markdown')
            .find((l) => l.view.file?.path === destination && l.view.getMode() === 'source')?.view;
          await view?.save();
        }
        super.close();
        const view = this.app.workspace.activeLeaf?.view;
        if (view?.getViewType() === 'things-project-view') {
          await view.render();
          const row = [...view.contentEl.querySelectorAll('.ot-task')].find(
            (r) => r.dataset.taskId === this.createdTask.meta.id,
          );
          if (row) {
            view.selectTask(row.dataset.taskId, row.dataset.occurrence);
            row.focus();
          }
        }
        return true;
      } catch (error) {
        for (const input of this.contentEl.querySelectorAll('input,textarea,button'))
          input.disabled = false;
        this.contentEl.querySelector('.ot-save-error')?.remove();
        this.contentEl.createDiv({
          cls: 'ot-save-error',
          text: error.message,
          attr: { role: 'alert' },
        });
        return false;
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }
  onClose() {
    this.card?.cancelChecklistDrag?.();
    this.contentEl.empty();
    this.plugin.captureModal = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }
}

module.exports = TaskCapture;
