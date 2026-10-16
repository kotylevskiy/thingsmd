const { WriteQueue } = require('./write-queue.cjs');
const { parseYaml, stringifyYaml } = require('obsidian');
const { TASKS } = require('./lists.cjs');
const { today } = require('./local-date.cjs');
const { referenceRanges } = require('./task-references.cjs');
const uid = () => crypto.randomUUID();
function decode(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return {
    meta: match ? parseYaml(match[1]) || {} : {},
    body: match ? text.slice(match[0].length) : text,
  };
}
const encode = ({ meta, body }) => `---\n${stringifyYaml(meta)}---\n${body}`;

const methods = {
  async readTask(file) {
    return this.app.vault.adapter.read(typeof file === 'string' ? file : file.path);
  },
  async taskRecords() {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(TASKS))) return [];
    const { files } = await adapter.list(TASKS);
    return Promise.all(
      files
        .filter((path) => path.endsWith('.md'))
        .sort()
        .map(async (path) => ({
          file: { path, basename: path.split('/').pop().slice(0, -3) },
          ...decode(await adapter.read(path)),
        })),
    );
  },
  async records() {
    const tasks = await this.taskRecords();
    const notes = await Promise.all(
      this.app.vault.getMarkdownFiles().map(async (file) => {
        const record = decode(await this.app.vault.read(file));
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
    );
    // Placement is determined by references in ordinary notes, not a folder or
    // a mandatory project frontmatter property. Keep it separate from disk metadata.
    for (const task of tasks)
      task.references = notes
        .filter((note) => referenceRanges(note.body, task.file.path).length > 0)
        .map((note) => note.file.path);
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
    if (fields.when === 'evening') fields = { ...fields, when: 'today', evening: today() };
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(TASKS))) await adapter.mkdir(TASKS);
    const path = `${TASKS}/${id}.md`;
    return this.taskQueue.run(path, async () => {
      if (await adapter.exists(path)) throw new Error('Task already exists');
      const record = {
        meta: {
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
