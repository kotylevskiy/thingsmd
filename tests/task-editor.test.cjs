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
