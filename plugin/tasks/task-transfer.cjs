const { referenceRanges } = require('../notes/task-references.cjs');

module.exports = { install };
function install(plugin) {
  const { Notice } = require('obsidian');
  const app = plugin.app,
    doc = document,
    win = doc.defaultView;
  let clipboard = null,
    copyRequest = 0,
    highlight = null;
  const textField = (el) =>
    el?.closest(
      'input,textarea,select,.ot-task.is-expanded,[contenteditable="true"]:not(.cm-content)',
    );
  const selectedRow = (el) => el?.closest('.ot-task:not(.is-expanded)');
  const markdownView = (el) =>
    app.workspace.getLeavesOfType('markdown').find((l) => l.view.containerEl.contains(el))?.view;
  require('./task-transfer-service.cjs')(plugin, {
    onTransferred: (path, entry) => {
      if (clipboard !== entry) return;
      clipboard.cut = false;
      clipboard.sourcePath = path;
      doc.querySelectorAll('.ot-cut-task').forEach((el) => el.classList.remove('ot-cut-task'));
    },
    onCopyPlacementFailed: () => new Notice('The copied task is saved, but placement failed.'),
  });
  const copyFromEvent = async (event, cut) => {
    const row = selectedRow(event.target);
    if (!row || textField(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!win.ClipboardItem || !win.navigator.clipboard?.write)
      throw new Error('Clipboard access is unavailable.');
    const request = ++copyRequest;
    const sourcePath = markdownView(row)?.file?.path;
    const pendingEntry = plugin.taskRecords().then((tasks) => {
      const task = tasks.find((t) => t.meta.id === row.dataset.taskId);
      if (!task || task.meta.deleted) throw new Error('This task is unavailable.');
      return {
        id: task.meta.id,
        snapshot: JSON.parse(JSON.stringify(task)),
        cut,
        sourcePath,
        text: `![[${task.file.path.replace(/\.md$/, '')}]]`,
      };
    });
    // WebKit needs the write to start during the user gesture. The item can
    // provide its text once the task has been read.
    const item = new win.ClipboardItem({
      'text/plain': pendingEntry.then(({ text }) => new win.Blob([text], { type: 'text/plain' })),
    });
    const [entry] = await Promise.all([pendingEntry, win.navigator.clipboard.write([item])]);
    if (request !== copyRequest) return;
    clipboard = entry;
    doc.querySelectorAll('.ot-cut-task').forEach((el) => el.classList.remove('ot-cut-task'));
    if (cut) row.classList.add('ot-cut-task');
  };
  const destinationFor = (target) => {
    const view = markdownView(target);
    if (view?.file) {
      const row = selectedRow(target),
        root = row?.closest('.ot-native');
      let offset;
      if (view.getMode() === 'source') {
        const editor = view.editor;
        if (root) {
          const ranges = referenceRanges(editor.getValue(), root.dataset.taskPath);
          const match =
            ranges.find((r) => r.from >= editor.posToOffset(editor.getCursor())) || ranges[0];
          offset = match?.to;
        } else offset = editor.posToOffset(editor.getCursor());
      }
      return { destination: view.file.path, offset };
    }
    const list = app.workspace
      .getLeavesOfType('thingsmd-project-view')
      .find((l) => l.view.containerEl.contains(target))?.view;
    if (list) return { list: list.page };
    return null;
  };
  const paste = (destination, entry, move) => {
    plugin
      .transferTask({
        ...destination,
        id: entry.id,
        snapshot: entry.snapshot,
        sourcePath: entry.sourcePath,
        copy: !entry.cut && !move,
        clipboardEntry: entry.cut || move ? entry : undefined,
      })
      .catch((error) => new Notice(error.message));
  };
  plugin.registerDomEvent(
    win,
    'keydown',
    async (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      const key = event.key.toLowerCase();
      // WebKit can omit copy/cut events when a focused task row has no text selection.
      if (key === 'c' || key === 'x') {
        await copyFromEvent(event, key === 'x').catch((error) => new Notice(error.message));
        return;
      }
      const entry = clipboard;
      const target = event.target;
      if (!entry || !event.altKey || (key !== 'v' && event.code !== 'KeyV') || textField(target))
        return;
      const destination = destinationFor(target);
      if (!destination) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Option/Alt+Paste has no native paste event. Read only on this gesture.
      try {
        const text = await win.navigator.clipboard.readText();
        if (clipboard !== entry || text !== entry.text || doc.activeElement !== target) return;
        const current = destinationFor(target);
        if (
          current &&
          current.destination === destination.destination &&
          current.offset === destination.offset &&
          current.list === destination.list
        )
          paste(destination, entry, true);
      } catch (error) {
        new Notice(error.message);
      }
    },
    true,
  );
  for (const type of ['copy', 'cut'])
    plugin.registerDomEvent(
      doc,
      type,
      (event) => copyFromEvent(event, type === 'cut').catch((error) => new Notice(error.message)),
      true,
    );
  plugin.registerDomEvent(
    doc,
    'paste',
    (event) => {
      const entry = clipboard;
      if (
        !entry ||
        textField(event.target) ||
        event.clipboardData?.getData('text/plain') !== entry.text
      )
        return;
      const destination = destinationFor(event.target);
      if (!destination) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      paste(destination, entry, false);
    },
    true,
  );
  const clearHighlight = () => {
    highlight?.classList.remove('ot-note-drop-target');
    highlight = null;
  };
  const noteTarget = (target) => {
    const el = target.closest('.nav-file-title[data-path]');
    return el?.dataset.path.endsWith('.md') ? el : null;
  };
  plugin.registerDomEvent(
    doc,
    'dragover',
    (event) => {
      if (!Array.from(event.dataTransfer.types).includes('text/ot-task')) return;
      const target = noteTarget(event.target);
      clearHighlight();
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      highlight = target;
      target.classList.add('ot-note-drop-target');
    },
    true,
  );
  plugin.registerDomEvent(
    doc,
    'drop',
    (event) => {
      const target = noteTarget(event.target),
        id = event.dataTransfer.getData('text/ot-task');
      clearHighlight();
      if (!target || !id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      plugin
        .transferTask({ id, destination: target.dataset.path })
        .catch((error) => new Notice(error.message));
    },
    true,
  );
  plugin.registerDomEvent(doc, 'dragend', clearHighlight, true);
  plugin.register(() => {
    copyRequest++;
    clipboard = null;
    clearHighlight();
    doc.querySelectorAll('.ot-cut-task').forEach((el) => el.classList.remove('ot-cut-task'));
  });
}
