const test = require('node:test');
const assert = require('node:assert/strict');
const { selectTaskVersions, conflictsMatching } = require('../plugin/tasks/task-identity.cjs');
const { inList } = require('../plugin/tasks/model.cjs');
const record = (path, id = 'long-task-id', meta = {}) => ({
  file: { path },
  meta: { type: 'thingsmd-task', id, title: 'Task', status: 'todo', ...meta },
  body: 'Keep the notes\n',
});

test('an exact task-ID filename wins even over a shorter manually named copy', () => {
  const files = [record('ThingsMD/a.md'), record('ThingsMD/long-task-id.md')];
  for (const order of [files, [...files].reverse()]) {
    const [selected] = selectTaskVersions(order);
    assert.equal(selected.file.path, 'ThingsMD/long-task-id.md');
    assert.deepEqual(selected.conflicts, [files[0]]);
  }
  assert.equal(files[1].conflicts, undefined, 'Selection does not mutate inputs');
});

test('provider-independent names choose the shortest basename with deterministic ties', () => {
  const files = [
    record('A/task (conflicted copy person 2026-11-06).md'),
    record('A/task.sync-conflict-20261106-device.md'),
    record('A/task_Computer_20261106_Conflict.md'),
    record('A/task (2).md'),
    record('Long folder/Zeta.md'),
    record('B/Alfa.md'),
    record('Long folder/Alfa.md'),
  ];
  for (let shift = 0; shift < files.length; shift++) {
    const [selected] = selectTaskVersions([...files.slice(shift), ...files.slice(0, shift)]);
    assert.equal(selected.file.path, 'B/Alfa.md');
    assert.equal(selected.conflicts.length, files.length - 1);
  }
});

test('same titles and missing or malformed IDs never collapse unrelated documents', () => {
  const records = [
    record('a.md', 'one'),
    record('b.md', 'two'),
    record('c.md', ''),
    record('d.md', ''),
    record('e.md', null),
    record('f.md', null),
  ];
  assert.equal(selectTaskVersions(records).length, records.length);
});

test('a view warns when only the ignored version would belong to that list', () => {
  const selected = record('ThingsMD/long-task-id.md', 'long-task-id', {
    status: 'done',
    completed: '2026-11-05T10:00:00.000Z',
    loggedAt: '2026-11-05T10:00:00.000Z',
  });
  const extra = record('ThingsMD/Copy.md', 'long-task-id', { when: 'today' });
  const tasks = selectTaskVersions([extra, selected]);
  const matches = (list) => (task) => inList(task, list, '2026-11-06');
  assert.equal(tasks.filter(matches('today')).length, 0);
  assert.equal(conflictsMatching(tasks, matches('today')).length, 1);
  assert.equal(conflictsMatching(tasks, matches('logbook')).length, 1);
  assert.equal(conflictsMatching(tasks, matches('someday')).length, 0);
});

test('selection recovers after copies disappear and retains identical duplicate evidence', () => {
  const original = record('ThingsMD/long-task-id.md');
  const copy = record('ThingsMD/Copy.md');
  assert.equal(selectTaskVersions([original, copy])[0].conflicts.length, 1);
  assert.equal(selectTaskVersions([original])[0].conflicts, undefined);
  assert.equal(selectTaskVersions([copy])[0].file.path, copy.file.path);
});
