const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { inList } = require('../plugin/tasks/model.cjs');
const { settings } = require('../plugin/settings/settings-model.cjs');
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

test('Waiting For shows recurring copies but excludes scheduled, paused and waiting templates', () => {
  const day = '2026-10-16';
  for (const mode of ['regular', 'completion']) {
    for (const rule of [
      { next: '2026-10-17' },
      { next: '2026-10-17', paused: true },
      { next: null, waitingFor: 'copy' },
      { next: null },
    ]) {
      const template = {
        meta: {
          id: 'template',
          status: 'todo',
          is_waiting: true,
          when: '2026-10-17',
          repeat: { mode, ...rule },
        },
      };
      assert.equal(inList(template, 'waiting', day), false);
      assert.equal(inList(template, 'repeating', day), true);
      assert.equal(inList(template, 'upcoming', day), !!rule.next && !rule.paused);
      for (const list of ['inbox', 'today', 'anytime', 'someday'])
        assert.equal(inList(template, list, day), false);
    }
  }
  const copy = {
    meta: { status: 'todo', repeatSource: 'template', is_waiting: true, when: '2026-10-17' },
  };
  assert.equal(inList(copy, 'waiting', day), true);
  assert.equal(inList(copy, 'upcoming', day), true);
  assert.equal(inList(copy, 'waiting', '2026-10-17'), true);
  assert.equal(inList(copy, 'today', '2026-10-17'), true);
});

test('Waiting For defaults off and preserves explicit preferences', () => {
  for (const data of [
    undefined,
    null,
    {},
    { showWaitingInToday: false },
    { enableWaiting: 'true' },
  ])
    assert.equal(settings(data).enableWaiting, false);
  assert.equal(settings({ enableWaiting: false }).enableWaiting, false);
  assert.equal(settings({ enableWaiting: true }).enableWaiting, true);
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
