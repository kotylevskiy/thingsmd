const { taskReferences } = require('../notes/task-references.cjs');
const { scan } = require('../conversion/format.cjs');
const { selectTaskVersions } = require('./task-identity.cjs');

// Coalesce consumers and retain only the decoded entry for each current path.
// A change during a read discards that path's pending result.
function documents(list, read) {
  const entries = new Map();
  let revision = 0,
    snapshot,
    pending,
    disposed = false;
  const invalidate = (path) => {
    if (path === undefined) entries.clear();
    else entries.delete(path);
    revision++;
    snapshot = undefined;
  };
  const load = async (file) => {
    if (!entries.has(file.path)) entries.set(file.path, read(file));
    const work = entries.get(file.path);
    try {
      return await work;
    } catch (error) {
      if (entries.get(file.path) === work) entries.delete(file.path);
      throw error;
    }
  };
  return {
    invalidate,
    dispose() {
      disposed = true;
      invalidate();
    },
    read: () =>
      snapshot ||
      (pending ||= (async () => {
        while (!disposed) {
          const current = revision;
          const files = await list();
          if (current !== revision) continue;
          const paths = new Set(files.map((file) => file.path));
          for (const path of entries.keys()) if (!paths.has(path)) entries.delete(path);
          const records = [];
          for (let offset = 0; offset < files.length && current === revision; offset += 64)
            records.push(...(await Promise.all(files.slice(offset, offset + 64).map(load))));
          if (current === revision) return (snapshot = records.filter(Boolean));
        }
        return (snapshot = []);
      })().finally(() => {
        pending = undefined;
      })),
  };
}

function assemble(tasks, notes) {
  const references = new Map();
  for (const note of notes)
    for (const path of note.referencePaths) {
      if (!references.has(path)) references.set(path, []);
      references.get(path).push(note.file.path);
    }
  const withReferences = (task) => ({
    ...task,
    references: references.get(task.file.path) || [],
  });
  return [
    ...notes,
    ...tasks.map((task) => ({
      ...withReferences(task),
      ...(task.conflicts && { conflicts: task.conflicts.map(withReferences) }),
    })),
  ];
}

module.exports = function installVaultIndex(plugin, { folder, listTasks, readTask, readNote }) {
  const { vault, workspace } = plugin.app;
  let observedFiles;
  const stamp = (path) => {
    const stat = vault.getAbstractFileByPath?.(path)?.stat;
    return stat && `${stat.mtime}/${stat.size}`;
  };
  const tasks = documents(async () => {
    const paths = await listTasks();
    observedFiles ??= new Map(paths.map(({ path }) => [path, stamp(path)]));
    return paths;
  }, readTask);
  const notes = documents(
    async () => {
      const paths = new Set((await tasks.read()).map((record) => record.file.path));
      return vault.getMarkdownFiles().filter((file) => !paths.has(file.path));
    },
    async (file) => {
      const record = await readNote(file);
      if (!record || record.meta.type === 'thingsmd-task') return null;
      const { raw, body, meta } = record;
      return {
        file,
        meta: {
          ...meta,
          type: 'thingsmd-project',
          id: meta.id || file.path,
          title: meta.title || file.basename,
        },
        referencePaths: [...new Set(taskReferences(body).map((reference) => reference.path))],
        hasInlineTasks: /\[[^\]\r\n]\]/.test(raw) && scan(raw).tasks.length > 0,
      };
    },
  );
  let storage = folder();
  let taskFiles, selected, noteFiles, combined, timer;
  const checkFolder = () => {
    if (storage === folder()) return;
    storage = folder();
    observedFiles = undefined;
    tasks.invalidate();
    notes.invalidate();
  };
  const invalidate = (path) => {
    if (!path || path === storage || (storage.startsWith(path + '/') && !path.endsWith('.md'))) {
      tasks.invalidate();
      notes.invalidate();
    } else if (path.endsWith('.md')) {
      if (path.startsWith(storage + '/')) tasks.invalidate(path);
      notes.invalidate(path);
    } else notes.invalidate();
  };
  plugin.invalidateVaultPath = (path) => {
    checkFolder();
    invalidate(path);
  };
  plugin.indexedTasks = async () => {
    checkFolder();
    const files = await tasks.read();
    if (taskFiles !== files) {
      taskFiles = files;
      selected = selectTaskVersions(files);
    }
    return selected;
  };
  plugin.records = async () => {
    checkFolder();
    const [taskRecords, records] = await Promise.all([plugin.indexedTasks(), notes.read()]);
    if (taskRecords !== (await plugin.indexedTasks())) return plugin.records();
    if (noteFiles !== records || combined?.tasks !== taskRecords) {
      noteFiles = records;
      combined = { tasks: taskRecords, records: assemble(taskRecords, records) };
    }
    return combined.records;
  };
  // Adapter-only paths can appear before Obsidian emits a vault event.
  plugin.probeTaskFiles = async () => {
    checkFolder();
    const current = storage;
    const paths = await listTasks();
    const next = new Map();
    for (const { path } of paths) {
      const indexed = stamp(path);
      const stat = indexed ? null : await vault.adapter.stat?.(path);
      next.set(path, stat ? `${stat.mtime}/${stat.size}` : indexed);
    }
    if (storage !== current) return;
    observedFiles ??= new Map();
    const changed = new Set([...observedFiles.keys(), ...next.keys()]);
    let updated = false;
    for (const path of changed)
      if (
        next.has(path) !== observedFiles.has(path) ||
        next.get(path) !== observedFiles.get(path)
      ) {
        updated = true;
        invalidate(path);
      }
    observedFiles = next;
    return updated;
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => plugin.tasksChanged(), 75);
  };
  for (const event of ['create', 'modify', 'delete', 'rename'])
    plugin.registerEvent(
      vault.on(event, (file, oldPath) => {
        if (file.extension && file.extension !== 'md') return;
        plugin.invalidateVaultPath(file.path);
        if (oldPath) plugin.invalidateVaultPath(oldPath);
        schedule();
      }),
    );
  plugin.registerEvent(
    workspace.on('editor-change', (_editor, info) => {
      if (!info?.file) return;
      plugin.invalidateVaultPath(info.file.path);
      schedule();
    }),
  );
  let editors = new Map();
  const checkEditors = () => {
    const next = new Map();
    for (const { view } of workspace.getLeavesOfType('markdown')) {
      if (view.file && view.getMode?.() === 'source') next.set(view.editor, view.file.path);
    }
    let changed = false;
    for (const [editor, path] of [...editors, ...next]) {
      if (editors.get(editor) === next.get(editor)) continue;
      plugin.invalidateVaultPath(path);
      changed = true;
    }
    editors = next;
    if (changed) schedule();
  };
  for (const event of ['layout-change', 'file-open'])
    plugin.registerEvent(workspace.on(event, checkEditors));
  plugin.register(() => {
    clearTimeout(timer);
    tasks.dispose();
    notes.dispose();
  });
};
