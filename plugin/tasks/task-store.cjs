const { isFinished } = require('./task-status.cjs');
const { WriteQueue } = require('../shared/write-queue.cjs');
const { parseYaml, stringifyYaml } = require('obsidian');
const { DEFAULT_FOLDER } = require('./task-folder-policy.cjs');
const { noteAccess } = require('../shared/note-access.cjs');
const { applySchedulePolicy } = require('./task-schedule.cjs');
const { taskReferences } = require('../notes/task-references.cjs');
const { canonicalType } = require('../legacy-identifiers.cjs');
const uid = () => crypto.randomUUID();
function decode(text) {
  const record = require('../shared/markdown-document.cjs').decode(text, parseYaml);
  if (record.meta.type) record.meta.type = canonicalType(record.meta.type);
  return record;
}
const encode = ({ meta, body }) => `---\n${stringifyYaml(meta)}---\n${body}`;

// A purge or external sync may delete a listed file before its read finishes.
// Skip only missing paths; an existing file's I/O errors must still surface.
async function readDuringScan(adapter, path, read) {
  try {
    return await read();
  } catch (error) {
    if (!(await adapter.exists(path))) return null;
    throw error;
  }
}

const methods = {
  async readTask(file) {
    const path = typeof file === 'string' ? file : file.path;
    const indexed = this.app.vault.getAbstractFileByPath?.(path);
    return indexed ? noteAccess(this.app).read(indexed) : this.app.vault.adapter.read(path);
  },
  async taskRecords() {
    const TASKS = this.settings?.tasksFolder || DEFAULT_FOLDER;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(TASKS))) return [];
    const listing = await readDuringScan(adapter, TASKS, () => adapter.list(TASKS));
    if (!listing) return [];
    const { files } = listing;
    const records = await Promise.all(
      files
        .filter((path) => path.endsWith('.md'))
        .sort()
        .map(async (path) => {
          const text = await readDuringScan(adapter, path, () => this.readTask(path));
          return text === null
            ? null
            : {
                file: { path, basename: path.split('/').pop().slice(0, -3) },
                ...decode(text),
              };
        }),
    );
    return records.filter((record) => record?.meta.type === 'thingsmd-task');
  },
  async records() {
    const tasks = await this.taskRecords();
    const taskPaths = new Set(tasks.map((task) => task.file.path));
    const notesAccess = noteAccess(this.app);
    const notes = (
      await Promise.all(
        this.app.vault
          .getMarkdownFiles()
          .filter((file) => !taskPaths.has(file.path))
          .map(async (file) => {
            const text = await readDuringScan(this.app.vault.adapter, file.path, () =>
              notesAccess.read(file),
            );
            if (text === null) return null;
            const record = decode(text);
            if (record.meta.type === 'thingsmd-task') return null;
            return {
              file,
              ...record,
              meta: {
                ...record.meta,
                type: 'thingsmd-project',
                id: record.meta.id || file.path,
                title: record.meta.title || file.basename,
              },
            };
          }),
      )
    ).filter(Boolean);
    // Placement is determined by references in ordinary notes, not a folder or
    // a mandatory project frontmatter property. Keep it separate from disk metadata.
    const references = new Map();
    for (const note of notes)
      for (const path of new Set(taskReferences(note.body).map((reference) => reference.path))) {
        if (!references.has(path)) references.set(path, []);
        references.get(path).push(note.file.path);
      }
    for (const task of tasks) task.references = references.get(task.file.path) || [];
    return [...notes, ...tasks];
  },
  async update(file, fn) {
    if (this.movingTasks) throw new Error('Task folder is changing. Please try again.');
    return this.taskQueue.run(file.path, async () => {
      const indexed = this.app.vault.getAbstractFileByPath?.(file.path);
      const diskBefore = indexed ? await this.app.vault.read(indexed) : null;
      const current = await this.readTask(file);
      const record = fn(decode(current));
      const next = encode(record);
      // Recheck before writing so externally changed data isn't silently replaced.
      if ((await this.readTask(file)) !== current)
        throw new Error('This task changed elsewhere. Please try again.');
      if (indexed && (await this.app.vault.read(indexed)) !== diskBefore)
        throw new Error('This task changed elsewhere. Please try again.');
      if (indexed) await noteAccess(this.app).write(indexed, current, next, { save: true });
      else await this.app.vault.adapter.write(file.path, next);
      this.tasksChanged();
      return { file: { path: file.path, basename: file.basename }, ...record };
    });
  },
  async deleteTask(file) {
    if (this.movingTasks) throw new Error('Task folder is changing. Please try again.');
    const path = typeof file === 'string' ? file : file.path;
    return this.taskQueue.run(path, async () => {
      const indexed = this.app.vault.getAbstractFileByPath?.(path);
      if (indexed) await this.app.vault.delete(indexed);
      else await this.app.vault.adapter.remove(path);
      this.tasksChanged();
    });
  },
  async createTask(fields, id = uid(), body = '') {
    if (this.movingTasks) throw new Error('Task folder is changing. Please try again.');
    const TASKS = this.settings?.tasksFolder || DEFAULT_FOLDER;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid task id');
    fields = applySchedulePolicy({}, fields, undefined, { creating: true });
    const adapter = this.app.vault.adapter;
    // Different task IDs still share their parent folder. Serialize its first
    // creation separately so simultaneous captures cannot race on mkdir.
    await this.taskQueue.run(TASKS, async () => {
      if (await adapter.exists(TASKS)) return;
      try {
        if (this.app.vault.createFolder) await this.app.vault.createFolder(TASKS);
        else await adapter.mkdir(TASKS);
      } catch (error) {
        // Sync or another Obsidian window may have created it in the meantime.
        if (!(await adapter.exists(TASKS))) throw error;
      }
    });
    const path = `${TASKS}/${id}.md`;
    return this.taskQueue.run(path, async () => {
      if (this.movingTasks) throw new Error('Task folder is changing. Please try again.');
      if (await adapter.exists(path)) throw new Error('Task already exists');
      const record = {
        meta: {
          title: '',
          status: 'todo',
          is_waiting: false,
          created: new Date().toISOString(),
          ...fields,
          type: 'thingsmd-task',
          id,
        },
        body,
      };
      if (isFinished(record.meta) && !record.meta.completed)
        record.meta.completed = new Date().toISOString();
      const file = this.app.vault.create
        ? await this.app.vault.create(path, encode(record))
        : (await adapter.write(path, encode(record)), { path, basename: id });
      this.tasksChanged();
      return { file: { path: file.path, basename: file.basename }, ...record };
    });
  },
};

// All callers share the same per-task write queue, including native note cards.
module.exports = function installTaskStore(plugin) {
  plugin.taskQueue = new WriteQueue();
  Object.assign(plugin, methods);
};
