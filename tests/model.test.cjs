const { test } = require('node:test');
const assert = require('node:assert/strict');
const { insertionOrder } = require('../plugin/model.cjs');
test('ordering inserts before, between and after tasks without rewriting siblings', () => {
  const tasks = [{ meta: { id: 'a', order: 1024 } }, { meta: { id: 'b', order: 2048 } }];
  assert.equal(insertionOrder(tasks, 'a'), 0);
  assert.equal(insertionOrder(tasks, 'b'), 1536);
  assert.equal(insertionOrder(tasks, null), 3072);
  assert.throws(() => insertionOrder(tasks, 'missing'), /moved/);
});

test('Today is a persistent When choice; arriving dates and deadlines also qualify', () => {
  const { isTodayWhen, inToday } = require('../plugin/model.cjs');
  assert.equal(isTodayWhen('today', '2026-10-16'), true);
  assert.equal(isTodayWhen('today', '2026-10-17'), true);
  assert.equal(isTodayWhen('2026-10-17', '2026-10-16'), false);
  assert.equal(isTodayWhen('2026-10-17', '2026-10-17'), true);
  assert.equal(isTodayWhen('2026-10-17', '2026-10-18'), true);
  assert.equal(inToday({ when: null, deadline: '2026-10-16' }, '2026-10-16'), true);
  assert.equal(inToday({ when: null, deadline: '2026-10-17' }, '2026-10-16'), false);
  assert.equal(inToday({ when: 'today', deadline: '2026-11-01' }, '2026-10-16'), true);
});

test('Things list membership separates Inbox from planned or filed tasks', () => {
  const { inList, upcomingDates } = require('../plugin/model.cjs');
  const day = '2026-10-16';
  const lists = (task) =>
    ['inbox', 'today', 'upcoming', 'anytime', 'someday'].filter((list) => inList(task, list, day));
  assert.deepEqual(lists({ meta: {} }), ['inbox']);
  assert.deepEqual(lists({ meta: { project: 'An ordinary note.md' } }), ['anytime']);
  assert.deepEqual(lists({ meta: {}, references: ['A note.md'] }), ['anytime']);
  assert.deepEqual(lists({ meta: { when: 'today' } }), ['today', 'anytime']);
  assert.deepEqual(lists({ meta: { when: '2026-10-15' } }), ['today', 'anytime']);
  assert.deepEqual(lists({ meta: { when: '2026-10-20', project: 'Note.md' } }), ['upcoming']);
  assert.deepEqual(lists({ meta: { when: 'anytime' } }), ['anytime']);
  assert.deepEqual(lists({ meta: { when: 'someday', project: 'Note.md' } }), ['someday']);
  assert.deepEqual(lists({ meta: { deadline: '2026-10-20' } }), ['inbox']);
  assert.deepEqual(lists({ meta: { deadline: '2026-10-15' } }), ['today', 'anytime']);
  assert.deepEqual(upcomingDates({ when: '2026-10-20', deadline: '2026-10-20' }, day), [
    '2026-10-20',
  ]);
  assert.equal(inList({ meta: { when: '2026-10-20' } }, 'today', '2026-10-20'), true);
  assert.equal(inList({ meta: { when: '2026-10-20' } }, 'upcoming', '2026-10-20'), false);
});

test('Trash preserves status; completed tasks log on the next local day', () => {
  const { isHidden, isLogged, inList } = require('../plugin/model.cjs');
  const meta = {
    status: 'done',
    completed: new Date(2026, 9, 16, 23, 59).toISOString(),
    when: 'today',
  };
  assert.equal(isLogged(meta, '2026-10-16'), false);
  assert.equal(isHidden(meta, '2026-10-16'), false);
  assert.equal(inList({ meta }, 'today', '2026-10-16'), true);
  assert.equal(isLogged(meta, '2026-10-17'), true);
  assert.equal(inList({ meta }, 'today', '2026-10-17'), false);
  assert.equal(inList({ meta }, 'logbook', '2026-10-17'), true);
  const deleted = { ...meta, deleted: true };
  assert.equal(inList({ meta: deleted }, 'trash', '2026-10-17'), true);
  for (const list of ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook'])
    assert.equal(inList({ meta: deleted }, list, '2026-10-17'), false);
  assert.equal(isHidden({ ...meta, status: 'todo', completed: null }, '2026-10-17'), false);
  assert.equal(
    isLogged({ status: 'done' }, '2026-10-17'),
    true,
    'Legacy completed tasks without timestamps are logged',
  );
});

test('daily-note capture keeps existing Inbox tasks accessible in Anytime', () => {
  const { inList } = require('../plugin/model.cjs');
  const task = { meta: { status: 'todo' } };
  assert.equal(inList(task, 'anytime', '2026-10-16', 'daily', 'inbox'), false);
  assert.equal(inList(task, 'anytime', '2026-10-16', 'daily', 'daily-note'), true);
});

test('Evening belongs to Today and Anytime, and rolls into regular Today tomorrow', () => {
  const { inEvening, inList } = require('../plugin/model.cjs');
  const meta = { when: 'today', evening: '2026-10-16' };
  assert.equal(inEvening(meta, '2026-10-16'), true);
  assert.equal(inEvening(meta, '2026-10-17'), false);
  for (const day of ['2026-10-16', '2026-10-17']) {
    assert.equal(inList({ meta }, 'today', day), true);
    assert.equal(inList({ meta }, 'anytime', day), true);
    assert.equal(inList({ meta }, 'upcoming', day), false);
  }
});
test('Upcoming exposes seven calendar days plus later populated dates', () => {
  const { upcomingDays } = require('../plugin/model.cjs');
  assert.deepEqual(upcomingDays([{ meta: { when: '2027-02-01' } }], '2026-12-29'), [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
    '2027-01-04',
    '2027-01-05',
    '2027-02-01',
  ]);
});
test('start dates and deadlines remain independent at list boundaries', () => {
  const { inList } = require('../plugin/model.cjs'),
    day = '2026-10-16';
  const scheduled = { meta: { when: '2026-10-18', deadline: '2026-10-20' } };
  assert.equal(inList(scheduled, 'today', day), false);
  assert.equal(inList(scheduled, 'anytime', day), false);
  assert.equal(inList(scheduled, 'today', '2026-10-18'), true);
  assert.equal(inList(scheduled, 'anytime', '2026-10-18'), true);
  const cleared = { meta: { ...scheduled.meta, when: 'anytime' } };
  assert.equal(inList(cleared, 'anytime', day), true);
  assert.equal(inList(cleared, 'inbox', day), false);
  assert.equal(inList(cleared, 'today', '2026-10-20'), true);
  assert.equal(inList(cleared, 'today', '2026-10-21'), true);
});
