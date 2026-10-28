const { test } = require('node:test');
const assert = require('node:assert/strict');
const install = require('../plugin/tasks/task-actions.cjs');
const { today, dayAfter } = require('../plugin/shared/local-date.cjs');
const { inToday } = require('../plugin/tasks/model.cjs');
function fixture(patch = {}, fields = {}) {
  const task = {
    file: { path: 'task.md' },
    meta: {
      id: 'a',
      title: 'Approval',
      status: 'done',
      completed: '2026-10-16T12:00:00Z',
      loggedAt: null,
      is_waiting: true,
      ...fields,
    },
    body: 'Keep these notes.',
  };
  let stored = { meta: { ...task.meta, ...patch }, body: task.body };
  const plugin = {
    update: async (file, change) => {
      stored = change(stored);
      return stored;
    },
  };
  install(plugin);
  return { plugin, task, get: () => stored };
}
test('Restore tolerates an intervening automatic archive stamp and preserves task data', async () => {
  const { plugin, task, get } = fixture({ loggedAt: '2026-10-17T12:00:00Z' });
  await plugin.restoreTask(task, true);
  assert.equal(get().meta.status, 'todo');
  assert.equal(get().meta.completed, null);
  assert.equal(get().meta.loggedAt, null);
  assert.equal(get().meta.is_waiting, true);
  assert.equal(get().body, task.body);
});
test('Restore still rejects an intervening completion change', async () => {
  for (const changed of [{ status: 'todo' }, { completed: '2026-10-17T12:00:00Z' }]) {
    const { plugin, task, get } = fixture(changed);
    const before = JSON.stringify(get());
    await assert.rejects(plugin.restoreTask(task, true), /changed elsewhere/);
    assert.equal(JSON.stringify(get()), before);
  }
});
test('ordinary edits still reject conflicting content and explicit logging changes', async () => {
  for (const [current, patch] of [
    [{ title: 'External title' }, { title: 'Draft title' }],
    [{ loggedAt: '2026-10-17T12:00:00Z' }, { loggedAt: '2026-10-18T12:00:00Z' }],
  ]) {
    const { plugin, task, get } = fixture(current);
    const before = JSON.stringify(get());
    await assert.rejects(plugin.patchTask(task, patch), /changed elsewhere/);
    assert.equal(JSON.stringify(get()), before);
  }
});

test('cancelled repeat rescheduling preserves placement while saving unrelated edits', async () => {
  for (const repeat of [{ repeatSource: 'template' }, { repeat: { mode: 'regular' } }]) {
    const { plugin, task, get } = fixture(
      {},
      {
        ...repeat,
        when: 'today',
        evening: today(),
        deadline: dayAfter(-1),
        deadlineDeferredOn: null,
      },
    );
    plugin.chooseRepeatReschedule = async () => 'cancel';
    plugin.taskRecords = async () => [{ meta: { id: 'template', repeat: { mode: 'regular' } } }];
    await plugin.patchTask(task, {
      title: 'Updated notes requested',
      when: 'someday',
      evening: null,
      // The editor can already have derived this field for its draft preview.
      deadlineDeferredOn: today(),
    });
    assert.equal(get().meta.when, 'today');
    assert.equal(get().meta.evening, today());
    assert.equal(get().meta.deadlineDeferredOn, null);
    assert.equal(get().meta.deadline, task.meta.deadline);
    assert.equal(get().meta.title, 'Updated notes requested');
    assert.equal(inToday(get().meta, today()), true);
  }
});

test('cancelling a repeat-copy move keeps deadline-driven Today membership', async () => {
  const { plugin, task, get } = fixture(
    {},
    {
      repeatSource: 'template',
      status: 'todo',
      completed: null,
      when: 'anytime',
      deadline: dayAfter(-1),
      deadlineDeferredOn: null,
    },
  );
  plugin.chooseRepeatReschedule = async () => 'cancel';
  plugin.taskRecords = async () => [{ meta: { id: 'template', repeat: { mode: 'regular' } } }];
  assert.equal(inToday(task.meta, today()), true);
  await plugin.patchTask(task, { when: 'someday' });
  assert.equal(get().meta.when, 'anytime');
  assert.equal(get().meta.deadlineDeferredOn, null);
  assert.equal(inToday(get().meta, today()), true);
});

test('cancellation records finish time, preserves content and can be reopened', async () => {
  const { plugin, task, get } = fixture({}, { status: 'todo', completed: null });
  await plugin.patchTask(task, { status: 'canceled' });
  assert.equal(get().meta.status, 'canceled');
  assert.ok(Number.isFinite(Date.parse(get().meta.completed)));
  assert.equal(get().body, task.body);
  await plugin.restoreTask({ ...task, ...get() }, true);
  assert.equal(get().meta.status, 'todo');
  assert.equal(get().meta.completed, null);
});
test('cancellation rejects conflicting external status without overwriting it', async () => {
  const { plugin, task, get } = fixture({ status: 'done' }, { status: 'todo' });
  await assert.rejects(plugin.patchTask(task, { status: 'canceled' }), /changed elsewhere/);
  assert.equal(get().meta.status, 'done');
});

test('Trash restoration retains cancellation instead of reopening it', async () => {
  const { plugin, task, get } = fixture(
    {},
    { status: 'canceled', deleted: true, deletedAt: '2026-10-19' },
  );
  await plugin.restoreTask(task);
  assert.equal(get().meta.status, 'canceled');
  assert.equal(get().meta.completed, task.meta.completed);
  assert.equal(get().meta.deleted, null);
});
