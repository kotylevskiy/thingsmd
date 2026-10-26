const { taskReferences, insertReference } = require('./task-references.cjs');
const { noteAccess } = require('./note-access.cjs');
const { rollbackNotes, recoveryError } = require('./note-rollback.cjs');

async function captureLocations(plugin, task) {
  if (!plugin.app) return [];
  const notes = noteAccess(plugin.app),
    locations = [];
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (file.path === task.file.path) continue;
    const text = await notes.read(file);
    const ref = taskReferences(text).find((r) => r.path === task.file.path);
    if (ref)
      locations.push({
        path: file.path,
        reference: text.slice(ref.from, ref.to).trimEnd(),
        before: text.slice(Math.max(0, ref.from - 200), ref.from),
        after: text.slice(ref.to, ref.to + 200),
      });
  }
  return locations;
}
function restoreReference(text, path, location) {
  if (taskReferences(text).some((r) => r.path === path)) return text;
  // Follow surviving context rather than replacing an old copy of the note.
  const suffix = location.after;
  const prefix = location.before;
  let offset = text.length;
  const uniqueOffset = (context) => {
    if (!context) return -1;
    const index = text.indexOf(context);
    return index === text.lastIndexOf(context) ? index : -1;
  };
  const after = uniqueOffset(suffix),
    before = uniqueOffset(prefix);
  if (after !== -1) offset = after;
  else if (before !== -1) offset = before + prefix.length;
  else if (prefix === '') offset = 0;
  const restored = insertReference(text, path, offset);
  if (![`![[${path}]]`, `![[${path.replace(/\.md$/, '')}]]`].includes(location.reference))
    return restored;
  const ref = taskReferences(restored).find((r) => r.path === path);
  const end = restored.indexOf(']]', ref.from) + 2;
  return restored.slice(0, ref.from) + location.reference + restored.slice(end);
}
async function restoreLocations(plugin, task, restore) {
  // Properties can be edited by hand or sync. Ignore malformed locations rather
  // than turning an otherwise recoverable task into an unopenable Trash item.
  const saved = Array.isArray(task.meta.deletedFrom)
    ? task.meta.deletedFrom.filter((location) => typeof location?.path === 'string')
    : [];
  const locations = saved.length ? saved : task.meta.project ? [{ path: task.meta.project }] : [];
  if (!plugin.app || !locations.length) return restore();
  const notes = noteAccess(plugin.app),
    edits = [];
  try {
    for (const location of locations) {
      const file = plugin.app.vault.getAbstractFileByPath(location.path);
      if (!file || file.extension !== 'md' || file.path === task.file.path) continue;
      const before = await notes.read(file);
      const after = restoreReference(before, task.file.path, location);
      if (before === after) continue;
      edits.push({ file, before, after });
      await notes.write(file, before, after, { save: true });
    }
    return await restore();
  } catch (error) {
    throw recoveryError(
      error,
      await rollbackNotes(edits, (file, before, after) =>
        notes.write(file, before, after, { save: true }),
      ),
    );
  }
}

function renamedLocations(meta, oldPath, newPath) {
  const rename = (path) =>
    typeof path === 'string' && (path === oldPath || path.startsWith(oldPath + '/'))
      ? newPath + path.slice(oldPath.length)
      : path;
  const patch = {};
  if (rename(meta.project) !== meta.project) patch.project = rename(meta.project);
  if (Array.isArray(meta.deletedFrom)) {
    const locations = meta.deletedFrom.map((location) =>
      location && rename(location.path) !== location.path
        ? { ...location, path: rename(location.path) }
        : location,
    );
    if (locations.some((location, i) => location !== meta.deletedFrom[i]))
      patch.deletedFrom = locations;
  }
  return patch;
}
module.exports = { captureLocations, restoreReference, restoreLocations, renamedLocations };
