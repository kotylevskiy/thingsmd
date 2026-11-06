const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture({ storageExists = true } = {}) {
  const filename = require.resolve('../plugin/tasks/task-store.cjs');
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
      workspace: { getLeavesOfType: () => [] },
      vault: {
        adapter: {
          exists: async (path) => (path === 'ThingsMD' ? storageExists : files.has(path)),
          mkdir: async () => {
            // Yield before checking: two uncoordinated creators both see an
            // absent directory, but the second mkdir must fail on a real disk.
            await Promise.resolve();
            if (storageExists) throw Error('Directory already exists');
            storageExists = true;
          },
          list: async () => ({
            files: [...files.keys()].filter((path) => path.startsWith('ThingsMD/')),
          }),
          read: async (path) => {
            if (!files.has(path)) throw Error('Missing file');
            return files.get(path);
          },
          write: async (path, text) => files.set(path, text),
        },
        getMarkdownFiles: () =>
          [...files.keys()].map((path) => ({ path, basename: path.slice(0, -3) })),
        read: async (file) => files.get(file.path),
      },
    },
  };
  module.exports(plugin);
  require('../plugin/tasks/task-actions.cjs')(plugin);
  return { plugin, files };
}

test('placement ignores fenced, inline and frontmatter examples but indexes real references', async () => {
  const { plugin, files } = fixture();
  const task = await plugin.createTask({ title: 'Example' }, 'example');
  files.set(
    'Examples.md',
    '---\n{"example":"![[ThingsMD/example]]"}\n---\n````md\n```\n![[ThingsMD/example]]\n````\nInline ![[ThingsMD/example]]\n',
  );
  files.set('Project.md', 'Before\n![[ThingsMD/example.md]]\nAfter\n');
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

test('simultaneous first captures share folder initialization without losing a task', async () => {
  const { plugin } = fixture({ storageExists: false });
  await Promise.all([
    plugin.createTask({ title: 'First capture' }, 'first'),
    plugin.createTask({ title: 'Second capture' }, 'second'),
    plugin.createTask({ title: 'Third capture' }, 'third'),
  ]);
  assert.deepEqual(
    Array.from(await plugin.taskRecords(), (task) => task.meta.id),
    ['first', 'second', 'third'],
  );
  assert.equal(plugin.taskQueue.pending.size, 0);
});

test('failed storage initialization surfaces the error and allows the next capture to retry', async () => {
  const { plugin } = fixture({ storageExists: false });
  const adapter = plugin.app.vault.adapter,
    mkdir = adapter.mkdir;
  adapter.mkdir = async () => {
    throw Error('Permission denied');
  };
  await assert.rejects(plugin.createTask({ title: 'Failed' }, 'failed'), /Permission denied/);
  assert.equal(plugin.taskQueue.pending.size, 0);
  adapter.mkdir = mkdir;
  const saved = await plugin.createTask({ title: 'Retry' }, 'retry');
  assert.equal(saved.meta.title, 'Retry');
});

test('storage removed before directory listing is skipped; existing-folder errors surface', async () => {
  const { plugin } = fixture();
  const adapter = plugin.app.vault.adapter;
  adapter.list = async () => {
    adapter.exists = async () => false;
    throw Error('Directory disappeared');
  };
  assert.equal((await plugin.taskRecords()).length, 0);
  adapter.exists = async () => true;
  adapter.list = async () => {
    throw Error('Permission denied');
  };
  await assert.rejects(plugin.taskRecords(), /Permission denied/);
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
  files.set('Removed.md', '![[ThingsMD/keep]]');
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
  const { moveMessage } = require('../plugin/tasks/move-notice.cjs');
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

test('placement follows unsaved note references and does not reread known task files', async () => {
  const { plugin, files } = fixture();
  const task = await plugin.createTask({ title: 'Buffered placement' }, 'buffered');
  files.set('Project.md', 'Old on-disk prose');
  plugin.app.workspace.getLeavesOfType = () => [
    {
      view: {
        file: { path: 'Project.md' },
        getMode: () => 'source',
        editor: { getValue: () => `Unsaved prose\n![[${task.file.path}]]\n` },
      },
    },
  ];
  const read = plugin.app.vault.read;
  plugin.app.vault.read = (file) => {
    assert.notEqual(file.path, task.file.path, 'Task file was already scanned');
    return read(file);
  };
  const records = await plugin.records();
  assert.deepEqual(Array.from(records.find((t) => t.meta.id === 'buffered').references), [
    'Project.md',
  ]);
  assert.equal(files.get('Project.md'), 'Old on-disk prose');
});

test('duplicate IDs elect one active task and preserve extra copies through updates', async () => {
  const { plugin, files } = fixture();
  const task = await plugin.createTask({ title: 'Selected', when: 'today' }, 'identity');
  const copyPath = 'ThingsMD/a.md';
  const copyText = files.get(task.file.path).replace('Selected', 'Offline draft');
  files.set(copyPath, copyText);
  files.set('Other project.md', `Prose\n![[${copyPath}]]\n`);
  const selected = (await plugin.records()).find((r) => r.meta.id === 'identity');
  assert.equal(selected.file.path, task.file.path);
  assert.equal(selected.conflicts[0].body, task.body);
  assert.deepEqual(Array.from(selected.conflicts[0].references), ['Other project.md']);
  await plugin.patchTask(selected, { title: 'Updated' });
  assert.equal(files.get(copyPath), copyText);
  await assert.rejects(
    plugin.patchTask(selected.conflicts[0], { title: 'Do not save' }),
    /extra copy/,
  );
  await assert.rejects(plugin.deleteTask(copyPath), /extra copy/);
  assert.equal(files.get(copyPath), copyText);
  files.delete(copyPath);
  assert.equal((await plugin.taskRecords())[0].conflicts, undefined);
});

test('a preferred copy arriving during a save preserves the losing draft and both files', async () => {
  const { plugin, files } = fixture();
  const original = await plugin.createTask({ title: 'Existing' }, 'arrival');
  const copyPath = 'ThingsMD/Offline copy.md';
  const text = files.get(original.file.path);
  files.set(copyPath, text);
  files.delete(original.file.path);
  const task = (await plugin.taskRecords())[0];
  const read = plugin.readTask;
  let arrived = false;
  plugin.readTask = async function (file) {
    const current = await read.call(this, file);
    if (!arrived) {
      arrived = true;
      files.set(original.file.path, text.replace('Existing', 'Remote'));
    }
    return current;
  };
  await assert.rejects(plugin.patchTask(task, { title: 'Unsaved local draft' }), /extra copy/);
  assert.equal(files.get(copyPath), text);
  assert.match(files.get(original.file.path), /Remote/);
});

test('creation cannot duplicate an identity whose only document has a different filename', async () => {
  const { plugin, files } = fixture();
  const task = await plugin.createTask({ title: 'Existing' }, 'renamed');
  files.set('ThingsMD/Custom filename.md', files.get(task.file.path));
  files.delete(task.file.path);
  await assert.rejects(plugin.createTask({ title: 'Duplicate' }, 'renamed'), /already exists/);
  assert.equal(files.size, 1);
});

test('recurrence follows the selected completed occurrence and leaves stale copies untouched', async () => {
  const { plugin, files } = fixture();
  plugin.settings = { timeZone: 'UTC', logbook: 'daily', trashRetention: 'never' };
  require('../plugin/tasks/repeat-engine.cjs')(plugin);
  const rule = {
    mode: 'completion',
    unit: 'day',
    interval: 1,
    anchor: '2026-11-05',
    next: null,
    waitingFor: 'previous',
    lastCopy: 'previous',
    on: [],
    end: null,
    deadline: false,
    leadDays: 0,
    epoch: 'epoch',
    paused: false,
  };
  const template = await plugin.createTask({ title: 'Routine', repeat: rule }, 'routine');
  const previous = await plugin.createTask(
    {
      title: 'Routine',
      status: 'done',
      when: '2026-11-05',
      completed: '2026-11-05T12:00:00.000Z',
      repeatSource: 'routine',
    },
    'previous',
  );
  const templateCopy = 'ThingsMD/Routine copy.md';
  const previousCopy = 'ThingsMD/Previous copy.md';
  files.set(templateCopy, files.get(template.file.path));
  files.set(previousCopy, files.get(previous.file.path).replace('"done"', '"todo"'));
  const before = [files.get(templateCopy), files.get(previousCopy)];
  await plugin.repeating.tick(new Date('2026-11-06T12:00:00.000Z'));
  const tasks = await plugin.taskRecords();
  const next = tasks.filter((task) => task.meta.id === 'repeat-routine-epoch-2026-11-06');
  assert.equal(next.length, 1);
  assert.equal(
    tasks.find((task) => task.meta.id === 'routine').meta.repeat.waitingFor,
    next[0].meta.id,
  );
  assert.deepEqual([files.get(templateCopy), files.get(previousCopy)], before);
});
