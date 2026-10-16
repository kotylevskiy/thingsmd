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
