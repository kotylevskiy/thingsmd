const { setIcon } = require('obsidian');
const { button, iconButton, closePopover } = require('./dom.cjs');
const { today } = require('./local-date.cjs');
const { inEvening, isTodayWhen } = require('./model.cjs');
const { applySchedulePolicy } = require('./task-schedule.cjs');
const { taskState } = require('./task-presentation.cjs');

// Hosts supply a container and a close hook. Draft editing and persistence are
// identical in lists, native Markdown cards, and capture dialogs.
class TaskEditor {
  constructor(plugin, contentEl, afterClose = async () => {}) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.contentEl = contentEl;
    this.afterClose = afterClose;
    this.taskDraft = null;
    this.editing = false;
  }
  refreshSettings() {
    for (const button of this.contentEl.querySelectorAll('.ot-waiting-toggle'))
      button.hidden = this.plugin.settings?.enableWaiting === false;
  }
  taskEditor(row, line, task) {
    taskState(row, task.meta);
    this.editing = true;
    const draft = (this.taskDraft = {
      task,
      values: {
        title: task.meta.title ?? '',
        is_waiting: task.meta.is_waiting === true,
        when: task.meta.when || null,
        evening: task.meta.evening || null,
        deadline: task.meta.deadline || null,
        deadlineDeferredOn: task.meta.deadlineDeferredOn || null,
        checklist: JSON.parse(JSON.stringify(task.meta.checklist || [])),
      },
      body: task.body,
      dirty: false,
      error: null,
    });
    const title = line.createEl('input', {
      cls: 'ot-title-input',
      attr: { 'aria-label': 'Task title', placeholder: 'New To-Do' },
    });
    title.value = draft.values.title;
    const editor = row.createDiv('ot-task-editor');
    const fields = editor.createDiv('ot-task-fields');
    const notes = fields.createEl('textarea', {
      cls: 'ot-task-notes',
      attr: { 'aria-label': 'Task notes', placeholder: 'Notes', rows: '1' },
    });
    notes.value = task.body;
    const size = () => {
      notes.style.height = 'auto';
      notes.style.height = `${Math.max(30, notes.scrollHeight)}px`;
    };
    requestAnimationFrame(size);
    title.oninput = () => {
      draft.values.title = title.value;
      this.queueTaskSave();
    };
    notes.oninput = () => {
      draft.body = notes.value;
      size();
      this.queueTaskSave();
    };
    const checklist = require('./checklist-editor.cjs')(fields, draft.values.checklist, {
      disabled: !!task.meta.repeat,
      onChange: () => this.queueTaskSave(),
      fallbackFocus: title,
    });
    this.cancelChecklistDrag = checklist.cancelDrag;
    if (task.meta.repeat) {
      const rule = button(
        fields,
        require('./repeat-model.cjs').summary(task.meta.repeat),
        async (event) => {
          if (!(await this.finishTask())) return;
          this.plugin.repeatMenu(task.meta.id, event);
        },
        'ot-repeat-rule',
      );
      rule.setAttribute('aria-label', 'Repeating rule');
    } else if (task.meta.repeatSource) {
      button(
        fields,
        'This is a copy of a repeating to-do',
        async () => {
          if (!(await this.finishTask())) return;
          this.plugin.showRepeatingTask(task.meta.repeatSource);
        },
        'ot-repeat-source',
      );
    }
    const footer = editor.createDiv('ot-card-footer');
    const badges = footer.createDiv('ot-card-badges');
    const icons = footer.createDiv('ot-card-icons');
    const drawBadges = () => {
      badges.empty();
      if (draft.values.when)
        button(
          badges,
          inEvening(draft.values, today())
            ? 'This Evening'
            : isTodayWhen(draft.values.when, today())
              ? '★ Today'
              : draft.values.when === 'someday'
                ? 'Someday'
                : draft.values.when === 'anytime'
                  ? 'Anytime'
                  : draft.values.when,
          () => this.taskControl('when'),
          'ot-chip',
        );
      if (draft.values.deadline)
        button(badges, `⚑ ${draft.values.deadline}`, () => this.taskControl('deadline'), 'ot-chip');
    };
    draft.drawBadges = drawBadges;
    drawBadges();
    iconButton(icons, 'When', 'calendar-days', () => this.taskControl('when'));
    iconButton(icons, 'Checklist', 'list-checks', () => checklist.add());
    if (!task.meta.repeat)
      iconButton(icons, 'Deadline', 'flag', () => this.taskControl('deadline'));
    const waiting = iconButton(icons, 'Waiting For', 'send-horizontal', () => {
      if (this.plugin.settings?.enableWaiting === false) return;
      draft.values.is_waiting = !draft.values.is_waiting;
      drawWaiting();
      this.queueTaskSave();
      taskState(row, { ...draft.task.meta, ...draft.values });
    });
    waiting.addClass('ot-waiting-toggle');
    const drawWaiting = () => {
      waiting.setAttribute('aria-pressed', String(draft.values.is_waiting));
      waiting.setAttribute('aria-label', 'Waiting For');
      waiting.setAttribute('title', draft.values.is_waiting ? 'Stop waiting' : 'Mark as waiting');
    };
    drawWaiting();
    this.refreshSettings();
    if (!task.meta.repeatSource) iconButton(icons, 'Repeat', 'repeat', () => this.openRepeat());
    if (task.meta.id) iconButton(icons, 'Move', 'arrow-right', () => this.plugin.openTaskMove(row));
    row.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!closePopover(row)) this.finishTask();
      } else if (
        e.key === 'Enter' &&
        e.target === title &&
        !e.isComposing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.finishTask();
      }
    };
  }
  async openRepeat() {
    const id = this.taskDraft?.task.meta.id;
    if (!id || !(await this.finishTask())) return;
    await this.plugin.showRepeat(id);
  }
  taskControl(kind) {
    const draft = this.taskDraft;
    if (!draft) return;
    const row = this.contentEl.querySelector('.ot-task.is-expanded');
    if (!row) return;
    const existing = row.querySelector('.ot-popover');
    if (existing?.dataset.kind === kind) {
      closePopover(row);
      return;
    }
    closePopover(row);
    const pop = row.createDiv({
      cls: 'ot-popover',
      attr: { 'data-kind': kind, role: 'dialog', 'aria-label': kind },
    });
    const change = (key, value) => {
      if (key === 'when') {
        Object.assign(
          draft.values,
          applySchedulePolicy(draft.values, { when: value === null ? 'anytime' : value }),
        );
      } else if (key === 'deadline') {
        Object.assign(draft.values, applySchedulePolicy(draft.values, { deadline: value }));
      } else draft.values[key] = value;
      this.queueTaskSave();
      draft.drawBadges();
      taskState(row, { ...draft.task.meta, ...draft.values });
    };
    if (kind === 'when' || kind === 'deadline') {
      require('./date-picker.cjs').datePicker(pop, {
        kind,
        value: kind === 'when' && inEvening(draft.values, today()) ? 'evening' : draft.values[kind],
        onSelect: (value) => change(kind, value),
        setIcon,
        anchor: row.querySelector(`button[aria-label="${kind === 'when' ? 'When' : 'Deadline'}"]`),
      });
    }
  }
  queueTaskSave() {
    if (!this.taskDraft) return;
    this.taskDraft.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveTaskDraft(), 350);
  }
  async saveTaskDraft() {
    clearTimeout(this.saveTimer);
    if (this.taskSave) await this.taskSave;
    const draft = this.taskDraft;
    if (!draft || !draft.dirty) return !draft?.error;
    const values = JSON.parse(JSON.stringify(draft.values));
    values.title = values.title.trim();
    const body = draft.body;
    const patch = {};
    for (const [key, value] of Object.entries(values))
      if (
        JSON.stringify(value) !==
        JSON.stringify(
          draft.task.meta[key] ?? (key === 'is_waiting' ? false : Array.isArray(value) ? [] : null),
        )
      )
        patch[key] = value;
    const changedBody = body !== draft.task.body ? body : undefined;
    draft.dirty = false;
    const saving = (async () => {
      try {
        const saved =
          Object.keys(patch).length || changedBody !== undefined
            ? await this.plugin.patchTask(draft.task, patch, changedBody)
            : null;
        draft.task = saved || { ...draft.task, meta: { ...draft.task.meta, ...patch }, body };
        const schedule = ['when', 'evening', 'deadline', 'deadlineDeferredOn'];
        if (saved && schedule.every((key) => draft.values[key] === values[key])) {
          // Cancellation and scheduling policy may change several linked fields.
          // Reconcile them together without replacing edits received during I/O.
          for (const key of schedule) draft.values[key] = saved.meta[key] ?? null;
          draft.drawBadges?.();
        }
        draft.error = null;
        this.contentEl.querySelector('.ot-save-error')?.remove();
        return true;
      } catch (error) {
        draft.dirty = true;
        draft.error = error.message;
        const row = this.contentEl.querySelector('.ot-task.is-expanded');
        if (row && !row.querySelector('.ot-save-error')) {
          const message = row.createDiv({ cls: 'ot-save-error', attr: { role: 'alert' } });
          message.createSpan({ text: error.message });
          button(message, 'Reload task', () => {
            clearTimeout(this.saveTimer);
            this.cancelChecklistDrag?.();
            this.taskDraft = null;
            this.editing = false;
            this.afterClose(true);
          });
        }
        return false;
      }
    })();
    this.taskSave = saving;
    try {
      return await saving;
    } finally {
      if (this.taskSave === saving) this.taskSave = null;
    }
  }
  async flushTaskDraft() {
    // Closing must drain every edit received during I/O, not just one retry.
    do {
      if (!(await this.saveTaskDraft())) return false;
    } while (this.taskDraft?.dirty);
    return true;
  }
  async finishTask(render = true) {
    if (this.taskFinish) return this.taskFinish;
    if (!this.taskDraft) return true;
    // Blur, Enter and navigation can request a close during the same write.
    // Drain once and publish the saved task to the host exactly once.
    const closing = (async () => {
      if (!(await this.flushTaskDraft())) return false;
      this.cancelChecklistDrag?.();
      const task = this.taskDraft.task;
      this.taskDraft = null;
      this.editing = false;
      await this.afterClose(render, task);
      return true;
    })();
    this.taskFinish = closing;
    try {
      return await closing;
    } finally {
      if (this.taskFinish === closing) this.taskFinish = null;
    }
  }
}
module.exports = TaskEditor;
