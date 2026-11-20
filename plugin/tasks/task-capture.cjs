const { Modal } = require('obsidian');
const TaskEditor = require('./task-editor.cjs');
const { inInbox } = require('./model.cjs');
const { button, removeModalCloseButton, closePopover } = require('../shared/dom.cjs');
class TaskCapture extends Modal {
  constructor(plugin, fields, body) {
    super(plugin.app);
    // The host's first-input focus picks the completion checkbox. Capture owns
    // initial focus so a quick Enter always reaches the title's save handler.
    this.hasInitialInputFocus = false;
    this.plugin = plugin;
    this.fields = { project: null, order: Date.now(), ...fields };
    this.body = body;
    this.returnFocus = document.activeElement;
    const view = this.app.workspace.activeLeaf?.view;
    if (view?.page === 'inbox' && !this.fields.is_waiting && inInbox({ meta: this.fields })) {
      this.inboxView = view;
      this.inboxVisit = view.inboxSession?.seen;
    }
  }
  open() {
    super.open();
    // Modal.open may apply its default first-input focus after onOpen returns.
    this.contentEl.querySelector('.ot-title-input')?.focus();
  }
  onOpen() {
    this.modalEl.addClass('ot-capture-modal');
    removeModalCloseButton(this.modalEl);
    this.contentEl.addClass('ot-root');
    this.modalEl.setAttribute('aria-label', 'New task');
    // Obsidian normally closes modals from backdrop mouse/touch handlers.
    // Intercept only this capture's backdrop before those handlers run.
    this.captureEvents = new AbortController();
    const container = this.containerEl || this.modalEl.parentElement;
    container.addClass('ot-capture-container');
    const win = this.contentEl.ownerDocument.defaultView;
    const viewport = win.visualViewport;
    // iOS can shrink/pan only the visible viewport when its keyboard opens.
    // Keep the entire capture, including its fixed controls, inside that area.
    const resize = () => {
      container.style.setProperty('--ot-capture-top', `${viewport?.offsetTop || 0}px`);
      container.style.setProperty(
        '--ot-capture-height',
        `${viewport?.height || win.innerHeight}px`,
      );
    };
    resize();
    for (const type of ['resize', 'scroll'])
      viewport?.addEventListener(type, resize, { signal: this.captureEvents.signal });
    win.addEventListener('resize', resize, { signal: this.captureEvents.signal });
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'])
      container.addEventListener(
        type,
        (event) => {
          if (this.modalEl.contains(event.target)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        { capture: true, passive: false, signal: this.captureEvents.signal },
      );
    const row = this.contentEl.createDiv('ot-task is-expanded');
    const line = row.createDiv('ot-task-line');
    const check = line.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Completed' } });
    const card = (this.card = new TaskEditor(this.plugin, this.contentEl));
    card.queueTaskSave = () => {
      card.taskDraft.dirty = true;
    };
    card.finishTask = () => this.save();
    if (this.body !== undefined)
      card.setCaptureDescription = (body) => {
        this.body = body;
      };
    card.openNotes = async (task, newTab = false) => {
      if ((await this.save({ forNotes: true })) && this.createdTask)
        await this.plugin.openTaskNotes(this.createdTask, newTab);
    };
    card.openRepeat = async () => {
      if ((await this.save()) && this.createdTask)
        await this.plugin.showRepeat(this.createdTask.meta.id);
    };
    card.taskEditor(row, line, { meta: { title: '', ...this.fields }, body: this.body ?? '' });
    line.querySelector('.ot-title-input').setAttribute('enterkeyhint', 'done');
    this.scope.register([], 'Enter', (event) => {
      if (
        event.isComposing ||
        this.contentEl.ownerDocument.activeElement !== line.querySelector('.ot-title-input')
      )
        return;
      this.save();
      return false;
    });
    this.scope.register([], 'Escape', (event) => this.onEscapeKey(event));
    this.scope.register(['Mod'], 'Enter', () => {
      this.save();
      return false;
    });
    const taskKeydown = row.onkeydown;
    row.onkeydown = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        this.onEscapeKey(event);
      } else taskKeydown(event);
    };
    const actions = this.contentEl.createDiv('ot-capture-actions');
    actions.createSpan({ cls: 'ot-capture-hint', text: 'Tab to edit description' });
    button(actions, 'Cancel', () => this.close());
    button(actions, 'Save', () => this.save(), 'mod-cta');
    check.onchange = () => {
      this.completed = check.checked;
    };
    // Lower phone capture by its initial title area, to the former Notes position.
    container.style.setProperty(
      '--ot-capture-notes-offset',
      `${row.querySelector('.ot-task-notes-preview').getBoundingClientRect().top - this.modalEl.getBoundingClientRect().top}px`,
    );
    line.querySelector('.ot-title-input').focus();
  }
  onEscapeKey(event) {
    // Obsidian registers its own Escape binding before custom scope bindings.
    // Override that entry point and consume the event once, before it bubbles.
    event?.preventDefault();
    event?.stopPropagation();
    if (!closePopover(this.contentEl)) this.close();
    return false;
  }
  close() {
    if (this.saving) return this.saving;
    super.close();
    return true;
  }
  async save({ forNotes = false } = {}) {
    if (this.saving) return this.saving;
    const draft = this.card?.taskDraft;
    if (!draft) {
      super.close();
      return true;
    }
    const values = JSON.parse(JSON.stringify(draft.values));
    const body = this.body ?? '';
    const hasContent =
      values.title.trim() || body.trim() || values.checklist.some((item) => item.text.trim());
    if (!hasContent && !forNotes) {
      super.close();
      return true;
    }
    this.saving = (async () => {
      try {
        // Keep the capture draft local until it closes, and create the complete
        // Markdown task in one write. Opening notes explicitly creates its file.
        for (const input of this.contentEl.querySelectorAll('input,textarea,button'))
          input.disabled = true;
        const destination =
          this.fields.project || (await this.plugin.captureDestination(this.fields));
        const fields = {
          ...this.fields,
          ...values,
          title: values.title.trim(),
          status: this.completed ? 'done' : 'todo',
          ...(destination ? { project: destination } : {}),
        };
        // Retain the task on placement failure; retry must never duplicate it.
        if (this.createdTask)
          this.createdTask = await this.plugin.patchTask(
            this.createdTask,
            fields,
            body === this.createdTask.body ? undefined : body,
          );
        else this.createdTask = await this.plugin.createTask(fields, undefined, body);
        if (destination) {
          await this.plugin.transferTask({ id: this.createdTask.meta.id, destination });
          this.createdTask =
            (await this.plugin.taskRecords()).find((t) => t.meta.id === this.createdTask.meta.id) ||
            this.createdTask;
        }
        super.close();
        const view = this.app.workspace.activeLeaf?.view;
        if (view?.getViewType() === 'thingsmd-project-view') {
          if (
            view === this.inboxView &&
            view.page === 'inbox' &&
            this.inboxVisit === view.inboxSession?.seen
          )
            this.inboxVisit?.add(this.createdTask.meta.id);
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
    this.captureEvents?.abort();
    this.card?.cancelChecklistDrag?.();
    this.contentEl.empty();
    this.plugin.captureModal = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }
}

module.exports = TaskCapture;
