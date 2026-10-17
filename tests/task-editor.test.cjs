const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../plugin/task-editor.cjs'),
  localRequire = createRequire(filename);
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module: moduleStub,
  setTimeout,
  clearTimeout,
  require: (name) => (name === 'obsidian' ? {} : name === './dom.cjs' ? {} : localRequire(name)),
});
const TaskEditor = moduleStub.exports;
test('closing an editor drains edits arriving during multiple consecutive writes', async () => {
  const saved = [];
  let closed = false;
  const plugin = {
    app: {},
    patchTask: async (task, patch) => {
      saved.push(patch.title);
      if (saved.length < 4) {
        editor.taskDraft.values.title = 'Edit ' + (saved.length + 1);
        editor.taskDraft.dirty = true;
      }
      await Promise.resolve();
      return { ...task, meta: { ...task.meta, ...patch } };
    },
  };
  const editor = new TaskEditor(plugin, { querySelector: () => null }, async () => {
    closed = true;
  });
  editor.taskDraft = {
    task: { meta: { title: 'Original' }, body: '' },
    values: { title: 'Edit 1' },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.finishTask(), true);
  assert.deepEqual(saved, ['Edit 1', 'Edit 2', 'Edit 3', 'Edit 4']);
  assert.equal(editor.taskDraft, null);
  assert.equal(closed, true);
});

test('provisional tasks do not write an unchanged false waiting flag', async () => {
  let written;
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        written = patch;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: { meta: { title: '' }, body: '' },
    values: { title: 'Created in a note', is_waiting: false },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(written)), { title: 'Created in a note' });
});

test('clearing a title saves an empty title and other edits without trapping the editor', async () => {
  let written,
    closed = false;
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch, body) => {
        written = { patch, body };
        return { ...task, meta: { ...task.meta, ...patch }, body };
      },
    },
    { querySelector: () => null },
    async () => {
      closed = true;
    },
  );
  editor.taskDraft = {
    task: { meta: { title: 'Original' }, body: 'Old notes' },
    values: { title: '   ' },
    body: 'New notes',
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true, 'Autosave accepts a blank title');
  assert.equal(await editor.finishTask(), true);
  assert.equal(closed, true);
  assert.equal(editor.editing, false);
  assert.equal(editor.taskDraft, null);
  assert.deepEqual(JSON.parse(JSON.stringify(written)), {
    patch: { title: '' },
    body: 'New notes',
  });
});

test('closing a new inline task leaves its empty title unchanged', async () => {
  let title;
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        title = patch.title;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: { meta: { title: '' }, body: '' },
    values: { title: '' },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.finishTask(), true);
  assert.equal(title, undefined, 'No replacement title is written');
});

test('concurrent blur and navigation close once, cancel gestures and publish the saved task', async () => {
  let release,
    closes = 0,
    canceled = 0,
    writes = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        writes++;
        await gate;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
    async (render, task) => {
      closes++;
      assert.equal(task.meta.title, 'Saved title');
    },
  );
  editor.taskDraft = {
    task: { meta: { title: 'Original' }, body: '' },
    values: { title: 'Saved title' },
    body: '',
    dirty: true,
  };
  editor.cancelChecklistDrag = () => {
    canceled++;
  };
  const blur = editor.finishTask();
  const navigation = editor.finishTask(false);
  release();
  assert.deepEqual(await Promise.all([blur, navigation]), [true, true]);
  assert.equal(writes, 1);
  assert.equal(closes, 1);
  assert.equal(canceled, 1);
  assert.equal(editor.taskDraft, null);
});

test('a cancelled schedule is reconciled before the next autosave', async () => {
  const writes = [];
  const meta = {
    title: 'Original',
    when: 'today',
    evening: '2026-10-17',
    deadline: '2026-10-16',
    deadlineDeferredOn: null,
  };
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        writes.push(patch);
        return { ...task, meta: { ...meta, title: patch.title || meta.title } };
      },
    },
    { querySelector: () => null },
  );
  let badges = 0;
  editor.taskDraft = {
    task: { meta, body: '' },
    values: {
      ...meta,
      when: 'someday',
      evening: null,
      deadlineDeferredOn: '2026-10-17',
    },
    body: '',
    dirty: true,
    drawBadges: () => badges++,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  for (const key of ['when', 'evening', 'deadline', 'deadlineDeferredOn'])
    assert.equal(editor.taskDraft.values[key], meta[key]);
  assert.equal(badges, 1);
  editor.taskDraft.values.title = 'New title';
  editor.taskDraft.dirty = true;
  assert.equal(await editor.saveTaskDraft(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[1])), { title: 'New title' });
});

test('schedule reconciliation preserves newer dates entered during a save', async () => {
  const schedule = {
    when: '2099-01-01',
    evening: null,
    deadline: null,
    deadlineDeferredOn: null,
  };
  const newer = { ...schedule, when: '2099-02-01', evening: '2099-02-01' };
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        Object.assign(editor.taskDraft.values, newer);
        editor.taskDraft.dirty = true;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: { meta: { title: 'Task', ...schedule, when: 'anytime' }, body: '' },
    values: { title: 'Task', ...schedule },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  for (const [key, value] of Object.entries(newer))
    assert.equal(editor.taskDraft.values[key], value);
  assert.equal(editor.taskDraft.dirty, true);
});
