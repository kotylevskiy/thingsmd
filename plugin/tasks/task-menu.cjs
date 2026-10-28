const { isFinished } = require('./task-status.cjs');
const { Menu, Notice } = require('obsidian');
const MoveDialog = require('./move-dialog.cjs');
const TaskDateDialog = require('./task-date-dialog.cjs');

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
  const context = (row) => {
    const view = [
      ...app.workspace.getLeavesOfType('markdown'),
      ...app.workspace.getLeavesOfType('thingsmd-project-view'),
    ].find((leaf) => leaf.view.containerEl?.contains(row))?.view;
    return {
      id: row.dataset.taskId,
      anchor: row.getBoundingClientRect(),
      sourcePath: row.closest('.ot-task-note-controls') ? undefined : view?.file?.path,
      card: require('./task-controller.cjs')(row, view),
    };
  };
  const prepare = async (ctx) => {
    if (ctx.card?.taskDraft && !(await ctx.card.finishTask())) return null;
    return (await plugin.taskRecords()).find((t) => t.meta.id === ctx.id);
  };
  const safely = (action) =>
    Promise.resolve()
      .then(action)
      .catch((error) => new Notice(error.message));
  plugin.openUpcomingMove = async ({ id, path, onSchedule }) => {
    const task = (await plugin.taskRecords()).find((t) => t.meta.id === id || t.file.path === path);
    if (!task || task.meta.deleted) throw new Error('This task is unavailable.');
    plugin.openDialog(MoveDialog, { id: task.meta.id, schedule: true, onSchedule });
  };
  plugin.register(() => delete plugin.openUpcomingMove);
  plugin.openTaskMove = (row) =>
    safely(async () => {
      const ctx = context(row),
        task = await prepare(ctx);
      if (task && !task.meta.deleted) plugin.openDialog(MoveDialog, ctx);
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
          isFinished(task.meta) ? 'Mark as Incomplete' : 'Complete',
          isFinished(task.meta) ? 'square' : 'check-square',
          (t) => plugin.patchTask(t, { status: isFinished(t.meta) ? 'todo' : 'done' }),
          !!task.meta.repeat && !task.meta.repeat.next,
        );
        if (task.meta.status !== 'canceled')
          item(
            'Mark as Canceled',
            'square-x',
            (t) => plugin.patchTask(t, { status: 'canceled' }),
            !!task.meta.repeat && !task.meta.repeat.next,
          );
        if (plugin.settings.enableWaiting !== false)
          item(
            task.meta.is_waiting ? 'Stop Waiting' : 'Mark as Waiting',
            'thingsmd-paper-plane',
            (t) => plugin.patchTask(t, { is_waiting: !t.meta.is_waiting }),
          );
        const projects = await require('./project-navigation.cjs').destinations(plugin, task);
        if (projects.length)
          item('Show in Project', 'file-search', (t) =>
            require('./project-navigation.cjs').show(plugin, t),
          );
        if (isFinished(task.meta))
          item('Move to Logbook', 'book-check', (t) => plugin.logCompleted(t));
        menu.addSeparator();
        item('Move…', 'arrow-right', () => plugin.openDialog(MoveDialog, ctx));
        item('Today', 'star', () =>
          plugin.transferTask({ id: ctx.id, sourcePath: ctx.sourcePath, list: 'today' }),
        );
        item('This Evening', 'moon', (t) => plugin.patchTask(t, { when: 'evening' }));
        item('When…', 'calendar-days', (t) => plugin.openDialog(TaskDateDialog, t, 'when'));
        if (!task.meta.repeat)
          item('Deadline…', 'flag', (t) => plugin.openDialog(TaskDateDialog, t, 'deadline'));
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
