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
