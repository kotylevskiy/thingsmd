const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../plugin/tasks/task-capture.cjs');
const localRequire = createRequire(filename);
const stub = { exports: {} };
class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = { querySelectorAll: () => [], empty() {} };
  }
  close() {
    this.closed = true;
    this.onClose();
  }
}
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module: stub,
  document: { activeElement: null },
  require: (name) =>
    name === 'obsidian'
      ? { Modal }
      : ['./task-editor.cjs', '../shared/dom.cjs'].includes(name)
        ? {}
        : localRequire(name),
});
function fixture(body = '') {
  const writes = [];
  const plugin = {
    app: { workspace: {} },
    captureDestination: async () => null,
    createTask: async (fields, id, body = '') => {
      const task = { meta: { ...fields, id: 'new' }, body };
      writes.push(task);
      return task;
    },
  };
  const modal = new stub.exports(plugin, {}, body);
  modal.card = {
    taskDraft: {
      values: { title: 'Captured', is_waiting: true, when: 'today', checklist: [] },
    },
  };
  return { modal, writes };
}
test('dismissing a populated capture discards it without writing a task', () => {
  const { modal, writes } = fixture();
  assert.equal(modal.close(), true);
  assert.equal(modal.closed, true);
  assert.equal(writes.length, 0);
});
test('a description-only capture saves the exact Markdown body separately from metadata', async () => {
  const body = 'From **another app**.\n\n[Source](https://example.com/?a=1&b=2)';
  const { modal, writes } = fixture(body);
  modal.card.taskDraft.values.title = '';
  await modal.save();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].meta.title, '');
  assert.equal(writes[0].meta.description, undefined);
  assert.equal(writes[0].body, body);
});
test('explicit save preserves capture fields and prevents duplicate concurrent writes', async () => {
  const { modal, writes } = fixture();
  await Promise.all([modal.save(), modal.save()]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].meta.is_waiting, true);
  assert.equal(writes[0].meta.when, 'today');
  assert.equal(writes[0].body, '');
  assert.equal(modal.closed, true);
});
test('saving an empty capture leaves no task behind', async () => {
  const { modal, writes } = fixture();
  modal.card.taskDraft.values.title = '';
  await modal.save();
  assert.equal(writes.length, 0);
  assert.equal(modal.closed, true);
});

test('checklist-only capture saves an empty title without inventing replacement text', async () => {
  const { modal, writes } = fixture();
  modal.card.taskDraft.values.title = '   ';
  modal.card.taskDraft.values.checklist = [{ text: 'Checklist only', done: false }];
  await modal.save();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].meta.title, '');
  assert.equal(writes[0].body, '');
});

test('opening notes creates exactly one file even before a title is entered', async () => {
  const { modal, writes } = fixture();
  modal.card.taskDraft.values.title = '';
  await Promise.all([modal.save({ forNotes: true }), modal.save({ forNotes: true })]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].meta.title, '');
  assert.equal(writes[0].meta.when, 'today');
  assert.equal(modal.createdTask, writes[0]);
  assert.equal(modal.closed, true);
});
