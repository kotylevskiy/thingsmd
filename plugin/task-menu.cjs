const { Menu, Modal, Notice, Platform, setIcon } = require('obsidian');
const { projectProgress, renderProgress } = require('./project-progress.cjs');
const { parseDate } = require('./local-date.cjs');

module.exports = function installTaskMenu(plugin) {
  const app = plugin.app;
  let activeMenu = null,
    menuGeneration = 0;
  const dismissMenu = () => {
    menuGeneration++;
    const previous = activeMenu;
    activeMenu = null;
    previous?.hide();
  };
  plugin.beginTaskMenu = () => {
    dismissMenu();
    return menuGeneration;
  };
  plugin.presentTaskMenu = (menu, event, generation) => {
    if (generation !== menuGeneration) return;
    activeMenu = menu;
    menu.showAtMouseEvent(event);
  };
  plugin.registerDomEvent(
    document,
    'pointerdown',
    (event) => {
      if (!event.target.closest('.menu')) dismissMenu();
    },
    true,
  );
  plugin.registerDomEvent(
    document,
    'keydown',
    (event) => {
      if (event.key === 'Escape') dismissMenu();
    },
    true,
  );
  plugin.register(() => {
    dismissMenu();
    delete plugin.beginTaskMenu;
    delete plugin.presentTaskMenu;
  });
  const context = (row) => ({
    id: row.dataset.taskId,
    anchor: row.getBoundingClientRect(),
    sourcePath: app.workspace
      .getLeavesOfType('markdown')
      .find((l) => l.view.containerEl.contains(row))?.view.file?.path,
    card:
      row.closest('.ot-native')?._thingsCard ||
      app.workspace
        .getLeavesOfType('things-project-view')
        .find((l) => l.view.contentEl.contains(row))?.view,
  });
  const prepare = async (ctx) => {
    if (ctx.card?.taskDraft && !(await ctx.card.finishTask())) return null;
    return (await plugin.taskRecords()).find((t) => t.meta.id === ctx.id);
  };
  const safely = (action) =>
    Promise.resolve()
      .then(action)
      .catch((error) => new Notice(error.message));
  class MoveDialog extends Modal {
    constructor(ctx) {
      super(app);
      this.ctx = ctx;
    }
    async onOpen() {
      this.setTitle('Move');
      this.modalEl.addClass('ot-move-modal');
      this.containerEl.addClass('ot-move-container');
      const searchBar = this.contentEl.createDiv('ot-move-search');
      setIcon(searchBar.createSpan('ot-move-search-icon'), 'search');
      const search = searchBar.createEl('input', {
        attr: { type: 'search', placeholder: 'Move to…', 'aria-label': 'Find destination' },
      });
      const results = this.contentEl.createDiv('ot-move-results');
      const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
      const records = await plugin.records();
      if (!this.contentEl.isConnected) return;
      const progress = plugin.settings.showProjectProgress ? projectProgress(records) : new Map();
      const icons = {
        inbox: 'inbox',
        today: 'star',
        upcoming: 'calendar-days',
        anytime: 'layers',
        someday: 'archive',
        waiting: 'send-horizontal',
      };
      const options = [
        ...['Inbox', 'Today', 'Upcoming', 'Anytime', 'Waiting For', 'Someday']
          .filter(
            (label) => label !== 'Inbox' || plugin.settings.captureDestination !== 'daily-note',
          )
          .map((label) => ({
            label,
            list: label === 'Waiting For' ? 'waiting' : label.toLowerCase(),
          })),
        ...records
          .filter((t) => t.meta.type === 'things-project')
          .map((t) => ({ label: t.meta.title, path: t.file.path })),
      ];
      const counts = new Map();
      for (const o of options) counts.set(o.label, (counts.get(o.label) || 0) + 1);
      const position = () => {
        if (!this.modalEl.isConnected || innerWidth <= 600) return;
        const r = this.ctx.anchor || {
          left: innerWidth / 2 - 150,
          top: innerHeight / 2,
          bottom: innerHeight / 2,
        };
        const h = this.modalEl.offsetHeight,
          w = this.modalEl.offsetWidth;
        this.modalEl.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
        this.modalEl.style.top = `${Math.max(12, Math.min(r.top >= h + 20 ? r.top - h - 8 : r.bottom + 8, innerHeight - h - 12))}px`;
      };
      this.reposition = position;
      window.addEventListener('resize', position);
      const draw = () => {
        results.empty();
        const query = search.value.trim().toLowerCase();
        const matches = options.filter((o) =>
          (o.label + ' ' + (o.path || '')).toLowerCase().includes(query),
        );
        let notesStarted = false;
        for (const o of matches) {
          if (o.path && !notesStarted) {
            notesStarted = true;
            if (matches.some((m) => m.list)) results.createDiv('ot-move-divider');
          }
          const b = results.createEl('button', {
            cls: 'ot-move-option',
            attr: { type: 'button', 'aria-label': o.label },
          });
          if (o.list) setIcon(b.createSpan({ cls: 'ot-move-icon is-' + o.list }), icons[o.list]);
          else if (progress.has(o.path)) renderProgress(b, progress.get(o.path));
          const label = b.createSpan('ot-move-label');
          label.createSpan({ text: o.label });
          if (o.path && counts.get(o.label) > 1) label.createEl('small', { text: o.path });
          if (o.path && o.path === this.ctx.sourcePath) {
            setIcon(b.createSpan('ot-move-current'), 'check');
            b.setAttribute('aria-description', 'Current project');
          }
          b.onclick = async () => {
            if (this.busy) return;
            if (o.list === 'upcoming') {
              results.empty();
              const back = results.createEl('button', {
                cls: 'ot-move-back',
                text: '‹ Destinations',
                attr: { type: 'button' },
              });
              back.onclick = draw;
              results.createEl('p', { cls: 'ot-move-date-label', text: 'Schedule for' });
              const date = results.createEl('input', {
                attr: { type: 'date', min: parseDate('tomorrow'), 'aria-label': 'Scheduled date' },
              });
              const schedule = results.createEl('button', {
                text: 'Schedule',
                cls: 'ot-move-schedule mod-cta',
              });
              schedule.onclick = async () => {
                if (this.busy) return;
                if (!date.value || !date.checkValidity()) {
                  date.reportValidity();
                  return;
                }
                this.busy = true;
                schedule.disabled = true;
                try {
                  const task = (await plugin.taskRecords()).find((t) => t.meta.id === this.ctx.id);
                  await plugin.patchTask(task, { when: date.value });
                  this.close();
                } catch (e) {
                  error.textContent = e.message;
                  this.busy = false;
                  schedule.disabled = false;
                }
              };
              date.focus();
              position();
              return;
            }
            this.busy = true;
            error.textContent = '';
            results.querySelectorAll('button').forEach((b) => (b.disabled = true));
            try {
              await plugin.transferTask({
                id: this.ctx.id,
                sourcePath: this.ctx.sourcePath,
                ...(o.path ? { destination: o.path } : { list: o.list }),
              });
              this.close();
            } catch (e) {
              error.textContent = e.message;
              this.busy = false;
              results.querySelectorAll('button').forEach((b) => (b.disabled = false));
            }
          };
        }
        if (!matches.length)
          results.createEl('p', { cls: 'ot-move-empty', text: 'No destinations found.' });
        requestAnimationFrame(position);
      };
      search.oninput = draw;
      this.contentEl.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
        const rows = [...results.querySelectorAll('.ot-move-option:not(:disabled)')];
        if (!rows.length) return;
        const index = rows.indexOf(document.activeElement);
        if (e.key === 'Enter') {
          if (document.activeElement === search) {
            e.preventDefault();
            rows[0].click();
          }
          return;
        }
        e.preventDefault();
        rows[
          Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
        ]?.focus();
      });
      draw();
      if (!Platform.isMobile) search.focus();
    }
    onClose() {
      window.removeEventListener('resize', this.reposition);
      this.contentEl.empty();
    }
  }
  plugin.openTaskMove = (row) =>
    safely(async () => {
      const ctx = context(row),
        task = await prepare(ctx);
      if (task && !task.meta.deleted) new MoveDialog(ctx).open();
    });
  plugin.showTaskMenu = (row, event) => {
    const generation = plugin.beginTaskMenu();
    return safely(async () => {
      const ctx = context(row);
      const task = (await plugin.taskRecords()).find((t) => t.meta.id === ctx.id);
      if (!task || generation !== menuGeneration) return;
      const menu = new Menu();
      menu.setUseNativeMenu(false);
      const item = (label, icon, action, disabled = false) =>
        menu.addItem((i) =>
          i
            .setTitle(label)
            .setIcon(icon)
            .setDisabled(disabled)
            .onClick(() =>
              safely(async () => {
                const current = await prepare(ctx);
                if (current) await action(current);
              }),
            ),
        );
      if (task.meta.deleted) item('Restore', 'undo-2', (t) => plugin.restoreTask(t));
      else {
        item(
          task.meta.status === 'done' ? 'Mark Incomplete' : 'Complete',
          task.meta.status === 'done' ? 'square' : 'check-square',
          (t) => plugin.patchTask(t, { status: t.meta.status === 'done' ? 'todo' : 'done' }),
          !!task.meta.repeat && !task.meta.repeat.next,
        );
        item(task.meta.is_waiting ? 'Stop Waiting' : 'Mark as Waiting', 'send-horizontal', (t) =>
          plugin.patchTask(t, { is_waiting: !t.meta.is_waiting }),
        );
        if (task.meta.status === 'done')
          item('Move to Logbook', 'book-check', (t) => plugin.logCompleted(t));
        menu.addSeparator();
        item('Move…', 'arrow-right', () => new MoveDialog(ctx).open());
        item('Today', 'star', () =>
          plugin.transferTask({ id: ctx.id, sourcePath: ctx.sourcePath, list: 'today' }),
        );
        item('This Evening', 'moon', (t) => plugin.patchTask(t, { when: 'evening' }));
        for (const [label, list, icon] of [
          ['Anytime', 'anytime', 'layers'],
          ['Someday', 'someday', 'archive'],
        ])
          item(label, icon, () =>
            plugin.transferTask({ id: ctx.id, sourcePath: ctx.sourcePath, list }),
          );
        menu.addSeparator();
        item(
          task.meta.repeat
            ? 'Edit Repeating Rule…'
            : task.meta.repeatSource
              ? 'Show Repeating Template'
              : 'Repeat…',
          'repeat',
          () => plugin.showRepeat(ctx.id),
        );
        item(
          plugin.settings.trashRetention === 'immediately' ? 'Delete Permanently' : 'Move to Trash',
          'trash-2',
          (t) => plugin.trashTask(t),
        );
      }
      plugin.presentTaskMenu(menu, event, generation);
    });
  };
  plugin.registerDomEvent(
    document,
    'contextmenu',
    (event) => {
      const row = event.target.closest('.ot-task[data-task-id]');
      if (
        !row ||
        event.target.closest('input,textarea,[contenteditable="true"]:not(.cm-content),.ot-popover')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!row.classList.contains('ot-touch-held')) plugin.showTaskMenu(row, event);
    },
    true,
  );
  plugin.registerDomEvent(
    document.defaultView,
    'keydown',
    (event) => {
      const row = event.target.closest('.ot-task[data-task-id]');
      if (!row) return;
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        if (event.target.closest('input,textarea')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const r = row.getBoundingClientRect();
        plugin.showTaskMenu(row, { clientX: r.left, clientY: r.bottom });
      }
    },
    true,
  );
};
