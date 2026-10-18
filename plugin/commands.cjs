const { dayAfter } = require('./local-date.cjs');
const { LISTS, isListAvailable } = require('./lists.cjs');
const { Notice } = require('obsidian');
const { referenceRanges } = require('./task-references.cjs');
const { noteAccess } = require('./note-access.cjs');
module.exports = function (plugin) {
  const app = plugin.app;
  const notes = noteAccess(app);
  let last = null;
  const remember = (e) => {
    const row = e.target.closest?.('.ot-task[data-task-id]');
    if (row)
      last = {
        id: row.dataset.taskId,
        occurrence: row.dataset.occurrence,
        leaf: app.workspace.activeLeaf,
        checklist: [...row.querySelectorAll('.ot-checklist-row')].indexOf(
          e.target.closest('.ot-checklist-row'),
        ),
      };
    else if (
      app.workspace.activeLeaf?.view.getViewType() === 'markdown' &&
      app.workspace.activeLeaf.view.containerEl.contains(e.target)
    )
      last = null;
  };
  plugin.registerDomEvent(document, 'focusin', remember, true);
  plugin.registerDomEvent(document, 'pointerdown', remember, true);
  const context = () => {
    const leaf = app.workspace.activeLeaf,
      view = leaf?.view;
    if (!view || plugin.captureModal) return null;
    const root = view.containerEl;
    const focused = document.activeElement?.closest?.('.ot-task[data-task-id]');
    const id =
      (focused && root.contains(focused) ? focused.dataset.taskId : null) ||
      view.taskDraft?.task.meta.id ||
      view.selected ||
      (last?.leaf === leaf ? last.id : null) ||
      root.querySelector('.ot-task-note-controls .ot-task')?.dataset.taskId;
    if (!id) return null;
    // Retain the selected group when commands open a popup or restore focus.
    const occurrence =
      focused?.dataset.occurrence ||
      view.selectedOccurrence ||
      (last?.leaf === leaf ? last.occurrence : undefined);
    const candidates = [...root.querySelectorAll('.ot-task[data-task-id]')].filter(
      (r) => r.dataset.taskId === id && r.getBoundingClientRect().width,
    );
    const row = candidates.find((r) => r.dataset.occurrence === occurrence) || candidates[0];
    if (!row) return null;
    const card = require('./task-controller.cjs')(row, view);
    const task =
      card.taskDraft?.task || card.currentTask || view.tasks?.find((t) => t.meta.id === id);
    return {
      id,
      occurrence: row.dataset.occurrence,
      row,
      card,
      view,
      task,
      checklist: last?.id === id ? last.checklist : -1,
    };
  };
  const safe = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => new Notice(e.message));
  const fresh = async (c) => {
    if (c.card.taskDraft && !(await c.card.finishTask())) return null;
    return (await plugin.taskRecords()).find((t) => t.meta.id === c.id);
  };
  const register = (id, name, action, valid = () => true) =>
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const c = context();
        if (!c || !valid(c)) return false;
        if (!checking) safe(() => action(c));
        return true;
      },
    });
  const editable = (c) => !c.task?.meta.deleted && !['trash', 'logbook'].includes(c.view.page);
  const refocus = async (c) => {
    const allowed = () =>
      app.workspace.activeLeaf?.view === c.view && !document.querySelector('.modal-container');
    if (!allowed()) return;
    if (c.view.getViewType() === 'thingsmd-project-view') {
      await c.view.render();
      if (!allowed()) return;
      const row =
        [...c.view.contentEl.querySelectorAll('.ot-task')].find(
          (r) => r.dataset.taskId === c.id && r.dataset.occurrence === c.occurrence,
        ) ||
        c.view.selectedRow() ||
        c.view.contentEl.querySelector('.ot-task');
      if (row) {
        c.view.selectTask(row.dataset.taskId, row.dataset.occurrence);
        row.focus();
      } else {
        const main = c.view.contentEl.querySelector('.ot-main');
        if (main) {
          main.tabIndex = -1;
          main.focus();
        }
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 220));
      // A capture/search modal may open while a note reorder is settling.
      // Its focus belongs to that newer interaction, not the old command.
      if (!allowed()) return;
      [...c.view.containerEl.querySelectorAll('.ot-task')]
        .find((r) => r.dataset.taskId === c.id && r.getBoundingClientRect().width)
        ?.focus();
    }
  };
  const patch = (id, name, fields, valid = editable) =>
    register(
      id,
      name,
      async (c) => {
        const t = await fresh(c);
        if (t) {
          await plugin.patchTask(t, typeof fields === 'function' ? fields(t) : fields);
          await refocus(c);
        }
      },
      valid,
    );
  const openEditor = async (c) => {
    if (c.card.taskDraft) return;
    if (c.view.getViewType() === 'thingsmd-project-view') await c.view.openTask(c.id);
    else c.row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  };
  for (const [key, name] of LISTS)
    plugin.addCommand({
      id: 'show-' + key,
      name: 'Show ' + name,
      checkCallback: (checking) => {
        if (!isListAvailable(key, plugin.settings)) return false;
        if (!checking)
          safe(async () => {
            await plugin.openList(key);
            const v = app.workspace.activeLeaf.view;
            const row = v.contentEl.querySelector('.ot-task');
            if (row) {
              v.selectTask(row.dataset.taskId, row.dataset.occurrence);
              row.focus();
            } else {
              const main = v.contentEl.querySelector('.ot-main');
              main.tabIndex = -1;
              main.focus();
            }
          });
        return true;
      },
    });
  plugin.newTaskHere = async () => {
    const leaf = plugin.mainWorkspaceLeaf();
    await leaf.loadIfDeferred?.();
    const view = leaf.view;
    if (
      view?.getViewType() === 'thingsmd-project-view' &&
      !['trash', 'logbook', 'repeating'].includes(view.page)
    ) {
      if (view.taskDraft && !(await view.finishTask())) return;
      const c = context(),
        group = c?.row.closest('.ot-group'),
        date = group?.closest('[data-date]')?.dataset.date;
      const capture = (group || view.contentEl).querySelector('.ot-capture');
      if (capture) {
        capture.click();
        return;
      }
      plugin.capture({
        project: c?.task?.references?.[0] || null,
        when: view.page === 'anytime' ? 'anytime' : date || null,
      });
    } else if (view?.file?.extension === 'md') {
      const path = view.file.path;
      // A reused Markdown view can retain its previous task-note CSS class
      // until the next render. Resolve the file's identity from task records.
      const task = (await plugin.taskRecords()).some((task) => task.file.path === path);
      plugin.capture(task ? undefined : { project: path });
    } else plugin.capture();
  };
  plugin.addCommand({
    id: 'capture',
    name: 'New task',
    callback: () => safe(() => plugin.newTaskHere()),
  });
  patch(
    'toggle-waiting',
    'Toggle waiting',
    (t) => ({ is_waiting: !t.meta.is_waiting }),
    (c) => editable(c) && plugin.settings.enableWaiting !== false,
  );
  patch('complete-task', 'Toggle task completion', (t) => ({
    status: t.meta.status === 'done' ? 'todo' : 'done',
  }));
  for (const [id, name, value] of [
    ['task-today', 'Schedule task: Today', 'today'],
    ['task-evening', 'Schedule task: This Evening', 'evening'],
    ['task-tomorrow', 'Schedule task: Tomorrow', null],
    ['task-anytime', 'Schedule task: Anytime', 'anytime'],
    ['task-someday', 'Schedule task: Someday', 'someday'],
  ])
    patch(id, name, () => ({
      when: id === 'task-tomorrow' ? dayAfter(1) : value,
      ...(value === 'anytime' && plugin.settings.enableWaiting !== false
        ? { is_waiting: false }
        : {}),
    }));
  for (const [kind, name] of [
    ['when', 'Schedule task…'],
    ['deadline', 'Set task deadline…'],
  ])
    register(
      'task-' + kind,
      name,
      async (c) => {
        await openEditor(c);
        c.card.taskControl(kind);
      },
      (c) => editable(c) && (kind !== 'deadline' || !c.task?.meta.repeat),
    );
  patch('remove-deadline', 'Remove task deadline', { deadline: null });
  register('move-task', 'Move task…', (c) => plugin.openTaskMove(c.row), editable);
  register('task-context-menu', 'Show task context menu', (c) => {
    const r = c.row.getBoundingClientRect();
    return plugin.showTaskMenu(c.row, { clientX: r.left, clientY: r.bottom });
  });
  register(
    'save-task',
    'Save and close task',
    (c) => c.card.finishTask(),
    (c) => !!c.card.taskDraft,
  );
  register(
    'add-checklist-item',
    'Add checklist item',
    async (c) => {
      await openEditor(c);
      c.card.contentEl.querySelector('button[aria-label="Checklist"]')?.click();
    },
    editable,
  );
  register(
    'trash-task',
    'Move task to Trash',
    async (c) => {
      const t = await fresh(c);
      if (t) {
        await plugin.trashTask(t);
        await refocus(c);
      }
    },
    (c) => c.view.page !== 'trash',
  );
  register(
    'restore-task',
    'Restore task',
    async (c) => {
      const t = await fresh(c);
      if (t) {
        await plugin.restoreTask(t, c.view.page === 'logbook');
        await refocus(c);
      }
    },
    (c) => ['trash', 'logbook'].includes(c.view.page),
  );
  register(
    'log-task',
    'Move completed task to Logbook',
    async (c) => {
      const t = await fresh(c);
      if (t?.meta.status === 'done') await plugin.logCompleted(t);
    },
    (c) => c.task?.meta.status === 'done' && editable(c),
  );
  register(
    'repeat-task',
    'Create or edit repeating rule',
    async (c) => {
      const t = await fresh(c);
      if (t) await plugin.showRepeat(t.meta.id);
    },
    editable,
  );
  register(
    'toggle-repeat',
    'Pause or resume repeating rule',
    async (c) => {
      const t = await fresh(c);
      if (t?.meta.repeat) await plugin.repeating.pause(t.meta.id, !t.meta.repeat.paused);
    },
    (c) => !!c.task?.meta.repeat,
  );
  register(
    'stop-repeat',
    'Stop repeating',
    async (c) => {
      const t = await fresh(c);
      if (t?.meta.repeat) await plugin.repeating.stop(t.meta.id);
    },
    (c) => !!c.task?.meta.repeat,
  );
  register(
    'next-repeat',
    'Create next repeating copy',
    async (c) => {
      const t = await fresh(c);
      if (t?.meta.repeat?.next) {
        const copy = await plugin.repeating.createNext(t.meta.id);
        await plugin.showRepeatingTask(copy.meta.id);
      }
    },
    (c) => !!c.task?.meta.repeat?.next,
  );
  register(
    'show-repeat-template',
    'Show repeating template',
    (c) => plugin.showRepeatingTask(c.task.meta.repeatSource),
    (c) => !!c.task?.meta.repeatSource,
  );
  register(
    'show-previous-repeat',
    'Show previous repeating copy',
    (c) => plugin.showRepeatingTask(c.task.meta.repeat.lastCopy),
    (c) => !!c.task?.meta.repeat?.lastCopy,
  );
  register('open-project', 'Open containing project', async (c) => {
    const t = (await plugin.records()).find((t) => t.meta.id === c.id);
    const path = t?.references?.[0] || t?.meta.project;
    const file = app.vault.getAbstractFileByPath(path || '');
    if (file) {
      const leaf = plugin.mainWorkspaceLeaf();
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    } else new Notice('This task has no containing project.');
  });
  for (const [direction, label] of [
    [-1, 'up'],
    [1, 'down'],
  ])
    register(
      'move-task-' + label,
      'Move task ' + label,
      async (c) => {
        if (!(await fresh(c))) return;
        if (c.view.getViewType() === 'thingsmd-project-view') {
          const row =
              [...c.view.contentEl.querySelectorAll('.ot-task')].find(
                (r) => r.dataset.taskId === c.id && r.dataset.occurrence === c.occurrence,
              ) || c.row,
            group = row.closest('.ot-group');
          const rows = [...group.querySelectorAll(':scope > .ot-task')],
            target = rows[rows.indexOf(row) + direction];
          if (target)
            await c.view.reorderInGroup(c.id, group, target.dataset.taskId, direction > 0);
        } else {
          const file = c.view.file,
            text = await notes.read(file);
          const records = await plugin.taskRecords();
          const ranges = records
            .flatMap((t) =>
              referenceRanges(text, t.file.path).map((r) => ({ ...r, id: t.meta.id })),
            )
            .sort((a, b) => a.from - b.from);
          const i = ranges.findIndex((r) => r.id === c.id),
            a = ranges[i],
            b = ranges[i + direction];
          if (!a || !b) return;
          const [first, second] = [a, b].sort((a, b) => a.from - b.from);
          const firstEnd =
              first.to - (text.slice(first.from, first.to).match(/\r?\n$/)?.[0].length || 0),
            secondEnd =
              second.to - (text.slice(second.from, second.to).match(/\r?\n$/)?.[0].length || 0);
          const next =
            text.slice(0, first.from) +
            text.slice(second.from, secondEnd) +
            text.slice(firstEnd, second.from) +
            text.slice(first.from, firstEnd) +
            text.slice(secondEnd);
          await notes.write(file, text, next, { save: true });
          await refocus(c);
        }
      },
      (c) => editable(c) && !c.card.taskDraft && c.view.page !== 'repeating',
    );
  for (const [direction, label] of [
    [-1, 'up'],
    [1, 'down'],
  ])
    register(
      'move-checklist-' + label,
      'Move checklist item ' + label,
      (c) => {
        const item = c.card.contentEl.querySelectorAll('.ot-checklist-row')[c.checklist];
        item?.querySelector('button')?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: direction < 0 ? 'ArrowUp' : 'ArrowDown',
            bubbles: true,
          }),
        );
      },
      (c) => !!c.card.taskDraft && c.checklist >= 0,
    );
};
