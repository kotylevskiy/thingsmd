const { rollbackNotes, recoveryError } = require('../shared/note-rollback.cjs');
const { normalizeSchedule } = require('./task-schedule.cjs');
const { DEFAULT_FOLDER } = require('./task-folder-policy.cjs');
const { removeReferences, insertReference } = require('../notes/task-references.cjs');

// Coordinates task metadata and note placement, with compensating rollback.
// Clipboard and drag adapters supply success feedback; this service has no DOM.
module.exports = function installTransferService(plugin, { onTransferred, onCopyPlacementFailed }) {
  const app = plugin.app;
  let transferring = false;
  const notes = require('../shared/note-access.cjs').noteAccess(app);
  const read = notes.read;
  // A completed move must be durable in notes as well as task metadata.
  const write = (file, expected, next) => notes.write(file, expected, next, { save: true });
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
    scheduledWhen,
  }) => {
    if (list === 'waiting' && plugin.settings?.enableWaiting === false)
      throw new Error('Waiting For is disabled.');
    if (!destination && list === 'upcoming' && scheduledWhen === undefined)
      return plugin.openUpcomingMove({
        id,
        path,
        onSchedule: (when) =>
          plugin.transferTask({
            id,
            path,
            destination,
            offset,
            copy,
            snapshot,
            sourcePath,
            list,
            moveClipboard,
            scheduledWhen: when,
          }),
      });
    if (transferring) throw new Error('A task move is still finishing.');
    transferring = true;
    const edits = [];
    let created;
    try {
      let task = (await plugin.records()).find(
        (t) => t.meta.type === 'thingsmd-task' && (t.meta.id === id || t.file.path === path),
      );
      if (!task || task.meta.deleted) throw new Error('This task is unavailable.');
      const original = task;
      let saved = task;
      const file = destination ? app.vault.getAbstractFileByPath(destination) : null;
      if (
        destination &&
        (!file ||
          file.extension !== 'md' ||
          destination.startsWith((plugin.settings?.tasksFolder || DEFAULT_FOLDER) + '/'))
      )
        throw new Error('Drop onto a Markdown note.');
      if (!file && !['inbox', 'today', 'upcoming', 'anytime', 'someday', 'waiting'].includes(list))
        throw new Error('Choose a note or task list as the destination.');
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
        delete values.completed;
        delete values.loggedAt;
        delete values.deleted;
        delete values.deletedAt;
        delete values.deletedFrom;
        delete values.repeat;
        delete values.repeatSource;
        delete values.repeatDate;
        delete values.repeatEpoch;
        values.project = file?.path || null;
        values.order = Date.now();
        if (!file) {
          if (list === 'waiting') values.is_waiting = true;
          else {
            Object.assign(
              values,
              normalizeSchedule({ when: scheduledWhen ?? (list === 'inbox' ? null : list) }),
            );
            if (plugin.settings?.enableWaiting !== false && ['inbox', 'anytime'].includes(list))
              values.is_waiting = false;
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
        edits.push({ file, before, after });
        await write(file, before, after);
      }
      if (
        !copy &&
        (file || list === 'inbox') &&
        source?.extension === 'md' &&
        source.path !== file?.path
      ) {
        const before = await read(source),
          after = removeReferences(before, task.file.path);
        edits.push({ file: source, before, after });
        await write(source, before, after);
      }
      if (!copy) {
        const patch =
          file || list === 'inbox' ? { project: file?.path || null, order: Date.now() } : {};
        if (!file) {
          if (list === 'waiting') patch.is_waiting = true;
          else {
            patch.when = scheduledWhen ?? (list === 'inbox' ? null : list);
            if (plugin.settings?.enableWaiting !== false && ['inbox', 'anytime'].includes(list))
              patch.is_waiting = false;
          }
        }
        saved = await plugin.patchTask(original, patch, undefined, { notify: false });
      }
      if (moveClipboard) onTransferred(file?.path || null);
      plugin.tasksChanged();
      if (!copy) {
        const references = (original.references || []).filter(
          (path) => !edits.some((edit) => edit.file.path === path),
        );
        if (file) references.push(file.path);
        plugin.notifyTaskMove?.(
          original,
          { ...saved, references },
          file ? file.path.replace(/\.md$/, '') : list === 'upcoming' ? undefined : list,
        );
      }
      return copy ? task : saved;
    } catch (error) {
      // Roll back only our own unchanged edits; never overwrite concurrent edits.
      const failures = await rollbackNotes(edits, write);
      // A failed copy is retained as a recoverable task rather than deleted.
      if (created) onCopyPlacementFailed();
      throw recoveryError(error, failures);
    } finally {
      transferring = false;
    }
  };
  plugin.dropTaskOnList = async (source, list) => {
    if (list === 'logbook') return;
    if (list === 'trash') {
      const task = (await plugin.taskRecords()).find(
        (t) => t.meta.id === source.id || t.file.path === source.path,
      );
      if (!task || task.meta.deleted) throw new Error('This task is unavailable.');
      return plugin.trashTask(task);
    }
    return plugin.transferTask({ ...source, list });
  };
  plugin.register(() => {
    delete plugin.transferTask;
    delete plugin.dropTaskOnList;
  });
};
