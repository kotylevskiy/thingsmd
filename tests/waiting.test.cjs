const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { inList } = require('../plugin/model.cjs');
const { settings } = require('../plugin/archive-policy.cjs');
test('waiting is independent of scheduling, excluded from actionable lists, and respects archives', () => {
  const t = { meta: { is_waiting: true, status: 'todo' }, references: [] },
    d = '2026-10-16';
  assert.ok(inList(t, 'waiting', d));
  for (const l of ['inbox', 'anytime', 'today']) assert.equal(inList(t, l, d), false);
  t.meta.when = 'today';
  assert.ok(inList(t, 'today', d));
  assert.ok(inList(t, 'waiting', d));
  t.meta.when = '2026-10-17';
  assert.ok(inList(t, 'upcoming', d));
  assert.equal(inList(t, 'today', d), false);
  t.meta.loggedAt = d;
  t.meta.status = 'done';
  assert.equal(inList(t, 'waiting', d), false);
  assert.ok(inList(t, 'logbook', d));
  t.meta.deleted = true;
  assert.equal(inList(t, 'waiting', d), false);
  assert.ok(inList(t, 'trash', d));
});
test('Today waiting grouping defaults on and can be disabled', () => {
  assert.equal(settings().showWaitingInToday, true);
  assert.equal(settings({ showWaitingInToday: false }).showWaitingInToday, false);
});

test('Waiting For is enabled by default and only an explicit false disables it', () => {
  for (const data of [undefined, {}, { showWaitingInToday: false }, { enableWaiting: 'false' }])
    assert.equal(settings(data).enableWaiting, true);
  assert.equal(settings({ enableWaiting: false }).enableWaiting, false);
});

test('disabled waiting follows ordinary list policies without changing task metadata', () => {
  const day = '2026-10-17';
  for (const capture of ['inbox', 'daily-note'])
    for (const fields of [
      {},
      { project: 'Work.md' },
      { when: 'today' },
      { when: 'anytime' },
      { when: 'someday' },
      { when: '2026-10-20', deadline: '2026-10-18' },
      { deadline: '2026-10-17' },
      { repeat: { next: '2026-10-20' }, when: '2026-10-20' },
      { status: 'done', loggedAt: '2026-10-16' },
      { deleted: true },
    ]) {
      const task = { meta: { status: 'todo', ...fields, is_waiting: true } };
      const before = JSON.stringify(task);
      for (const list of [
        'inbox',
        'today',
        'upcoming',
        'anytime',
        'someday',
        'repeating',
        'logbook',
        'trash',
      ])
        assert.equal(
          inList(task, list, day, 'daily', capture, false),
          inList({ meta: { ...task.meta, is_waiting: false } }, list, day, 'daily', capture),
          `${capture}: ${list}: ${before}`,
        );
      assert.equal(inList(task, 'waiting', day, 'daily', capture, false), false);
      assert.equal(JSON.stringify(task), before);
    }
});
