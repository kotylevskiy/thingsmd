const { completionTime } = require('./logbook-groups.cjs');
const { isFinished } = require('../tasks/task-status.cjs');
const TaskEditor = require('../tasks/task-editor.cjs');
const InboxSession = require('../tasks/inbox-session.cjs');
const { taskIndicators, waitingIndicator } = require('../tasks/task-indicators.cjs');
const { ItemView, Notice, Platform, setIcon } = require('obsidian');
const { compareTasks, insertionOrder, inList } = require('../tasks/model.cjs');
const { taskState } = require('../tasks/task-presentation.cjs');
const { compareList, listInsertion } = require('./list-order.cjs');
const { VIEW, PAGES, resolveList } = require('./lists.cjs');
const { today } = require('../shared/local-date.cjs');
const { button, closePopover } = require('../shared/dom.cjs');
const { WriteQueue } = require('../shared/write-queue.cjs');
const { deferTouchRender } = require('../tasks/touch-tasks.cjs');
let taskLabelId = 0;
class ThingsMDView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.taskEditorController = new TaskEditor(plugin, this.contentEl, async (render) => {
      this.expanded = null;
      if (render) {
        await this.render();
        this.selectedRow()?.focus({ preventScroll: true });
      }
    });
    this.page = 'inbox';
    this.inboxSession = new InboxSession();
    // Allow normal file navigation to replace this view in the same tab.
    this.navigation = true;
    this.expanded = null;
    this.editing = false;
    this.busy = false;
    this.actionQueue = new WriteQueue();
    this.selected = null;
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return PAGES.find((item) => item[0] === this.page)?.[1] || 'ThingsMD';
  }
  getIcon() {
    return PAGES.find((item) => item[0] === this.page)?.[2] || 'circle-check';
  }
  getState() {
    return { page: this.page };
  }
  async setState(state, result) {
    state = { ...state, page: resolveList(state.page, this.plugin.settings) };
    if (state.page !== this.page) this.inboxSession.reset();
    this.page = state.page;
    await super.setState(state, result);
    await this.render();
  }
  async onOpen() {
    this.closed = false;
    const refresh = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.taskEditorController.refreshSettings();
        if (deferTouchRender(this.contentEl)) return;
        if (!this.editing && !this.busy && !this.dragging) this.render();
      }, 180);
    };
    for (const event of ['modify', 'create', 'delete', 'rename'])
      this.registerEvent(this.app.vault.on(event, refresh));
    this.registerEvent(this.app.workspace.on('thingsmd-tasks-changed', refresh));
    this.registerEvent(
      this.app.workspace.on('thingsmd-calendar-changed', () => {
        this.renderCalendars();
      }),
    );
    this.registerDomEvent(this.contentEl.ownerDocument, 'pointerdown', (e) => {
      if (e.target.closest('.ot-task,.ot-capture')) return;
      if (this.contentEl.contains(e.target) && !e.target.closest('button,a,input,textarea,select'))
        this.clearSelection();
      if (this.taskDraft) this.finishTask();
    });
    // Handle planner shortcuts before Obsidian's document-level keymap.
    this.registerDomEvent(
      this.contentEl.ownerDocument.defaultView,
      'keydown',
      (e) => {
        if (!this.contentEl.contains(e.target) || e.target.closest('.ot-project-link')) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (this.taskDraft && e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!closePopover(this.contentEl)) this.finishTask();
          return;
        }
        if (e.key === 'Escape' && this.selected) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.clearSelection();
          return;
        }
        if (e.target.closest('input,textarea,select,button,a,summary,.ot-date-picker')) return;
        if (['Enter', 'ArrowUp', 'ArrowDown', 'Backspace', 'Delete'].includes(e.key)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.listKey(e);
        }
      },
      true,
    );
    this.register(() => {
      clearTimeout(this.taskEditorController.saveTimer);
      clearTimeout(this.refreshTimer);
    });
    await this.render();
  }
  async onClose() {
    this.closed = true;
    this.inboxSession.reset();
    this.generation = (this.generation || 0) + 1;
    clearTimeout(this.refreshTimer);
    for (const row of this.contentEl.querySelectorAll('.ot-task')) row._otTouchDrag?.cancel();
    await this.taskEditorController.flushTaskDraft();
  }
  run(action) {
    // A refresh can expose the next list before the preceding action returns.
    // Queue subsequent clicks instead of silently discarding the user's action.
    return this.actionQueue.run('actions', async () => {
      this.busy = true;
      try {
        await action();
        // The user may have opened a draft while this action was saving.
        await this.render();
      } catch (error) {
        new Notice(error.message);
        console.error('ThingsMD:', error);
      } finally {
        this.busy = false;
      }
    });
  }
  async navigate(page) {
    page = resolveList(page, this.plugin.settings);
    if (this.taskDraft && !(await this.finishTask(false))) return;
    if (page !== this.page) {
      this.selected = null;
      this.inboxSession.reset();
    }
    this.page = page;
    this.expanded = null;
    this.leaf.updateHeader();
    this.plugin.mountListLinks();
    this.app.workspace.requestSaveLayout();
    await this.render();
  }
  async render() {
    clearTimeout(this.refreshTimer);
    if (this.closed || this.editing || deferTouchRender(this.contentEl) || this.dragging) return;
    // Obsidian's tab header and the ItemView title are separate surfaces.
    this.titleEl?.setText(this.getDisplayText());
    const generation = (this.generation = (this.generation || 0) + 1);
    const records = await this.plugin.records();
    if (
      this.closed ||
      generation !== this.generation ||
      this.editing ||
      deferTouchRender(this.contentEl) ||
      this.dragging
    )
      return;
    this.projects = records.filter((r) => r.meta.type === 'thingsmd-project');
    this.tasks = records.filter((r) => r.meta.type === 'thingsmd-task').sort(compareTasks);
    const progress = this.plugin.settings.showProjectProgress
      ? require('../tasks/project-progress.cjs').projectProgress(records)
      : new Map();
    const scroll = this.contentEl.querySelector('.ot-main')?.scrollTop || 0;
    this.contentEl.empty();
    this.contentEl.addClass('ot-root');
    const shell = this.contentEl.createDiv('ot-shell');
    const main = shell.createEl('main', { cls: 'ot-main' });
    const paper = main.createDiv('ot-paper');
    const matchesList = (t) =>
      inList(
        t,
        this.page,
        today(),
        this.plugin.settings.logbook,
        this.plugin.settings.captureDestination,
        this.plugin.settings.enableWaiting,
        this.plugin.settings.timeZone,
      );
    let active = this.tasks.filter(matchesList);
    if (this.page === 'repeating')
      active.sort((a, b) =>
        String(
          a.meta.repeat?.paused || a.meta.repeat?.waitingFor ? '9999' : a.meta.when || '9999',
        ).localeCompare(
          String(
            b.meta.repeat?.paused || b.meta.repeat?.waitingFor ? '9999' : b.meta.when || '9999',
          ),
        ),
      );
    // Logbook sections own completion ordering; Trash has no section adapter.
    if (this.page === 'trash')
      active.sort((a, b) =>
        String(b.meta.deletedAt || '').localeCompare(String(a.meta.deletedAt || '')),
      );
    const top = paper.createDiv('ot-list-heading');
    const headingIcon = top.createSpan({
      cls: 'ot-list-heading-icon is-' + this.page,
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(headingIcon, PAGES.find(([key]) => key === this.page)?.[2] || 'inbox');
    top.createEl('h1', { text: this.getDisplayText(), cls: 'inline-title' });
    require('./task-conflict-notice.cjs')(
      paper,
      require('../tasks/task-identity.cjs').conflictsMatching(this.tasks, matchesList),
      this.plugin,
    );
    if (this.page === 'today') paper.createEl('section', { cls: 'ot-calendar' });
    if (this.page === 'upcoming') paper.createDiv('ot-calendar-errors');
    require('./list-contents.cjs')(this, paper, active, progress);
    this.renderCalendars();
    if (['today', 'upcoming'].includes(this.page)) void this.plugin.calendar?.refreshAll();
    main.scrollTop = scroll;
  }
  renderCalendars() {
    if (!this.plugin.calendar || this.closed) return;
    const { renderCalendar, renderUpcomingCalendar } = require('../calendar/view.cjs');
    if (this.page === 'upcoming' && this.contentEl.querySelector('.ot-calendar-errors'))
      renderUpcomingCalendar(this.contentEl, this.plugin.calendar);
    else if (this.page === 'today') {
      const container = this.contentEl.querySelector('.ot-calendar');
      if (container) renderCalendar(container, this.plugin.calendar);
    }
  }
  group(parent, tasks, sectionId) {
    const group = parent.createDiv({
      cls: 'ot-group',
      attr: { 'data-group': sectionId || this.page },
    });
    const orderKey = this.page === 'upcoming' ? `upcoming:${sectionId}` : this.page;
    group.dataset.orderKey = orderKey;
    if (!['trash', 'logbook', 'repeating'].includes(this.page))
      tasks = [...tasks].sort(compareList(orderKey));
    for (const task of tasks) this.taskRow(group, task);
    if (['trash', 'logbook'].includes(this.page)) return;
    if (['anytime', 'repeating'].includes(this.page)) return;
    const capture = button(
      group,
      '+ New task',
      async () => {
        if (this.taskDraft && !(await this.finishTask())) return;
        this.plugin.capture({
          is_waiting: this.page === 'waiting' || sectionId === 'waiting',
          listOrder: { [orderKey]: listInsertion(tasks, orderKey, null) },
          project: ['someday', 'waiting'].includes(this.page) ? sectionId : null,
          when:
            this.page === 'upcoming'
              ? sectionId
              : sectionId === 'evening'
                ? 'evening'
                : ['today', 'someday'].includes(this.page)
                  ? this.page
                  : null,
          order: insertionOrder(tasks, null),
        });
      },
      'ot-capture',
    );
    {
      capture.addClass('ot-drop-end');
      capture.ondragover = (e) => {
        e.preventDefault();
        capture.addClass('is-over');
      };
      capture.ondragleave = () => capture.removeClass('is-over');
      capture.ondrop = (e) => {
        e.preventDefault();
        capture.removeClass('is-over');
        this.dropInGroup(e, group, null);
      };
    }
  }

  selectTask(id, occurrence = this.page) {
    this.selectedOccurrence = occurrence;
    this.selected = id;
    this.contentEl.querySelectorAll('.ot-task').forEach((row) => {
      const selected =
        row.dataset.taskId === id && row.dataset.occurrence === this.selectedOccurrence;
      row.toggleClass('is-selected', selected);
      row.setAttribute('aria-selected', String(selected));
    });
  }
  clearSelection() {
    const focused = this.contentEl.ownerDocument.activeElement;
    this.selectTask(null, null);
    if (this.contentEl.contains(focused) && focused.matches('.ot-task')) focused.blur();
  }
  selectedRow() {
    return (
      [...this.contentEl.querySelectorAll('.ot-task')].find(
        (row) =>
          row.dataset.taskId === this.selected &&
          row.dataset.occurrence === this.selectedOccurrence,
      ) || this.contentEl.querySelector(`[data-task-id="${this.selected}"]`)
    );
  }
  async openTask(id, occurrence = this.selectedOccurrence || this.page) {
    if (['trash', 'logbook'].includes(this.page)) return;
    if (this.taskDraft?.task.meta.id === id && this.expandedOccurrence === occurrence) return;
    if (this.taskDraft && !(await this.finishTask(false))) return;
    if (this.editing) return;
    this.selected = id;
    this.selectedOccurrence = occurrence;
    this.expandedOccurrence = occurrence;
    this.expanded = id;
    await this.render();
    const input = this.contentEl.querySelector('.ot-title-input');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
  taskRow(parent, task) {
    const occurrence = parent.closest('[data-date]')?.dataset.date || this.page;
    const expanded = this.expanded === task.meta.id && this.expandedOccurrence === occurrence;
    const labelId = `ot-list-task-label-${++taskLabelId}`;
    const row = parent.createDiv({
      cls: `ot-task ${isFinished(task.meta) ? 'is-done' : ''} ${expanded ? 'is-expanded' : ''} ${this.selected === task.meta.id && this.selectedOccurrence === occurrence ? 'is-selected' : ''}`,
      attr: {
        'data-task-id': task.meta.id,
        'data-occurrence': occurrence,
        tabindex: '0',
        role: 'option',
        // Obsidian turns aria-label into a tooltip; use the visible task title.
        'aria-labelledby': labelId,
        'aria-selected': String(
          this.selected === task.meta.id && this.selectedOccurrence === occurrence,
        ),
        'aria-expanded': String(expanded),
      },
    });
    require('./list-row-drag.cjs')(this, row, task, occurrence, expanded);
    row.onclick = async (e) => {
      if (e.target.closest('input,textarea,button,.ot-popover') || expanded || this.dragging)
        return;
      if (this.taskDraft && !(await this.finishTask())) return;
      if (this.editing) return;
      this.selectTask(task.meta.id, occurrence);
      row.focus({ preventScroll: true });
      if (Platform.isMobile || e.pointerType === 'touch') this.openTask(task.meta.id, occurrence);
    };
    row.ondblclick = (e) => {
      if (!e.target.closest('input,textarea,button')) this.openTask(task.meta.id, occurrence);
    };
    const line = row.createDiv('ot-task-line');
    const check = line.createEl('input', {
      attr: { type: 'checkbox', 'aria-labelledby': labelId },
    });
    check.checked = isFinished(task.meta);
    check.disabled = this.page === 'trash' || (!!task.meta.repeat && !task.meta.repeat.next);
    let cancelClick = false;
    check.onclick = (event) => {
      cancelClick = event.altKey;
    };
    check.onchange = async () => {
      const done = check.checked;
      const status = cancelClick ? 'canceled' : done ? 'done' : 'todo';
      if (this.taskDraft && !(await this.finishTask(false))) {
        check.checked = !done;
        return;
      }
      if (this.editing) {
        check.checked = !done;
        return;
      }
      const current = (await this.plugin.records()).find((t) => t.meta.id === task.meta.id);
      if (current)
        this.run(() =>
          this.plugin.patchTask(current, {
            status,
          }),
        );
    };
    taskState(row, task.meta);
    if (['trash', 'logbook'].includes(this.page)) {
      row.addClass('ot-archive-task');
      line.createSpan({
        text: task.meta.title || 'New task',
        cls: 'ot-task-title',
        attr: { id: labelId },
      });
      waitingIndicator(line, task.meta, this.page, this.plugin.settings.enableWaiting);
      const actions = line.createDiv('ot-archive-actions');
      const stamp = this.page === 'trash' ? task.meta.deletedAt : completionTime(task);
      actions.createSpan({
        cls: 'ot-archive-date',
        text:
          stamp != null && !Number.isNaN(new Date(stamp).getTime())
            ? new Date(stamp).toLocaleDateString('en', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                ...(this.page === 'logbook' ? { timeZone: this.plugin.settings.timeZone } : {}),
              })
            : '',
      });
      button(
        actions,
        'Restore',
        () => this.run(() => this.plugin.restoreTask(task, this.page === 'logbook')),
        'ot-restore',
      );
      return;
    }
    if (expanded) {
      this.taskEditorController.taskEditor(row, line, task);
      line.querySelector('.ot-title-input').id = labelId;
    } else {
      line.createSpan({
        text: task.meta.title || 'New task',
        cls: 'ot-task-title',
        attr: { id: labelId },
      });
      taskIndicators(line, task, this.page, this.plugin.settings.enableWaiting);
      const project = this.projects.find(
        (p) =>
          p.file.path === task.references?.[0] ||
          p.meta.id === task.meta.project ||
          p.file.path === task.meta.project,
      );
      if (!['anytime', 'someday', 'waiting', 'repeating'].includes(this.page) && project)
        row.createDiv({ cls: 'ot-project-badge', text: project.meta.title });
    }
  }
  get taskDraft() {
    return this.taskEditorController.taskDraft;
  }
  get editing() {
    return this.taskEditorController.editing;
  }
  set editing(value) {
    this.taskEditorController.editing = value;
  }
  taskControl(kind) {
    return this.taskEditorController.taskControl(kind);
  }
  finishTask(render = true) {
    return this.taskEditorController.finishTask(render);
  }
  async listKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.target.closest('input,textarea,select')) return;
    const rows = [...this.contentEl.querySelectorAll('.ot-task')];
    const index = rows.indexOf(e.target.closest('.ot-task') || this.selectedRow());
    if (
      ['Backspace', 'Delete'].includes(e.key) &&
      !mod &&
      !e.altKey &&
      e.target.matches('.ot-task')
    ) {
      e.preventDefault();
      if (this.page === 'trash') return;
      const task = this.tasks.find((t) => t.meta.id === e.target.dataset.taskId);
      if (task) await this.run(() => this.plugin.trashTask(task));
      return;
    }
    if (e.key === 'Enter' && this.selected) {
      e.preventDefault();
      this.openTask(this.selected);
    } else if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const next =
        rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        this.selectTask(next.dataset.taskId, next.dataset.occurrence);
        next.focus();
      }
    }
  }
  async reorderInGroup(id, group, targetId, after = false) {
    const ids = [...group.querySelectorAll(':scope > .ot-task')]
      .map((row) => row.dataset.taskId)
      .filter((other) => other !== id);
    if (targetId === id) return;
    const index = targetId ? ids.indexOf(targetId) + (after ? 1 : 0) : ids.length;
    const beforeId = ids[index] || null,
      key = group.dataset.orderKey;
    this.dragging = false;
    await this.run(async () => {
      const records = await this.plugin.taskRecords(),
        task = records.find((t) => t.meta.id === id);
      if (!task) return;
      const peers = records.filter((t) => ids.includes(t.meta.id));
      let rank;
      try {
        rank = listInsertion(peers, key, beforeId);
      } catch {
        // Legacy tasks can share the same rank; spread this group before inserting.
        const ordered = [...peers].sort(compareList(key));
        for (const [index, peer] of ordered.entries()) {
          const listOrder = { ...peer.meta.listOrder, [key]: (index + 1) * 1024 };
          await this.plugin.patchTask(peer, { listOrder });
          peer.meta = { ...peer.meta, listOrder };
        }
        rank = listInsertion(peers, key, beforeId);
      }
      await this.plugin.patchTask(task, { listOrder: { ...task.meta.listOrder, [key]: rank } });
    });
    this.selectedRow()?.focus({ preventScroll: true });
  }
  async dropInGroup(event, group, targetId, after = false) {
    const id = event.dataTransfer.getData('text/ot-task');
    if (!id) return;
    const occurrence = event.dataTransfer.getData('text/ot-occurrence');
    const date = group.closest('[data-date]')?.dataset.date;
    if (date && occurrence !== date) {
      this.dragging = false;
      // Dragging in ThingsMD changes When, including a deadline-only row.
      this.scheduleDrop(id, date);
      return;
    }
    if (![...group.querySelectorAll(':scope > .ot-task')].some((row) => row.dataset.taskId === id))
      return;
    await this.reorderInGroup(id, group, targetId, after);
  }
  dropOnList(id, page) {
    return this.run(() => this.plugin.dropTaskOnList({ id }, page));
  }

  scheduleDrop(id, date, kind = 'when') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const task = this.tasks.find((t) => t.meta.id === id);
    if (task) this.run(() => this.plugin.patchTask(task, { [kind]: date }));
  }
}

module.exports = ThingsMDView;
