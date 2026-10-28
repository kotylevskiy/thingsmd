const { taskReferences } = require('../notes/task-references.cjs');
const { StateEffect } = require('@codemirror/state');
const { ViewPlugin } = require('@codemirror/view');
const { invertedEffects, isolateHistory } = require('@codemirror/commands');
const { Notice } = require('obsidian');
const { WriteQueue } = require('../shared/write-queue.cjs');

// A soft deletion changes metadata rather than note text. Give it its own native
// history event so Undo cannot accidentally remove the earlier embed insertion.
module.exports = (plugin) => {
  const change = StateEffect.define();
  const queue = new WriteQueue();
  const reading = new Map();
  const deleting = new Set();
  // Serialize each task's inverses behind its original write: Undo can arrive
  // before deletion has reached disk. A timestamp guards against external deletes.
  const apply = (entry, deleted) =>
    queue.run(entry.path, async () => {
      const task = (await plugin.taskRecords()).find((t) => t.file.path === entry.path);
      if (!task) return;
      if (deleted) {
        if (task.meta.deleted) return;
        const saved = await plugin.trashTask(task);
        entry.stamp = saved.meta.deletedAt;
      } else if (task.meta.deleted && task.meta.deletedAt === entry.stamp) {
        await plugin.restoreTask(task);
      }
    });
  const report = (error) => new Notice(error.message);
  plugin.registerEditorExtension([
    invertedEffects.of((tr) =>
      tr.effects
        .filter((e) => e.is(change))
        .map((e) => change.of({ entry: e.value.entry, deleted: !e.value.deleted })),
    ),
    ViewPlugin.fromClass(
      class {
        update(update) {
          for (const tr of update.transactions) {
            if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) continue;
            for (const effect of tr.effects)
              if (effect.is(change)) apply(effect.value.entry, effect.value.deleted).catch(report);
          }
        }
      },
    ),
  ]);
  plugin.registerDomEvent(
    document,
    'keydown',
    (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z')
        return;
      const view = plugin.app.workspace.activeLeaf?.view;
      if (view?.getMode?.() !== 'preview' || !view.file) return;
      if (event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
      const history = reading.get(view.file.path);
      if (!history) return;
      const from = event.shiftKey ? history.redo : history.undo;
      const to = event.shiftKey ? history.undo : history.redo;
      const entry = from.pop();
      if (!entry) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      to.push(entry);
      apply(entry, event.shiftKey).catch(report);
    },
    true,
  );
  return (task, view, sourcePath) => {
    if (task.meta.deleted || deleting.has(task.file.path)) return Promise.resolve();
    deleting.add(task.file.path);
    const entry = { path: task.file.path };
    if (view) {
      const reference = taskReferences(view.state.doc.toString()).find(
        (r) => r.path === task.file.path,
      );
      view.dispatch({
        ...(reference ? { selection: { anchor: reference.from + 1 } } : {}),
        effects: change.of({ entry, deleted: true }),
        annotations: isolateHistory.of('full'),
        userEvent: 'delete',
      });
      // A removed widget cannot keep keyboard focus. Return it to the editor
      // so the next Cmd+Z reaches the same native history.
      view.focus();
    } else if (sourcePath) {
      const history = reading.get(sourcePath) || { undo: [], redo: [] };
      history.undo.push(entry);
      history.redo.length = 0;
      reading.set(sourcePath, history);
    }
    return apply(entry, true).finally(() => deleting.delete(task.file.path));
  };
};
