const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectProgress } = require('../plugin/project-progress.cjs');
const { settings } = require('../plugin/settings-model.cjs');
test('progress counts unique task references including logged completions, excluding trash, templates and code', () => {
  const task = (id, meta = {}) => ({
    file: { path: `.thingsmd-storage/${id}.md` },
    meta: { type: 'thingsmd-task', ...meta },
  });
  const note = {
    file: { path: 'Project.md' },
    meta: { type: 'thingsmd-project' },
    body: '![[.thingsmd-storage/a]]\n![[.thingsmd-storage/a.md]]\n![[.thingsmd-storage/b]]\n![[.thingsmd-storage/trash]]\n![[.thingsmd-storage/template]]\n```\n![[.thingsmd-storage/code]]\n```\n',
  };
  const records = [
    note,
    task('a'),
    task('b', { status: 'done', loggedAt: '2026-01-01' }),
    task('trash', { deleted: true }),
    task('template', { repeat: {} }),
    task('code'),
  ];
  assert.deepEqual(projectProgress(records).get('Project.md'), { total: 2, done: 1 });
  assert.equal(projectProgress([{ ...note, body: 'Empty' }]).size, 0);
  assert.equal(settings().showProjectProgress, true);
  assert.equal(settings({ showProjectProgress: false }).showProjectProgress, false);
});

test('Things screenshot parity: canceled tasks advance project progress', () => {
  for (const [statuses, done] of [
    [['canceled', 'todo'], 1],
    [['canceled', 'done'], 2],
    [['todo', 'done'], 1],
  ]) {
    const records = statuses.map((status, i) => ({
      file: { path: `task${i}.md` },
      meta: { type: 'thingsmd-task', status },
    }));
    records.push({
      file: { path: 'Project.md' },
      meta: { type: 'thingsmd-project' },
      body: '![[task0]]\n![[task1]]',
    });
    assert.deepEqual(projectProgress(records).get('Project.md'), { total: 2, done });
  }
});
