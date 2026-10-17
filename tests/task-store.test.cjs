const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture() {
  const filename = require.resolve('../plugin/task-store.cjs');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  // JSON is a YAML subset; this fixture isolates storage/merge behavior from the
  // host's YAML parser. Live suites also exercise Obsidian's actual serializer.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    crypto: require('node:crypto').webcrypto,
    require: (name) =>
      name === 'obsidian'
        ? { parseYaml: JSON.parse, stringifyYaml: (value) => JSON.stringify(value) + '\n' }
        : localRequire(name),
  });
  const files = new Map();
  const plugin = {
    tasksChanged() {},
    app: {
      vault: {
        adapter: {
          exists: async (path) => path === '.thingsmd-storage' || files.has(path),
          mkdir: async () => {},
          list: async () => ({
            files: [...files.keys()].filter((path) => path.startsWith('.thingsmd-storage/')),
          }),
          read: async (path) => {
            if (!files.has(path)) throw Error('Missing file');
            return files.get(path);
          },
          write: async (path, text) => files.set(path, text),
        },
        getMarkdownFiles: () =>
          [...files.keys()]
            .filter((path) => !path.startsWith('.thingsmd-storage/'))
            .map((path) => ({ path, basename: path.slice(0, -3) })),
        read: async (file) => files.get(file.path),
      },
    },
  };
  module.exports(plugin);
  require('../plugin/task-actions.cjs')(plugin);
  return { plugin, files };
}

test('placement ignores fenced, inline and frontmatter examples but indexes real references', async () => {
  const { plugin, files } = fixture();
  const task = await plugin.createTask({ title: 'Example' }, 'example');
  files.set(
    'Examples.md',
    '---\n{"example":"![[.thingsmd-storage/example]]"}\n---\n````md\n```\n![[.thingsmd-storage/example]]\n````\nInline ![[.thingsmd-storage/example]]\n',
  );
  files.set('Project.md', 'Before\n![[.thingsmd-storage/example.md]]\nAfter\n');
  const found = (await plugin.records()).find((record) => record.meta.id === task.meta.id);
  assert.equal(JSON.stringify(found.references), JSON.stringify(['Project.md']));
});

test('storage merges independent fields, rejects stale edits and recovers its write queue', async () => {
  const { plugin } = fixture();
  const initial = await plugin.createTask({ title: 'Original', when: 'today' }, 'merge');
  await plugin.patchTask(initial, { title: 'External' });
  const merged = await plugin.patchTask(initial, { when: 'someday' });
  assert.equal(merged.meta.title, 'External');
  assert.equal(merged.meta.when, 'someday');
  await assert.rejects(plugin.patchTask(initial, { title: 'Stale' }), /changed elsewhere/);
  assert.equal(plugin.taskQueue.pending.size, 0);
  const saved = await plugin.patchTask(merged, { title: 'Recovered' });
  assert.equal(saved.meta.title, 'Recovered');
});

test('concurrent creation never replaces an existing task with the same ID', async () => {
  const { plugin } = fixture();
  const results = await Promise.allSettled([
    plugin.createTask({ title: 'First' }, 'same'),
    plugin.createTask({ title: 'Second' }, 'same'),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal((await plugin.taskRecords())[0].meta.title, 'First');
  assert.equal(plugin.taskQueue.pending.size, 0);
});

test('a task deleted between listing and reading does not break a refresh', async () => {
  const { plugin, files } = fixture();
  await plugin.createTask({ title: 'Keep' }, 'keep');
  const removed = await plugin.createTask({ title: 'Deleted during refresh' }, 'removed');
  const adapter = plugin.app.vault.adapter,
    read = adapter.read;
  adapter.read = async (path) => {
    if (path === removed.file.path) {
      files.delete(path);
      throw Error('File disappeared');
    }
    return read(path);
  };
  const records = await plugin.taskRecords();
  assert.deepEqual(
    Array.from(records, (task) => task.meta.id),
    ['keep'],
  );
});

test('refresh still reports a read failure when the file exists', async () => {
  const { plugin } = fixture();
  await plugin.createTask({ title: 'Unreadable' }, 'unreadable');
  plugin.app.vault.adapter.read = async () => {
    throw Error('Permission denied');
  };
  await assert.rejects(plugin.taskRecords(), /Permission denied/);
});

test('a note removed during reference indexing does not break remaining task records', async () => {
  const { plugin, files } = fixture();
  await plugin.createTask({ title: 'Keep' }, 'keep');
  files.set('Removed.md', '![[.thingsmd-storage/keep]]');
  plugin.app.vault.read = async (file) => {
    files.delete(file.path);
    throw Error('Note disappeared');
  };
  const records = await plugin.records();
  assert.equal(records.length, 1);
  assert.equal(records[0].meta.id, 'keep');
  assert.equal(records[0].references.length, 0);
});

test('deletion waits for an in-flight write instead of resurrecting the task', async () => {
  const { plugin, files } = fixture();
  const task = await plugin.createTask({ title: 'Original' }, 'delete-race');
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const adapter = plugin.app.vault.adapter,
    write = adapter.write;
  adapter.write = async (...args) => {
    started();
    await gate;
    return write(...args);
  };
  adapter.remove = async (path) => files.delete(path);
  const saving = plugin.patchTask(task, { title: 'Updated' });
  await entered;
  const deleting = plugin.deleteTask(task.file);
  assert.ok(files.has(task.file.path));
  release();
  await Promise.all([saving, deleting]);
  assert.equal(files.has(task.file.path), false);
});

test('canceling repeat rescheduling preserves the evening marker', async () => {
  const { plugin } = fixture();
  await plugin.createTask({ title: 'Template', repeat: { mode: 'regular' } }, 'template');
  const task = await plugin.createTask(
    { title: 'Copy', repeatSource: 'template', when: 'today', evening: '2026-10-16' },
    'copy',
  );
  plugin.chooseRepeatReschedule = async () => 'cancel';
  const saved = await plugin.patchTask(task, { when: '2099-01-01' });
  assert.equal(saved.meta.when, 'today');
  assert.equal(saved.meta.evening, '2026-10-16');
});

test('move feedback follows successful persistence and can be suppressed for a coordinated transfer', async () => {
  const { plugin } = fixture();
  const calls = [];
  plugin.notifyTaskMove = (before, after) => calls.push([before, after]);
  const initial = await plugin.createTask({ title: 'Move feedback' }, 'notice');
  const saved = await plugin.patchTask(initial, { when: 'today' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].meta.when, 'today');
  await assert.rejects(plugin.patchTask(initial, { when: 'someday' }), /changed elsewhere/);
  assert.equal(calls.length, 1);
  await plugin.patchTask(saved, { when: 'someday' }, undefined, { notify: false });
  assert.equal(calls.length, 1);
});

test('feedback compares with persisted state instead of stale editor fields', async () => {
  const { plugin } = fixture();
  const { moveMessage } = require('../plugin/move-notice.cjs');
  const messages = [];
  plugin.notifyTaskMove = (before, after) => {
    const message = moveMessage(before, after, {}, '2026-10-17');
    if (message) messages.push(message);
  };
  const initial = await plugin.createTask({ title: 'Original' }, 'stale-notice');
  await plugin.patchTask(initial, { when: 'today' });
  messages.length = 0;
  await plugin.patchTask(initial, { title: 'New title' });
  assert.deepEqual(
    messages,
    [],
    'A title edit must not announce an unrelated prior schedule change',
  );
});
