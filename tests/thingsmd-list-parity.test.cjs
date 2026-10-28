const test = require('node:test');
const assert = require('node:assert/strict');
const { inList, upcomingDates } = require('../plugin/tasks/model.cjs');
const { applySchedulePolicy } = require('../plugin/tasks/task-schedule.cjs');
const day = '2026-10-17';
const lists = (meta, date = day) =>
  ['inbox', 'today', 'upcoming', 'anytime', 'someday'].filter((list) =>
    inList({ meta }, list, date),
  );
const create = (fields) => ({
  id: 'fixture',
  ...applySchedulePolicy({}, fields, day, { creating: true }),
});
const change = (meta, fields) => ({ ...meta, ...applySchedulePolicy(meta, fields, day) });

// Observed in the reference app (version 3.24.1) on 2026-10-17, using marked experiment tasks.
const observed = [
  ['Inbox without dates', {}, ['inbox'], []],
  ['Inbox with future deadline', { deadline: '2026-10-21' }, ['inbox'], []],
  ['Inbox with due deadline', { deadline: day }, ['today', 'anytime'], []],
  ['Inbox with overdue deadline', { deadline: '2026-10-15' }, ['today', 'anytime'], []],
  ['Anytime', { when: 'anytime' }, ['anytime'], []],
  [
    'Anytime with future deadline',
    { when: 'anytime', deadline: '2026-10-21' },
    ['upcoming', 'anytime'],
    ['2026-10-21'],
  ],
  ['Explicit Anytime after due deadline', { when: 'anytime', deadline: day }, ['anytime'], []],
  [
    'Someday with future deadline',
    { when: 'someday', deadline: '2026-10-21' },
    ['upcoming', 'someday'],
    ['2026-10-21'],
  ],
  ['Explicit Someday after due deadline', { when: 'someday', deadline: day }, ['someday'], []],
  [
    'Explicit Someday after overdue deadline',
    { when: 'someday', deadline: '2026-10-15' },
    ['someday'],
    [],
  ],
  ['Future start', { when: '2026-10-19' }, ['upcoming'], ['2026-10-19']],
  [
    'Future start with later deadline',
    { when: '2026-10-19', deadline: '2026-10-21' },
    ['upcoming'],
    ['2026-10-19'],
  ],
  [
    'Deadline before start',
    { when: '2026-10-21', deadline: '2026-10-19' },
    ['upcoming'],
    ['2026-10-21'],
  ],
  [
    'Overdue deadline with future start',
    { when: '2026-10-19', deadline: '2026-10-15' },
    ['upcoming'],
    ['2026-10-19'],
  ],
  [
    'Today with future deadline',
    { when: 'today', deadline: '2026-10-21' },
    ['today', 'anytime'],
    [],
  ],
  [
    'Past start with future deadline',
    { when: '2026-10-15', deadline: '2026-10-21' },
    ['today', 'anytime'],
    [],
  ],
];
for (const [name, fields, expected, dates] of observed)
  test(name, () => {
    const meta = create(fields);
    assert.deepEqual(lists(meta), expected);
    // Inbox tasks retain their deadline but do not participate in Upcoming.
    assert.deepEqual(inList({ meta }, 'upcoming', day) ? upcomingDates(meta, day) : [], dates);
  });

test('deadline edits and explicit moves match ThingsMD transitions without erasing dates', () => {
  let meta = create({});
  meta = change(meta, { deadline: '2026-10-18' });
  assert.deepEqual(lists(meta), ['inbox']);
  meta = change(meta, { deadline: day });
  assert.deepEqual(lists(meta), ['today', 'anytime']);
  meta = change(meta, { when: null });
  assert.deepEqual(lists(meta), ['inbox']);
  assert.equal(meta.deadline, day);
  meta = change(meta, { deadline: '2026-10-16' });
  assert.deepEqual(lists(meta), ['today', 'anytime']);
  meta = change(meta, { when: '2026-10-20' });
  assert.deepEqual(lists(meta), ['upcoming']);
  meta = change(meta, { deadline: '2026-10-15' });
  assert.deepEqual(lists(meta), ['upcoming']);
  meta = change(meta, { when: 'someday' });
  assert.deepEqual(lists(meta), ['someday']);
  meta = change(meta, { deadline: day });
  assert.deepEqual(lists(meta), ['today', 'anytime']);
  meta = change(meta, { deadline: '2026-10-21' });
  assert.deepEqual(lists(meta), ['today', 'anytime']);
  meta = change(meta, { deadline: null });
  assert.deepEqual(lists(meta), ['today', 'anytime']);
  meta = change(meta, { when: 'anytime' });
  assert.deepEqual(lists(meta), ['anytime']);
});

test('calendar boundaries activate deadlines and starts without duplicate Upcoming rows', () => {
  for (const fields of [
    { when: '2026-12-31', deadline: '2027-01-02' },
    { when: '2026-12-31', deadline: '2026-12-31' },
    { when: '2026-12-31', deadline: '2026-12-29' },
  ]) {
    assert.deepEqual(upcomingDates(fields, '2026-12-30'), ['2026-12-31']);
    assert.deepEqual(upcomingDates(fields, '2026-12-31'), []);
    assert.deepEqual(lists(fields, '2026-12-31'), ['today', 'anytime']);
  }
  const task = { when: 'anytime', deadline: '2028-02-29' };
  assert.deepEqual(lists(task, '2028-02-28'), ['upcoming', 'anytime']);
  assert.deepEqual(lists(task, '2028-02-29'), ['today', 'anytime']);
  const inbox = { deadline: '2027-01-01' };
  assert.deepEqual(lists(inbox, '2026-12-31'), ['inbox']);
  assert.deepEqual(lists(inbox, '2027-01-01'), ['today', 'anytime']);
});

test('Waiting For remains a custom overlay with a preserved airplane status', () => {
  const meta = create({ when: '2026-10-19', deadline: '2026-10-21', is_waiting: true });
  assert.equal(inList({ meta }, 'waiting', day), true);
  assert.deepEqual(lists(meta), ['upcoming']);
  assert.deepEqual(upcomingDates(meta, day), ['2026-10-19']);
  assert.equal(change(meta, { when: 'today' }).is_waiting, true);
});

test('clearing a deadline after its calendar arrival keeps the task in Today', () => {
  const meta = { id: 'existing', when: 'anytime', deadline: '2026-10-16' };
  assert.deepEqual(lists(meta), ['today', 'anytime']);
  const cleared = change(meta, { deadline: null });
  assert.equal(cleared.when, 'today');
  assert.deepEqual(lists(cleared), ['today', 'anytime']);
  const deferred = { ...meta, when: 'someday', deadlineDeferredOn: day };
  assert.deepEqual(lists(change(deferred, { deadline: null })), ['someday']);
});
