const TaskEditor = require('./task-editor.cjs');
const { taskIndicators } = require('./task-indicators.cjs');
const { ItemView, Notice, Platform, setIcon } = require('obsidian');
const {
  compareTasks,
  insertionOrder,
  inList,
  upcomingDates,
  upcomingDays,
  inEvening,
} = require('./model.cjs');
const { taskState } = require('./task-presentation.cjs');
const { compareList, listInsertion } = require('./list-order.cjs');
const { VIEW, PAGES } = require('./lists.cjs');
const { today, dayAfter } = require('./local-date.cjs');
const { button } = require('./dom.cjs');
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
    // Allow normal file navigation to replace this view in the same tab.
    this.navigation = true;
    this.expanded = null;
    this.editing = false;
    this.busy = false;
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
    if (state.page === 'trash' && this.plugin.settings.trashRetention === 'immediately')
      state = { ...state, page: 'inbox' };
    if (state.page === 'inbox' && this.plugin.settings.captureDestination === 'daily-note')
      state = { ...state, page: 'today' };
    this.page = PAGES.some(([key]) => key === state.page) ? state.page : 'inbox';
    await super.setState(state, result);
    await this.render();
  }
  async onOpen() {
    this.closed = false;
    const refresh = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        if (!this.editing && !this.busy && !this.dragging) this.render();
      }, 180);
    };
    for (const event of ['modify', 'create', 'delete', 'rename'])
      this.registerEvent(this.app.vault.on(event, refresh));
    this.registerEvent(this.app.workspace.on('things-tasks-changed', refresh));
    this.registerDomEvent(this.contentEl.ownerDocument, 'mousedown', (e) => {
      if (!this.taskDraft || e.target.closest('.ot-task.is-expanded')) return;
      if (e.target.closest('.ot-task,.ot-capture')) return;
      this.finishTask();
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
          const pop = this.contentEl.querySelector('.ot-popover');
          if (pop) {
            if (pop.close) pop.close();
            else pop.remove();
          } else this.finishTask();
          return;
        }
        if (e.target.closest('input,textarea,select,button,.ot-date-picker')) return;
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
    this.generation = (this.generation || 0) + 1;
    clearTimeout(this.refreshTimer);
    await this.taskEditorController.flushTaskDraft();
  }
  async run(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
      this.editing = false;
      await this.render();
    } catch (error) {
      new Notice(error.message);
      console.error('ThingsMD:', error);
    } finally {
      this.busy = false;
    }
  }
  async navigate(page) {
    if (page === 'trash' && this.plugin.settings.trashRetention === 'immediately') page = 'inbox';
    if (page === 'inbox' && this.plugin.settings.captureDestination === 'daily-note')
      page = 'today';
    if (this.taskDraft && !(await this.finishTask(false))) return;
    if (page !== this.page) this.selected = null;
    this.page = PAGES.some(([key]) => key === page) ? page : 'inbox';
    this.expanded = null;
    this.leaf.updateHeader();
    this.plugin.mountListLinks();
    this.app.workspace.requestSaveLayout();
    await this.render();
  }
  async render() {
    clearTimeout(this.refreshTimer);
    if (this.closed || this.editing || this.dragging) return;
    // Obsidian's tab header and the ItemView title are separate surfaces.
    this.titleEl?.setText(this.getDisplayText());
    const generation = (this.generation = (this.generation || 0) + 1);
    const records = await this.plugin.records();
    if (this.closed || generation !== this.generation || this.editing || this.dragging) return;
    this.projects = records.filter((r) => r.meta.type === 'things-project');
    this.tasks = records.filter((r) => r.meta.type === 'things-task').sort(compareTasks);
    const progress = this.plugin.settings.showProjectProgress
      ? require('./project-progress.cjs').projectProgress(records)
      : new Map();
    const scroll = this.contentEl.querySelector('.ot-main')?.scrollTop || 0;
    this.contentEl.empty();
    this.contentEl.addClass('ot-root');
    const shell = this.contentEl.createDiv('ot-shell');
    const main = shell.createEl('main', { cls: 'ot-main' });
    const paper = main.createDiv('ot-paper');
    let active = this.tasks.filter((t) =>
      inList(
        t,
        this.page,
        today(),
        this.plugin.settings.logbook,
        this.plugin.settings.captureDestination,
      ),
    );
    const archived = ['trash', 'logbook'].includes(this.page);
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
    if (archived)
      active.sort((a, b) =>
        String(b.meta[this.page === 'trash' ? 'deletedAt' : 'completed'] || '').localeCompare(
          String(a.meta[this.page === 'trash' ? 'deletedAt' : 'completed'] || ''),
        ),
      );
    const top = paper.createDiv('ot-list-heading');
    const headingIcon = top.createSpan({
      cls: 'ot-list-heading-icon is-' + this.page,
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(headingIcon, PAGES.find(([key]) => key === this.page)?.[2] || 'inbox');
    top.createEl('h1', { text: this.getDisplayText(), cls: 'inline-title' });
    if (this.page === 'upcoming') {
      const dates = upcomingDays(active, today());
      for (const date of dates) {
        const section = paper.createEl('section', {
          cls: 'ot-section',
          attr: { 'data-date': date },
        });
        const [y, m, d] = date.split('-').map(Number);
        const dayHeading = section.createEl('h2', { cls: 'ot-day-heading' });
        dayHeading.createSpan({ cls: 'ot-day-number', text: String(d) });
        dayHeading.createSpan({
          cls: 'ot-day-name',
          text:
            date === dayAfter(1)
              ? 'Tomorrow'
              : new Intl.DateTimeFormat('en', {
                  weekday: 'long',
                  ...(date > dayAfter(7)
                    ? {
                        month: 'short',
                        ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
                      }
                    : {}),
                }).format(new Date(y, m - 1, d, 12)),
        });
        this.group(
          section,
          active.filter((task) => upcomingDates(task.meta, today()).includes(date)),
          date,
        );
      }
    } else if (this.page === 'today') {
      const waiting = this.plugin.settings.showWaitingInToday
        ? active.filter((task) => task.meta.is_waiting === true)
        : [];
      const regular = active.filter((task) => !waiting.includes(task));
      this.group(
        paper,
        regular.filter((task) => !inEvening(task.meta, today())),
        null,
      );
      const evening = regular.filter((task) => inEvening(task.meta, today()));
      if (evening.length) {
        const section = paper.createEl('section', { cls: 'ot-section ot-evening-section' });
        const h = section.createEl('h2');
        setIcon(h.createSpan({ cls: 'ot-evening-icon', attr: { 'aria-hidden': 'true' } }), 'moon');
        h.createSpan({ text: 'This Evening' });
        this.group(section, evening, 'evening');
      }
      if (waiting.length) {
        const section = paper.createEl('section', {
          cls: 'ot-section ot-evening-section ot-waiting-section',
        });
        const h = section.createEl('h2');
        setIcon(
          h.createSpan({ cls: 'ot-evening-icon', attr: { 'aria-hidden': 'true' } }),
          'send-horizontal',
        );
        h.createSpan({ text: 'Waiting For' });
        this.group(section, waiting, 'waiting');
      }
    } else if (['anytime', 'someday', 'waiting', 'repeating'].includes(this.page)) {
      const groups = new Map();
      for (const task of active) {
        const key =
          task.references?.[0] ||
          this.projects.find(
            (p) => p.meta.id === task.meta.project || p.file.path === task.meta.project,
          )?.file.path ||
          '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(task);
      }
      this.group(paper, groups.get('') || [], null);
      groups.delete('');
      for (const [key, tasks] of groups) {
        const section = paper.createEl('section', { cls: 'ot-section' });
        const project = this.projects.find((p) => p.file.path === key || p.meta.id === key);
        const heading = section.createEl('h2');
        if (project) {
          const link = button(
            heading,
            '',
            async (event) => {
              if (this.taskDraft && !(await this.finishTask(false))) return;
              const file = this.app.vault.getAbstractFileByPath(project.file.path);
              if (!file) {
                new Notice('This note is no longer available.');
                return;
              }
              const leaf =
                event.metaKey || event.ctrlKey ? this.app.workspace.getLeaf('tab') : this.leaf;
              await leaf.openFile(file);
              this.app.workspace.setActiveLeaf(leaf, { focus: true });
            },
            'ot-project-link',
          );
          link.setAttribute('aria-label', `Open note: ${project.meta.title}`);
          if (progress.has(project.file.path))
            require('./project-progress.cjs').renderProgress(link, progress.get(project.file.path));
          link.createSpan({ text: project.meta.title });
        } else heading.textContent = key;
        this.group(section, tasks, key);
      }
    } else this.group(paper, active, null);
    main.scrollTop = scroll;
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
    const row = parent.createDiv({
      cls: `ot-task ${task.meta.status === 'done' ? 'is-done' : ''} ${expanded ? 'is-expanded' : ''} ${this.selected === task.meta.id && this.selectedOccurrence === occurrence ? 'is-selected' : ''}`,
      attr: {
        'data-task-id': task.meta.id,
        'data-occurrence': occurrence,
        tabindex: '0',
        role: 'option',
        'aria-label': task.meta.title,
        'aria-selected': String(
          this.selected === task.meta.id && this.selectedOccurrence === occurrence,
        ),
        'aria-expanded': String(expanded),
      },
    });
    row.draggable = !expanded && !['trash', 'logbook'].includes(this.page);
    row.ondragstart = (e) => {
      if (this.editing || e.target.closest('input,textarea')) {
        e.preventDefault();
        return;
      }
      this.selectTask(task.meta.id, occurrence);
      this.dragging = true;
      e.dataTransfer.setData('text/ot-task', task.meta.id);
      e.dataTransfer.setData('text/ot-occurrence', occurrence);
      e.dataTransfer.effectAllowed = 'move';
      row.addClass('is-dragging');
      this.contentEl.addClass('ot-dragging');
    };
    if (!expanded && !['trash', 'logbook', 'repeating'].includes(this.page)) {
      let target = null,
        ghost = null,
        frame;
      const clean = () => {
        cancelAnimationFrame(frame);
        target?.classList.remove('is-over', 'is-over-after');
        target = null;
        ghost?.remove();
        ghost = null;
        this.dragging = false;
        row.removeClass('is-dragging');
      };
      let x, y;
      const locate = () => {
        target?.classList.remove('is-over', 'is-over-after');
        target = row.ownerDocument
          .elementFromPoint(x, y)
          ?.closest('.ot-task,.ot-capture,.ot-list-link,.nav-file-title');
        if (target === row) target = null;
        target?.classList.add('is-over');
        if (target?.matches('.ot-task'))
          target.classList.toggle(
            'is-over-after',
            y > target.getBoundingClientRect().top + target.offsetHeight / 2,
          );
        if (ghost) {
          ghost.style.left = `${x + 12}px`;
          ghost.style.top = `${y + 12}px`;
        }
      };
      const tick = () => {
        const scroll = row.closest('.ot-main'),
          box = scroll?.getBoundingClientRect();
        if (box) {
          if (y < box.top + 40) scroll.scrollTop -= 10;
          else if (y > box.bottom - 40) scroll.scrollTop += 10;
        }
        locate();
        frame = requestAnimationFrame(tick);
      };
      row._otTouchDrag = {
        hold: () => {
          this.dragging = true;
        },
        down: (e) => {
          this.selectTask(task.meta.id, occurrence);
          this.dragging = true;
          row.addClass('is-dragging');
          x = e.clientX;
          y = e.clientY;
          ghost = document.createElement('div');
          ghost.className = 'ot-task-drag-ghost';
          ghost.textContent = task.meta.title;
          document.body.append(ghost);
          tick();
        },
        move: (e) => {
          x = e.clientX;
          y = e.clientY;
          locate();
        },
        up: () => {
          const destination = target,
            after = target?.classList.contains('is-over-after');
          clean();
          if (!destination) return;
          if (destination.matches('.ot-list-link')) {
            this.dropOnList(task.meta.id, destination.dataset.list);
            return;
          }
          if (destination.matches('.nav-file-title')) {
            this.run(() =>
              this.plugin.transferTask({ id: task.meta.id, destination: destination.dataset.path }),
            );
            return;
          }
          const group = destination.closest('.ot-group');
          if (group)
            this.dropInGroup(
              {
                dataTransfer: {
                  getData: (key) => (key === 'text/ot-task' ? task.meta.id : occurrence),
                },
              },
              group,
              destination.dataset.taskId || null,
              after,
            );
        },
        cancel: clean,
      };
    }
    row.ondragend = () => {
      this.dragging = false;
      row.removeClass('is-dragging');
      this.contentEl.removeClass('ot-dragging');
    };
    if (!['trash', 'logbook', 'repeating'].includes(this.page)) {
      row.ondragover = (e) => {
        if (expanded) return;
        e.preventDefault();
        row.toggleClass(
          'is-over-after',
          e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2,
        );
        row.addClass('is-over');
      };
      row.ondragleave = () => row.removeClass('is-over', 'is-over-after');
      row.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const after = row.hasClass('is-over-after');
        row.removeClass('is-over', 'is-over-after');
        this.dropInGroup(e, parent, task.meta.id, after);
      };
    }
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
      attr: { type: 'checkbox', 'aria-label': `Complete ${task.meta.title}` },
    });
    check.checked = task.meta.status === 'done';
    check.disabled = this.page === 'trash' || (!!task.meta.repeat && !task.meta.repeat.next);
    check.onchange = async () => {
      const done = check.checked;
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
            status: done ? 'done' : 'todo',
            completed: done ? new Date().toISOString() : null,
          }),
        );
    };
    taskState(row, task.meta);
    if (['trash', 'logbook'].includes(this.page)) {
      line.createSpan({ text: task.meta.title || 'New task', cls: 'ot-task-title' });
      const stamp = this.page === 'trash' ? task.meta.deletedAt : task.meta.completed;
      if (stamp && !Number.isNaN(new Date(stamp).getTime()))
        line.createSpan({
          cls: 'ot-archive-date',
          text: new Date(stamp).toLocaleDateString('en', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
        });
      button(
        line,
        'Restore',
        () => this.run(() => this.plugin.restoreTask(task, this.page === 'logbook')),
        'ot-restore',
      );
      return;
    }
    if (expanded) this.taskEditor(row, line, task);
    else {
      line.createSpan({ text: task.meta.title || 'New task', cls: 'ot-task-title' });
      this.taskIndicators(line, task, occurrence);
      if (this.page === 'upcoming') {
        const due = task.meta.deadline === occurrence,
          start = task.meta.when === occurrence;
        line.createSpan({
          cls: 'ot-occurrence-label',
          text: due ? (start ? 'Start · Deadline' : 'Deadline') : 'Start',
        });
      }
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
  taskEditor(...args) {
    return this.taskEditorController.taskEditor(...args);
  }
  taskControl(kind) {
    return this.taskEditorController.taskControl(kind);
  }
  saveTaskDraft() {
    return this.taskEditorController.saveTaskDraft();
  }
  finishTask(render = true) {
    return this.taskEditorController.finishTask(render);
  }
  taskIndicators(line, task) {
    taskIndicators(line, task, this.page);
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
      const task = this.tasks.find((t) => t.meta.id === id);
      const kind =
        task?.meta.deadline === occurrence && task?.meta.when !== occurrence ? 'deadline' : 'when';
      this.scheduleDrop(id, date, kind);
      return;
    }
    if (![...group.querySelectorAll(':scope > .ot-task')].some((row) => row.dataset.taskId === id))
      return;
    await this.reorderInGroup(id, group, targetId, after);
  }
  dropOnList(id, page) {
    const task = this.tasks.find((t) => t.meta.id === id);
    if (!task) return;
    if (page === 'trash') {
      this.run(() => this.plugin.trashTask(task));
      return;
    }
    if (page === 'logbook') return;
    if (page === 'upcoming') {
      this.scheduleDrop(id, dayAfter(1));
      return;
    }
    this.run(() => this.plugin.transferTask({ id, list: page }));
  }
  scheduleDrop(id, date, kind = 'when') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const task = this.tasks.find((t) => t.meta.id === id);
    if (task) this.run(() => this.plugin.patchTask(task, { [kind]: date }));
  }
}

module.exports = ThingsMDView;
