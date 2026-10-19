const { isFinished } = require('./task-status.cjs');
const { closePopover } = require('./dom.cjs');
const TaskEditor = require('./task-editor.cjs');
const { taskIndicators } = require('./task-indicators.cjs');
const { taskState } = require('./task-presentation.cjs');
const { Notice, Scope, Platform } = require('obsidian');

// Host-neutral card UI shared by Reading view and Live Preview. The host owns
// lookup/refresh and pending creation; the card owns draft focus and key scopes.
module.exports = function nativeTaskCard(
  plugin,
  path,
  view,
  { lookup, isHidden, pendingCreations, openOnCreate, onSaved, onMount, onDispose },
) {
  const root = document.createElement('div');
  root.className = 'ot-root ot-native';
  root.contentEditable = 'false';
  root.dataset.taskPath = path;
  // Keep native Reading-view pointer gestures from switching to the note editor.
  for (const event of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'])
    root.addEventListener(event, (e) => e.stopPropagation());
  const card = new TaskEditor(plugin, root, async (render, task) => {
    if (task) onSaved(task);
    if (card.scope) {
      plugin.app.keymap.popScope(card.scope);
      card.scope = null;
    }
    card.signature = null;
    await card.render();
  });
  card.measure = () => view?.requestMeasure();
  card.render = async () => {
    card.refreshSettings();
    if (card.taskDraft) return;
    const task = lookup(path);
    card.currentTask = task;
    const signature = task
      ? JSON.stringify([task.meta, task.body, isHidden(task.meta), plugin.settings.enableWaiting])
      : 'missing';
    if (card.signature === signature && root.childElementCount) return;
    card.signature = signature;
    root.empty();
    root.classList.toggle('ot-hidden-task', !!task && isHidden(task.meta));
    if (task && isHidden(task.meta)) {
      view?.requestMeasure();
      return;
    }
    if (!task) {
      root.createSpan({ text: 'Task file unavailable' });
      return;
    }
    const row = root.createDiv({
      cls: `ot-task ${isFinished(task.meta) ? 'is-done' : ''}`,
      attr: { tabindex: '0', 'data-task-id': task.meta.id },
    });
    const labelId = `ot-task-label-${crypto.randomUUID()}`;
    row.setAttribute('aria-labelledby', labelId);
    const line = row.createDiv('ot-task-line');
    const check = line.createEl('input', {
      attr: { type: 'checkbox', 'aria-labelledby': labelId },
    });
    check.checked = isFinished(task.meta);
    check.disabled = !!task.meta.repeat && !task.meta.repeat.next;
    taskState(row, task.meta);
    let cancelClick = false;
    check.onclick = (event) => {
      cancelClick = event.altKey;
    };
    check.onchange = () =>
      plugin
        .patchTask(task, { status: cancelClick ? 'canceled' : check.checked ? 'done' : 'todo' })
        .catch((e) => new Notice(e.message));
    line.createSpan({
      cls: 'ot-task-title',
      text: task.meta.title || 'New task',
      attr: { id: labelId },
    });
    taskIndicators(line, task, undefined, plugin.settings.enableWaiting);
    const open = () => {
      if (card.taskDraft) return;
      // Keep Obsidian's link-opening shortcuts away from the hidden reference.
      if (view) {
        const sourceLine = view.state.doc.lineAt(view.posAtDOM(root));
        view.dispatch({
          selection: { anchor: Math.min(sourceLine.to + 1, view.state.doc.length) },
        });
      }
      row.addClass('is-expanded');
      line.querySelector('.ot-task-title').remove();
      line
        .querySelectorAll(
          '.ot-task-details,.ot-row-indicators,.ot-today-marker,.ot-repeat-indicator',
        )
        .forEach((el) => el.remove());
      card.taskEditor(row, line, lookup(path) || task);
      card.scope = new Scope(plugin.app.scope);
      card.scope.register([], 'Enter', (event) => {
        if (
          event.isComposing ||
          root.ownerDocument.activeElement !== line.querySelector('.ot-title-input')
        )
          return;
        card.finishTask().then((ok) => {
          if (ok) root.querySelector('.ot-task')?.focus({ preventScroll: true });
        });
        return false;
      });
      card.scope.register([], 'Escape', () => {
        if (!closePopover(root))
          card.finishTask().then((ok) => {
            if (ok) root.querySelector('.ot-task')?.focus({ preventScroll: true });
          });
        return false;
      });
      plugin.app.keymap.pushScope(card.scope);
      line.querySelector('.ot-title-input').id = labelId;
      line.querySelector('.ot-title-input').focus();
      view?.requestMeasure();
    };
    const interactive = (target) => {
      const control = target.closest(
        'input,button,textarea,select,a,label,[contenteditable="true"]',
      );
      return control && row.contains(control);
    };
    row.ondblclick = (e) => {
      if (!interactive(e.target)) open();
    };
    row.onclick = (e) => {
      if (!card.taskDraft && !interactive(e.target)) {
        if (!view || Platform.isMobile || e.pointerType === 'touch') open();
        else row.focus();
      }
    };
    row.onkeydown = (e) => {
      if (e.target !== row) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        open();
      }
    };
    if (openOnCreate.delete(path))
      queueMicrotask(() => {
        if (root.isConnected) open();
      });
    view?.requestMeasure();
  };
  card.saveTaskDraft = async () => {
    try {
      await pendingCreations.get(path)?.();
      if (card.taskDraft) card.taskDraft.task.file = lookup(path).file;
      return await TaskEditor.prototype.saveTaskDraft.call(card);
    } catch (error) {
      new Notice(error.message);
      return false;
    }
  };
  const blur = () =>
    setTimeout(() => {
      if (card.taskDraft && !root.contains(root.ownerDocument.activeElement)) card.finishTask();
    }, 0);
  root.addEventListener('focusout', blur);
  const key = (e) => {
    if (!root.contains(e.target)) return;
    if (
      !card.taskDraft &&
      e.target.matches('.ot-task') &&
      ['Backspace', 'Delete'].includes(e.key) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const task = lookup(path);
      card.currentTask = task;
      if (task) plugin.trashTask(task).catch((error) => new Notice(error.message));
      return;
    }
    if (!card.taskDraft) return;
    if (
      e.key === 'Escape' ||
      (e.key === 'Enter' && e.target.matches('.ot-title-input') && !e.isComposing)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape' && closePopover(root)) return;
      card.finishTask().then((ok) => {
        if (ok) root.querySelector('.ot-task')?.focus({ preventScroll: true });
      });
    }
  };
  root.ownerDocument.defaultView.addEventListener('keydown', key, true);
  card.dispose = () => {
    if (card.disposed) return;
    card.disposed = true;
    card.cancelChecklistDrag?.();
    if (card.scope) {
      plugin.app.keymap.popScope(card.scope);
      card.scope = null;
    }
    root.ownerDocument.defaultView.removeEventListener('keydown', key, true);
    clearTimeout(card.saveTimer);
    card.saveTaskDraft();
    onDispose(card);
  };
  root._thingsmdCard = card;
  onMount(card);
  card.render();
  return root;
};
