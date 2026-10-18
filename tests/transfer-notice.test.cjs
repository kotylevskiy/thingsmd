const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../plugin/task-transfer.cjs');
const localRequire = createRequire(filename);
function fixture() {
  const module = { exports: {} };
  const notices = [];
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    document: { defaultView: {}, querySelectorAll: () => [] },
    require: (name) => (name === 'obsidian' ? { Notice: class {} } : localRequire(name)),
  });
  const copies = [];
  const notes = new Map([
    ['From.md', 'Before\n![[.thingsmd-storage/a.md]]\nAfter\n'],
    ['To.md', '# Destination\n'],
  ]);
  let task = {
    meta: { type: 'thingsmd-task', id: 'a', title: 'Move me', project: 'From.md' },
    file: { path: '.thingsmd-storage/a.md' },
    body: '',
  };
  const plugin = {
    app: {
      workspace: { getLeavesOfType: () => [] },
      metadataCache: { getFileCache: () => null },
      vault: {
        getAbstractFileByPath: (path) => (notes.has(path) ? { path, extension: 'md' } : null),
        getMarkdownFiles: () => [],
        read: async (file) => notes.get(file.path),
        process: async (file, callback) => notes.set(file.path, callback(notes.get(file.path))),
      },
    },
    records: async () => [
      {
        ...task,
        references: [...notes]
          .filter(([, text]) => text.includes(task.file.path))
          .map(([path]) => path),
      },
    ],
    createTask: async (fields, id, body) => {
      const copy = {
        meta: { ...fields, id: 'copy' },
        file: { path: '.thingsmd-storage/copy.md' },
        body,
      };
      copies.push(copy);
      return copy;
    },
    patchTask: async (before, patch, body, options) => {
      if (plugin.fail) throw Error('Simulated write conflict');
      task = { ...task, meta: { ...task.meta, ...patch } };
      if (options?.notify !== false) plugin.notifyTaskMove(before, task);
      return task;
    },
    notifyTaskMove: (...args) => notices.push(args),
    registerDomEvent() {},
    register() {},
    tasksChanged() {},
  };
  module.exports.install(plugin);
  return { plugin, notes, notices, copies };
}
test('a coordinated note move emits one notice after placement, with the actual destination', async () => {
  const { plugin, notes, notices } = fixture();
  await plugin.transferTask({ id: 'a', destination: 'To.md' });
  assert.equal(notices.length, 1);
  assert.equal(notices[0][2], 'To');
  assert.deepEqual(Array.from(notices[0][1].references), ['To.md']);
  assert.ok(!notes.get('From.md').includes('.thingsmd-storage/a.md'));
  assert.equal(
    require('../plugin/task-references.cjs').referenceRanges(
      notes.get('To.md'),
      '.thingsmd-storage/a.md',
    ).length,
    1,
  );
});
test('failed placement rolls back note edits and emits no success notice', async () => {
  const { plugin, notes, notices } = fixture();
  const original = [...notes];
  plugin.fail = true;
  await assert.rejects(plugin.transferTask({ id: 'a', destination: 'To.md' }), /write conflict/);
  assert.deepEqual([...notes], original);
  assert.equal(notices.length, 0);
});
test('moving back to Inbox removes note references and names Inbox once', async () => {
  const { plugin, notices } = fixture();
  await plugin.transferTask({ id: 'a', list: 'inbox' });
  assert.equal(notices.length, 1);
  assert.equal(notices[0][2], 'inbox');
  assert.deepEqual(Array.from(notices[0][1].references), []);
  assert.equal(notices[0][1].meta.project, null);
});

test('dropping or pasting into Upcoming requests a date without moving the task', async () => {
  const { plugin, notes, notices } = fixture();
  plugin.taskRecords = plugin.records;
  const requests = [];
  plugin.openUpcomingMove = async (source) => requests.push(source);
  const original = [...notes];
  await plugin.dropTaskOnList({ id: 'a' }, 'upcoming');
  await plugin.transferTask({ id: 'a', list: 'upcoming' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].id, 'a');
  assert.equal(requests[1].id, 'a');
  assert.deepEqual([...notes], original);
  assert.equal(notices.length, 0);
});

test('choosing a date after copying to Upcoming copies without rescheduling the source', async () => {
  const { plugin, copies, notices } = fixture();
  let request;
  plugin.openUpcomingMove = async (source) => {
    request = source;
  };
  await plugin.transferTask({ id: 'a', list: 'upcoming', copy: true });
  assert.equal(copies.length, 0, 'Nothing is created before choosing a date');
  await request.onSchedule('2099-06-15');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].meta.when, '2099-06-15');
  assert.equal(copies[0].meta.evening, null);
  assert.equal((await plugin.records())[0].meta.when, undefined);
  assert.equal(notices.length, 0);
});
test('confirmed Upcoming moves return the saved record', async () => {
  const { plugin } = fixture();
  let request;
  plugin.openUpcomingMove = async (source) => {
    request = source;
  };
  await plugin.transferTask({ id: 'a', list: 'upcoming' });
  const saved = await request.onSchedule('2099-06-15');
  assert.equal(saved.meta.when, '2099-06-15');
});

test('disabled waiting rejects its destination and preserves flags during normal moves and copies', async () => {
  const { plugin, notes, copies } = fixture();
  plugin.settings = { enableWaiting: false };
  await plugin.patchTask((await plugin.records())[0], { is_waiting: true });
  const before = [...notes];
  await assert.rejects(plugin.transferTask({ id: 'a', list: 'waiting' }), /disabled/);
  assert.deepEqual([...notes], before);
  for (const list of ['inbox', 'anytime']) {
    await plugin.transferTask({ id: 'a', list });
    assert.equal((await plugin.records())[0].meta.is_waiting, true);
    await plugin.transferTask({ id: 'a', list, copy: true });
    assert.equal(copies.at(-1).meta.is_waiting, true);
  }
});

test('a move waits for the source editor save before committing metadata', async () => {
  const { plugin, notes } = fixture();
  let buffer = notes.get('From.md'),
    release,
    saving;
  const entered = new Promise((resolve) => {
    saving = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const view = {
    file: { path: 'From.md' },
    getMode: () => 'source',
    editor: {
      getValue: () => buffer,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: (value, from, to) => {
        buffer = buffer.slice(0, from.ch) + value + buffer.slice(to.ch);
      },
    },
    save: async () => {
      saving();
      await gate;
      notes.set('From.md', buffer);
    },
  };
  plugin.app.workspace.getLeavesOfType = () => [{ view }];
  const move = plugin.transferTask({ id: 'a', destination: 'To.md' });
  await entered;
  assert.equal((await plugin.records())[0].meta.project, 'From.md');
  release();
  const saved = await move;
  assert.equal(saved.meta.project, 'To.md');
  assert.ok(!notes.get('From.md').includes('.thingsmd-storage/a.md'));
});
