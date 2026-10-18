const { rollbackNotes, recoveryError } = require('./note-rollback.cjs');
const { canonicalType } = require('./legacy-identifiers.cjs');
const { parseYaml } = require('obsidian');
const { LEGACY_FOLDER, taskFolder } = require('./task-folder-policy.cjs');
const { noteAccess } = require('./note-access.cjs');
const { taskReferences } = require('./task-references.cjs');

// Only standalone task placements are rewritten here. Indexed file moves also
// use FileManager so Obsidian can update ordinary links and relative attachments.
function rewriteReferences(text, paths) {
  for (const ref of taskReferences(text).reverse()) {
    const next = paths.get(ref.path);
    if (!next) continue;
    const original = text.slice(ref.from, ref.to);
    const newline = original.endsWith('\r\n') ? '\r\n' : original.endsWith('\n') ? '\n' : '';
    text =
      text.slice(0, ref.from) + `![[${next.replace(/\.md$/, '')}]]` + newline + text.slice(ref.to);
  }
  return text;
}

async function moveTasks(plugin, from, to, commit = async () => {}) {
  const app = plugin.app;
  const access = noteAccess(app);
  const adapter = app.vault.adapter;
  if (from === to) return commit();
  if (plugin.movingTasks) throw new Error('A task folder change is already running.');
  // Refuse to remount active card drafts. Users can close them normally first.
  const drafts = [...document.querySelectorAll('.ot-task.is-expanded')];
  if (drafts.length) throw new Error('Close open task cards before changing the task folder.');
  plugin.movingTasks = true;
  const moved = [],
    edited = [];
  try {
    while (plugin.taskQueue.pending.size)
      await Promise.allSettled([...plugin.taskQueue.pending.values()]);
    const files = (await adapter.exists(from)) ? (await adapter.list(from)).files : [];
    const entries = [];
    for (const path of files.filter((path) => path.endsWith('.md'))) {
      const text = await plugin.readTask(path);
      const { meta } = require('./markdown-document.cjs').decode(text, parseYaml);
      if (canonicalType(meta.type) !== 'thingsmd-task') continue;
      const target = `${to}/${path.slice(from.length + 1)}`;
      if (await adapter.exists(target))
        throw new Error(`Task folder already contains ${target}. No tasks were moved.`);
      entries.push({ path, target, text });
    }
    let folder = '';
    for (const part of to.split('/')) {
      folder = folder ? `${folder}/${part}` : part;
      if (!(await adapter.exists(folder))) await app.vault.createFolder(folder);
      else if ((await adapter.stat(folder))?.type !== 'folder')
        throw new Error(`${folder} is a file, not a folder.`);
    }
    const paths = new Map(entries.map((entry) => [entry.path, entry.target]));
    for (const entry of entries) {
      if ((await plugin.readTask(entry.path)) !== entry.text)
        throw new Error('A task changed during migration. Try again.');
      const file = app.vault.getAbstractFileByPath(entry.path);
      if (file) {
        await app.fileManager.renameFile(file, entry.target);
        moved.push({ ...entry, indexed: true });
      } else {
        await app.vault.create(entry.target, entry.text);
        moved.push({ ...entry, indexed: false });
      }
    }
    for (const file of app.vault.getMarkdownFiles()) {
      const before = await access.read(file);
      const localPaths = new Map(paths);
      for (const ref of taskReferences(before)) {
        const resolved = app.metadataCache.getFirstLinkpathDest(ref.path, file.path)?.path;
        const candidates = entries.filter(
          (entry) =>
            entry.target === resolved || (!resolved && entry.target.split('/').pop() === ref.path),
        );
        if (candidates.length === 1) localPaths.set(ref.path, candidates[0].target);
      }
      const after = rewriteReferences(before, localPaths);
      if (before === after) continue;
      edited.push({ file, before, after });
      await access.write(file, before, after, { save: true });
    }
    await commit();
  } catch (error) {
    const rollbackErrors = await rollbackNotes(edited, (file, before, after) =>
      access.write(file, before, after, { save: true }),
    );
    // Leave copies in place if a reference rollback conflicts, so no link loses
    // its only target. Report recovery rather than overwriting external edits.
    if (!rollbackErrors.length)
      for (const entry of moved.reverse()) {
        try {
          const file = app.vault.getAbstractFileByPath(entry.target);
          if (entry.indexed) await app.fileManager.renameFile(file, entry.path);
          else if ((await access.read(file)) === entry.text) await app.vault.delete(file);
          else throw new Error(`Retained externally edited copy: ${entry.target}`);
        } catch (failure) {
          rollbackErrors.push(failure.message);
        }
      }
    throw recoveryError(error, rollbackErrors);
  } finally {
    plugin.movingTasks = false;
  }
  // The indexed copies and updated references are durable before legacy removal.
  for (const entry of moved.filter((entry) => !entry.indexed)) {
    if ((await adapter.read(entry.path)) !== entry.text)
      throw new Error(
        `Migration finished, but an externally changed legacy copy was retained: ${entry.path}`,
      );
    await adapter.remove(entry.path);
  }
  plugin.tasksChanged();
}

module.exports = async (plugin) => {
  plugin.changeTasksFolder = async (value) => {
    const next = taskFolder(value);
    await moveTasks(plugin, plugin.settings.tasksFolder, next, () =>
      plugin.persistSettings({ tasksFolder: next }),
    );
    plugin.paintTaskFolder?.();
  };
  if (await plugin.app.vault.adapter.exists(LEGACY_FOLDER))
    await moveTasks(plugin, LEGACY_FOLDER, plugin.settings.tasksFolder);
};
module.exports.rewriteReferences = rewriteReferences;
