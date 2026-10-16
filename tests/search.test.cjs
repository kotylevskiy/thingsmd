const { test } = require('node:test');
const assert = require('node:assert/strict');
const { search } = require('../plugin/search-model.cjs');
const task = (id, meta = {}, body = '') => ({
  file: { path: '.thingsmd-storage/' + id + '.md' },
  meta: { id, type: 'things-task', title: id, ...meta },
  body,
});
const opts = { today: '2026-10-16', settings: { logbook: 'daily' } };
test('Quick Find separates fast search from body/checklist/Logbook and excludes Trash', () => {
  const rows = [
    task('active', {}, 'secret'),
    task('check', { checklist: [{ text: 'secret' }] }),
    task('logged', { status: 'done', loggedAt: '2026-10-15' }, 'secret'),
    task('deleted', { deleted: true }, 'secret'),
  ];
  assert.equal(search(rows, 'secret', opts).length, 0);
  assert.deepEqual(
    search(rows, 'secret', { ...opts, broad: true })
      .map((r) => r.id)
      .sort(),
    ['active', 'check', 'logged'],
  );
});
test('Quick Find includes project navigation and preserves each reference context', () => {
  const p = { file: { path: 'Trip.md' }, meta: { type: 'things-project', title: 'Trip' } };
  const t = task('Tickets');
  t.references = ['Trip.md', 'Other.md'];
  const rows = [p, t];
  assert.equal(search(rows, 'Trip', opts)[0].kind, 'project');
  assert.deepEqual(
    search(rows, 'Tickets', opts).map((r) => r.path),
    ['Trip.md', 'Other.md'],
  );
});
test('Quick Find respects hidden Inbox/Trash and ranks exact titles first', () => {
  assert.ok(
    !search([], '', {
      ...opts,
      settings: { captureDestination: 'daily-note', trashRetention: 'immediately' },
    }).some((r) => ['inbox', 'trash'].includes(r.page)),
  );
  assert.equal(search([task('train'), task('train tickets')], 'train', opts)[0].title, 'train');
});
