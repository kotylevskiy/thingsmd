const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { WriteQueue } = require('../plugin/write-queue.cjs');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync('plugin/list-view.cjs', 'utf8'), {
  module: mod,
  require: (name) => (name === 'obsidian' ? { ItemView: class {}, Notice: class {} } : {}),
});

test('actions selected during a preceding list refresh run in order instead of being discarded', async () => {
  let release, rendered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const visible = new Promise((resolve) => {
    rendered = resolve;
  });
  const actions = [];
  const view = {
    actionQueue: new WriteQueue(),
    render: async () => {
      if (actions.length === 1) {
        rendered();
        await gate;
      }
    },
  };
  const run = mod.exports.prototype.run.bind(view);
  const first = run(async () => {
    actions.push('Restore from Trash');
  });
  await visible;
  const second = run(async () => {
    actions.push('Reopen from Logbook');
  });
  assert.equal(view.busy, true);
  assert.deepEqual(actions, ['Restore from Trash']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(actions, ['Restore from Trash', 'Reopen from Logbook']);
  assert.equal(view.busy, false);
  assert.equal(view.actionQueue.pending.size, 0);
});

test('a finishing list action preserves an editor opened during its write', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const saving = new Promise((resolve) => {
    started = resolve;
  });
  const draft = { title: 'Unsaved title', body: 'Unsaved notes' };
  const view = {
    actionQueue: new WriteQueue(),
    editing: false,
    render: async () => {
      assert.equal(view.editing, true, 'The renderer must retain its editing guard');
      assert.equal(view.taskDraft, draft);
    },
  };
  const action = mod.exports.prototype.run.call(view, async () => {
    started();
    await gate;
  });
  await saving;
  view.editing = true;
  view.taskDraft = draft;
  release();
  await action;
  assert.equal(view.editing, true);
  assert.equal(view.taskDraft, draft);
});
