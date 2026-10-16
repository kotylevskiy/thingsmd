const { dayAfter } = require('./local-date.cjs');
const { referenceRanges, removeReferences, insertReference } = require('./task-references.cjs');

module.exports = { install };
function install(plugin) {
  const { Notice } = require('obsidian');
  const app = plugin.app,
    doc = document,
    win = doc.defaultView;
  let clipboard = null,
    transferring = false,
    highlight = null;
  const textField = (el) =>
    el?.closest(
      'input,textarea,select,.ot-task.is-expanded,[contenteditable="true"]:not(.cm-content)',
    );
  const selectedRow = (el) => el?.closest('.ot-task:not(.is-expanded)');
  const markdownView = (el) =>
    app.workspace.getLeavesOfType('markdown').find((l) => l.view.containerEl.contains(el))?.view;
  const editorFor = (file) =>
    app.workspace
      .getLeavesOfType('markdown')
      .find((l) => l.view.file?.path === file.path && l.view.getMode() === 'source')?.view.editor;
  const read = async (file) => editorFor(file)?.getValue() ?? (await app.vault.read(file));
  const write = async (file, expected, next) => {
    if (expected === next) return;
    const editor = editorFor(file);
    if (editor) {
      if (editor.getValue() !== expected)
        throw new Error('The note changed during the move. Try again.');
      editor.replaceRange(next, { line: 0, ch: 0 }, editor.offsetToPos(expected.length));
    } else
      await app.vault.process(file, (current) => {
        if (current !== expected) throw new Error('The note changed during the move. Try again.');
        return next;
      });
  };
  plugin.transferTask = async ({
    id,
    path,
    destination,
    offset,
    copy = false,
    snapshot,
    sourcePath,
    list,
    moveClipboard = false,
  }) => {
    if (transferring) throw new Error('A task move is still finishing.');
    transferring = true;
    const edits = [];
    let created;
    try {
      let task = (await plugin.records()).find(
        (t) => t.meta.type === 'things-task' && (t.meta.id === id || t.file.path === path),
      );
      if (!task || task.meta.deleted) throw new Error('This task is unavailable.');
      const original = task;
      const file = destination ? app.vault.getAbstractFileByPath(destination) : null;
      if (
        destination &&
        (!file || file.extension !== 'md' || destination.startsWith('.thingsmd-storage/'))
      )
        throw new Error('Drop onto a Markdown note.');
      if (!file && !['inbox', 'today', 'anytime', 'someday', 'waiting'].includes(list))
        throw new Error('Paste into a note, Inbox, Today, Anytime, or Someday.');
      sourcePath = sourcePath || task.references?.[0] || task.meta.project;
      const source =
        app.vault.getAbstractFileByPath(sourcePath || '') ||
        app.vault
          .getMarkdownFiles()
          .find((f) => app.metadataCache.getFileCache(f)?.frontmatter?.id === sourcePath);
      if (copy) {
        const values = JSON.parse(JSON.stringify((snapshot || task).meta));
        delete values.id;
        delete values.created;
        delete values.deleted;
        delete values.deletedAt;
        delete values.repeat;
        delete values.repeatSource;
        delete values.repeatDate;
        delete values.repeatEpoch;
        values.project = file?.path || null;
        values.order = Date.now();
        if (!file) {
          if (list === 'waiting') values.is_waiting = true;
          else {
            values.when = list === 'inbox' ? null : list;
            if (['inbox', 'anytime'].includes(list)) values.is_waiting = false;
          }
        }
        created = task = await plugin.createTask(values, undefined, (snapshot || task).body);
      }
      if (file) {
        const before = await read(file);
        const after = insertReference(
          before,
          task.file.path,
          offset ?? before.length,
          !copy && source?.path === file.path && offset !== undefined,
        );
        await write(file, before, after);
        edits.push({ file, before, after });
      }
      if (
        !copy &&
        (file || list === 'inbox') &&
        source?.extension === 'md' &&
        source.path !== file?.path
      ) {
        const before = await read(source),
          after = removeReferences(before, task.file.path);
        await write(source, before, after);
        edits.push({ file: source, before, after });
      }
      if (!copy) {
        const patch =
          file || list === 'inbox' ? { project: file?.path || null, order: Date.now() } : {};
        if (!file) {
          if (list === 'waiting') patch.is_waiting = true;
          else {
            patch.when = list === 'inbox' ? null : list;
            if (['inbox', 'anytime'].includes(list)) patch.is_waiting = false;
          }
        }
        await plugin.patchTask(original, patch);
      }
      if (moveClipboard && clipboard) {
        clipboard.cut = false;
        clipboard.sourcePath = file?.path || null;
        doc.querySelectorAll('.ot-cut-task').forEach((el) => el.classList.remove('ot-cut-task'));
      }
      plugin.tasksChanged();
      return task;
    } catch (error) {
      // Roll back only our own unchanged edits; never overwrite concurrent edits.
      for (const edit of edits.reverse())
        try {
          await write(edit.file, edit.after, edit.before);
        } catch {}
      // A failed copy is retained as a recoverable task rather than deleted.
      if (created) new Notice('The copied task is saved, but placement failed.');
      throw error;
    } finally {
      transferring = false;
    }
  };
  plugin.dropTaskOnList = async (source, list) => {
    if (list === 'logbook') return;
    if (list === 'trash' || list === 'upcoming') {
      const task = (await plugin.taskRecords()).find(
        (t) => t.meta.id === source.id || t.file.path === source.path,
      );
      if (!task || task.meta.deleted) throw new Error('This task is unavailable.');
      if (list === 'trash') return plugin.trashTask(task);
      const when = dayAfter(1);
      return plugin.patchTask(task, { when });
    }
    return plugin.transferTask({ ...source, list });
  };
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
    delete plugin.transferTask;
    delete plugin.dropTaskOnList;
  });
}
