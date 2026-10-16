const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectProgress } = require('../plugin/project-progress.cjs');
const { settings } = require('../plugin/archive-policy.cjs');
test('progress counts unique task references including logged completions, excluding trash, templates and code', () => {
  const task = (id, meta = {}) => ({
    file: { path: `.thingsmd-storage/${id}.md` },
    meta: { type: 'things-task', ...meta },
  });
  const note = {
    file: { path: 'Project.md' },
    meta: { type: 'things-project' },
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
