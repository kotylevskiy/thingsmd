const { setIcon } = require('obsidian');
const { button, iconButton, closePopover } = require('./dom.cjs');
const { today } = require('./local-date.cjs');
const { inEvening, isTodayWhen } = require('./model.cjs');
const { normalizeSchedule } = require('./task-schedule.cjs');
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
    const notes = editor.createEl('textarea', {
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
    const checklist = editor.createDiv('ot-checklist');
    const moveChecklist = (from, to) => {
      if (to < 0 || to >= draft.values.checklist.length || from === to) return;
      const [item] = draft.values.checklist.splice(from, 1);
      draft.values.checklist.splice(to, 0, item);
      this.queueTaskSave();
      renderChecklist();
      checklist.querySelectorAll('input:not([type=checkbox])')[to]?.focus();
    };
    const renderChecklist = () => {
      checklist.empty();
      for (const [index, item] of draft.values.checklist.entries()) {
        const itemRow = checklist.createDiv('ot-checklist-row');
        const check = itemRow.createEl('input', {
          attr: { type: 'checkbox', 'aria-label': `Checklist item ${index + 1}` },
        });
        check.checked = !!item.done;
        check.disabled = !!task.meta.repeat;
        const text = itemRow.createEl('input', {
          attr: { 'aria-label': `Checklist text ${index + 1}`, placeholder: 'Checklist' },
        });
        text.value = item.text;
        check.onchange = () => {
          item.done = check.checked;
          this.queueTaskSave();
        };
        text.oninput = () => {
          item.text = text.value;
          this.queueTaskSave();
        };
        text.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            draft.values.checklist.splice(index + 1, 0, { text: '', done: false });
            this.queueTaskSave();
            renderChecklist();
            checklist.querySelectorAll('input[type=text],input:not([type])')[index + 1]?.focus();
          }
          if (e.key === 'Backspace' && !text.value) {
            e.preventDefault();
            draft.values.checklist.splice(index, 1);
            this.queueTaskSave();
            renderChecklist();
            (
              checklist.querySelectorAll('input:not([type=checkbox])')[Math.max(0, index - 1)] ||
              title
            ).focus();
          }
        };
        const grip = iconButton(
          itemRow,
          'Reorder checklist item ' + (index + 1),
          'grip-horizontal',
          () => {},
        );
        grip.addClass('ot-checklist-grip');
        grip.onkeydown = (e) => {
          if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            moveChecklist(index, index + (e.key === 'ArrowDown' ? 1 : -1));
          }
        };
        grip.onpointerdown = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          this.cancelChecklistDrag?.();
          const win = row.ownerDocument.defaultView,
            controller = new AbortController();
          let destination = index;
          const clean = () => {
            controller.abort();
            checklist
              .querySelectorAll('.is-checklist-target')
              .forEach((el) => el.removeClass('is-checklist-target'));
          };
          this.cancelChecklistDrag = clean;
          win.addEventListener(
            'pointermove',
            (event) => {
              const rows = [...checklist.children];
              destination = rows.findIndex(
                (el) => event.clientY < el.getBoundingClientRect().bottom,
              );
              if (destination < 0) destination = rows.length - 1;
              rows.forEach((el, i) =>
                el.toggleClass('is-checklist-target', i === destination && i !== index),
              );
            },
            { signal: controller.signal },
          );
          win.addEventListener(
            'pointerup',
            () => {
              clean();
              moveChecklist(index, destination);
            },
            { signal: controller.signal },
          );
          win.addEventListener('pointercancel', clean, { signal: controller.signal });
          win.addEventListener('blur', clean, { signal: controller.signal });
          win.addEventListener(
            'keydown',
            (event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                clean();
              }
            },
            { capture: true, signal: controller.signal },
          );
        };
      }
    };
    renderChecklist();
    if (task.meta.repeat) {
      const rule = button(
        editor,
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
        editor,
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
    iconButton(icons, 'Checklist', 'list-checks', () => {
      draft.values.checklist.push({ text: '', done: false });
      this.queueTaskSave();
      renderChecklist();
      Array.from(checklist.querySelectorAll('input:not([type=checkbox])')).at(-1)?.focus();
    });
    if (!task.meta.repeat)
      iconButton(icons, 'Deadline', 'flag', () => this.taskControl('deadline'));
    const waiting = iconButton(icons, 'Waiting For', 'send-horizontal', () => {
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
      existing.remove();
      return;
    }
    existing?.remove();
    const pop = row.createDiv({
      cls: 'ot-popover',
      attr: { 'data-kind': kind, role: 'dialog', 'aria-label': kind },
    });
    const change = (key, value) => {
      if (key === 'when') {
        Object.assign(
          draft.values,
          normalizeSchedule({ when: value === null ? 'anytime' : value }),
        );
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
        if (saved && draft.values.when === values.when) draft.values.when = saved.meta.when || null;
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
    if (!this.taskDraft) return true;
    if (!(await this.flushTaskDraft())) return false;
    this.cancelChecklistDrag?.();
    this.taskDraft = null;
    this.editing = false;
    await this.afterClose(render);
    return true;
  }
}
module.exports = TaskEditor;
