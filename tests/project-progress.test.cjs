const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectProgress } = require('../plugin/tasks/project-progress.cjs');
const { settings } = require('../plugin/settings/settings-model.cjs');
test('progress counts indexed placements including logged completions and skips trash and templates', () => {
  const task = (id, meta = {}) => ({
    file: { path: `.thingsmd-storage/${id}.md` },
    meta: { type: 'thingsmd-task', ...meta },
    references: id === 'unfiled' ? [] : ['Project.md'],
  });
  const records = [
    task('a'),
    task('b', { status: 'done', loggedAt: '2026-01-01' }),
    task('trash', { deleted: true }),
    task('template', { repeat: {} }),
    task('unfiled'),
  ];
  assert.deepEqual(projectProgress(records).get('Project.md'), { total: 2, done: 1 });
  assert.equal(projectProgress([task('unfiled')]).size, 0);
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
      references: ['Project.md'],
    }));
    assert.deepEqual(projectProgress(records).get('Project.md'), { total: 2, done });
  }
});
