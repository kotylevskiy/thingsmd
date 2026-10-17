const { referenceRanges } = require('./task-references.cjs');

module.exports = { install };
function install(plugin) {
  const { Notice } = require('obsidian');
  const app = plugin.app,
    doc = document,
    win = doc.defaultView;
  let clipboard = null,
    highlight = null;
  const textField = (el) =>
    el?.closest(
      'input,textarea,select,.ot-task.is-expanded,[contenteditable="true"]:not(.cm-content)',
    );
  const selectedRow = (el) => el?.closest('.ot-task:not(.is-expanded)');
  const markdownView = (el) =>
    app.workspace.getLeavesOfType('markdown').find((l) => l.view.containerEl.contains(el))?.view;
  require('./task-transfer-service.cjs')(plugin, {
    onTransferred: (path) => {
      if (!clipboard) return;
      clipboard.cut = false;
      clipboard.sourcePath = path;
      doc.querySelectorAll('.ot-cut-task').forEach((el) => el.classList.remove('ot-cut-task'));
    },
    onCopyPlacementFailed: () => new Notice('The copied task is saved, but placement failed.'),
  });
  const getClipboard = () => {
    try {
      return require('electron').clipboard;
    } catch {
      return null;
    }
  };
  const copyRow = async (row, cut) => {
    const task = (await plugin.taskRecords()).find((t) => t.meta.id === row.dataset.taskId);
    if (!task || task.meta.deleted) return;
    const entry = {
      id: task.meta.id,
      snapshot: JSON.parse(JSON.stringify(task)),
      cut,
      sourcePath: markdownView(row)?.file?.path,
      text: `![[${task.file.path.replace(/\.md$/, '')}]]`,
    };
    const system = getClipboard();
    if (system) system.writeText(entry.text);
    else await navigator.clipboard.writeText(entry.text);
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
      .getLeavesOfType('things-project-view')
      .find((l) => l.view.containerEl.contains(target))?.view;
    if (list) return { list: list.page };
    return null;
  };
  const paste = (target, move) => {
    const destination = destinationFor(target);
    if (!destination) return false;
    plugin
      .transferTask({
        ...destination,
        id: clipboard.id,
        snapshot: clipboard.snapshot,
        sourcePath: clipboard.sourcePath,
        copy: !clipboard.cut && !move,
        moveClipboard: clipboard.cut || move,
      })
      .catch((error) => new Notice(error.message));
    return true;
  };
  plugin.registerDomEvent(
    win,
    'keydown',
    (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || textField(event.target)) return;
      const key = event.key.toLowerCase(),
        row = selectedRow(event.target);
      if (['c', 'x'].includes(key) && row) {
        event.preventDefault();
        event.stopImmediatePropagation();
        copyRow(row, key === 'x').catch((error) => new Notice(error.message));
      } else if (key === 'v' && clipboard) {
        const system = getClipboard();
        if (system && system.readText() === clipboard.text && destinationFor(event.target)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          paste(event.target, event.altKey);
        }
      }
    },
    true,
  );
  // Browser clipboard events also cover menu commands and non-Electron clients.
  for (const type of ['copy', 'cut'])
    plugin.registerDomEvent(
      doc,
      type,
      (event) => {
        const row = selectedRow(event.target);
        if (!row || textField(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        copyRow(row, type === 'cut').catch((error) => new Notice(error.message));
      },
      true,
    );
  plugin.registerDomEvent(
    doc,
    'paste',
    (event) => {
      if (
        !clipboard ||
        textField(event.target) ||
        event.clipboardData?.getData('text/plain') !== clipboard.text ||
        !destinationFor(event.target)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      paste(event.target, false);
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
    clearHighlight();
    doc.querySelectorAll('.ot-cut-task').forEach((el) => el.classList.remove('ot-cut-task'));
  });
}
