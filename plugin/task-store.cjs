const { WriteQueue } = require('./write-queue.cjs');
const { parseYaml, stringifyYaml } = require('obsidian');
const { TASKS } = require('./lists.cjs');
const { applySchedulePolicy } = require('./task-schedule.cjs');
const { taskReferences } = require('./task-references.cjs');
const uid = () => crypto.randomUUID();
function decode(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return {
    meta: match ? parseYaml(match[1]) || {} : {},
    body: match ? text.slice(match[0].length) : text,
  };
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
    return this.app.vault.adapter.read(typeof file === 'string' ? file : file.path);
  },
  async taskRecords() {
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
          const text = await readDuringScan(adapter, path, () => adapter.read(path));
          return text === null
            ? null
            : {
                file: { path, basename: path.split('/').pop().slice(0, -3) },
                ...decode(text),
              };
        }),
    );
    return records.filter(Boolean);
  },
  async records() {
    const tasks = await this.taskRecords();
    const notes = (
      await Promise.all(
        this.app.vault.getMarkdownFiles().map(async (file) => {
          const text = await readDuringScan(this.app.vault.adapter, file.path, () =>
            this.app.vault.read(file),
          );
          if (text === null) return null;
          const record = decode(text);
          return {
            file,
            ...record,
            meta: {
              ...record.meta,
              type: 'things-project',
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
    return this.taskQueue.run(file.path, async () => {
      const current = await this.readTask(file);
      const record = fn(decode(current));
      const next = encode(record);
      // Recheck before writing so externally changed data isn't silently replaced.
      if ((await this.readTask(file)) !== current)
        throw new Error('This task changed elsewhere. Please try again.');
      await this.app.vault.adapter.write(file.path, next);
      this.tasksChanged();
      return { file, ...record };
    });
  },
  async deleteTask(file) {
    const path = typeof file === 'string' ? file : file.path;
    return this.taskQueue.run(path, async () => {
      await this.app.vault.adapter.remove(path);
      this.tasksChanged();
    });
  },
  async createTask(fields, id = uid(), body = '') {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid task id');
    fields = applySchedulePolicy({}, fields, undefined, { creating: true });
    const adapter = this.app.vault.adapter;
    // Different task IDs still share their parent folder. Serialize its first
    // creation separately so simultaneous captures cannot race on mkdir.
    await this.taskQueue.run(TASKS, async () => {
      if (await adapter.exists(TASKS)) return;
      try {
        await adapter.mkdir(TASKS);
      } catch (error) {
        // Sync or another Obsidian window may have created it in the meantime.
        if (!(await adapter.exists(TASKS))) throw error;
      }
    });
    const path = `${TASKS}/${id}.md`;
    return this.taskQueue.run(path, async () => {
      if (await adapter.exists(path)) throw new Error('Task already exists');
      const record = {
        meta: {
          title: '',
          status: 'todo',
          is_waiting: false,
          created: new Date().toISOString(),
          ...fields,
          type: 'things-task',
          id,
        },
        body,
      };
      if (record.meta.status === 'done' && !record.meta.completed)
        record.meta.completed = new Date().toISOString();
      await adapter.write(path, encode(record));
      const file = { path, basename: id };
      this.tasksChanged();
      return { file, ...record };
    });
  },
};

// All callers share the same per-task write queue, including native note cards.
module.exports = function installTaskStore(plugin) {
  plugin.taskQueue = new WriteQueue();
  Object.assign(plugin, methods);
};
