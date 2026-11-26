const { isFinished } = require('./task-status.cjs');
const { WriteQueue } = require('../shared/write-queue.cjs');
const { parseYaml, stringifyYaml } = require('obsidian');
const { DEFAULT_FOLDER } = require('./task-folder-policy.cjs');
const { noteAccess } = require('../shared/note-access.cjs');
const { applySchedulePolicy } = require('./task-schedule.cjs');
const { canonicalType } = require('../legacy-identifiers.cjs');
const { selectTaskVersions } = require('./task-identity.cjs');
const installVaultIndex = require('./vault-index.cjs');
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

const taskFolder = (plugin) => plugin.settings?.tasksFolder || DEFAULT_FOLDER;

async function listTasks(plugin) {
  const folder = taskFolder(plugin);
  const { adapter } = plugin.app.vault;
  if (!(await adapter.exists(folder))) return [];
  const listing = await readDuringScan(adapter, folder, () => adapter.list(folder));
  return (listing?.files || [])
    .filter((path) => path.endsWith('.md'))
    .sort()
    .map((path) => ({ path, basename: path.split('/').pop().slice(0, -3) }));
}

async function scanTask(plugin, file) {
  const text = await readDuringScan(plugin.app.vault.adapter, file.path, () =>
    plugin.readTask(file.path),
  );
  if (text === null) return null;
  const record = decode(text);
  return record.meta.type === 'thingsmd-task' ? { file, ...record } : null;
}

const methods = {
  async readTask(file) {
    const path = typeof file === 'string' ? file : file.path;
    const indexed = this.app.vault.getAbstractFileByPath?.(path);
    return indexed ? noteAccess(this.app).read(indexed) : this.app.vault.adapter.read(path);
  },
  async readTaskSnapshot(file) {
    const raw = await this.readTask(file);
    return { raw, ...decode(raw) };
  },
  async taskRecords() {
    const files = await listTasks(this);
    const records = await Promise.all(files.map((file) => scanTask(this, file)));
    return selectTaskVersions(records.filter(Boolean));
  },
  async assertTaskAuthority(file, id) {
    if (typeof id !== 'string' || !id.trim()) return;
    const selected = (await this.taskRecords()).find((task) => task.meta.id === id);
    const path = typeof file === 'string' ? file : file.path;
    if (selected && selected.file.path !== path)
      throw new Error(
        `This is an extra copy of a task. ThingsMD uses ${selected.file.path}. Your draft was not saved.`,
      );
  },
  async update(file, fn) {
    if (this.movingTasks) throw new Error('Task folder is changing. Please try again.');
    return this.taskQueue.run(file.path, async () => {
      const indexed = this.app.vault.getAbstractFileByPath?.(file.path);
      const diskBefore = indexed ? await this.app.vault.read(indexed) : null;
      const current = await this.readTask(file);
      const decoded = decode(current);
      const id = decoded.meta.id;
      const record = fn(decoded);
      const next = encode(record);
      // A card can remain open while a preferred copy arrives from sync. Never
      // save its stale draft into a document that is no longer selected.
      await this.assertTaskAuthority(file, id);
      // Recheck before writing so externally changed data isn't silently replaced.
      if ((await this.readTask(file)) !== current)
        throw new Error('This task changed elsewhere. Please try again.');
      if (indexed && (await this.app.vault.read(indexed)) !== diskBefore)
        throw new Error('This task changed elsewhere. Please try again.');
      if (indexed) await noteAccess(this.app).write(indexed, current, next, { save: true });
      else await this.app.vault.adapter.write(file.path, next);
      this.invalidateVaultPath(file.path);
      this.tasksChanged();
      return { file: { path: file.path, basename: file.basename }, ...record };
    });
  },
  async deleteTask(file) {
    if (this.movingTasks) throw new Error('Task folder is changing. Please try again.');
    const path = typeof file === 'string' ? file : file.path;
    return this.taskQueue.run(path, async () => {
      const current = decode(await this.readTask(path));
      await this.assertTaskAuthority(path, current.meta.id);
      const indexed = this.app.vault.getAbstractFileByPath?.(path);
      if (indexed) await this.app.vault.delete(indexed);
      else await this.app.vault.adapter.remove(path);
      this.invalidateVaultPath(path);
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
      if ((await this.taskRecords()).some((task) => task.meta.id === id))
        throw new Error('Task already exists');
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
      this.invalidateVaultPath(path);
      this.tasksChanged();
      return { file: { path: file.path, basename: file.basename }, ...record };
    });
  },
};

// All callers share the same per-task write queue, including native note cards.
module.exports = function installTaskStore(plugin) {
  plugin.taskQueue = new WriteQueue();
  Object.assign(plugin, methods);
  const notes = noteAccess(plugin.app);
  installVaultIndex(plugin, {
    folder: () => taskFolder(plugin),
    listTasks: () => listTasks(plugin),
    readTask: (file) => scanTask(plugin, file),
    readNote: async (file) => {
      const raw = await readDuringScan(plugin.app.vault.adapter, file.path, () => notes.read(file));
      return raw === null ? null : { raw, ...decode(raw) };
    },
  });
};
