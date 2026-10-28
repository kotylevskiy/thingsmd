const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveList, isListAvailable } = require('../plugin/lists/lists.cjs');
const { normalizeSchedule } = require('../plugin/tasks/task-schedule.cjs');

test('hidden list fallbacks resolve consistently for navigation and restored layouts', () => {
  const settings = { captureDestination: 'daily-note', trashRetention: 'immediately' };
  for (const page of ['inbox', 'trash', 'unknown', undefined]) {
    assert.equal(resolveList(page, settings), 'today');
  }
  assert.equal(isListAvailable('inbox', settings), false);
  assert.equal(isListAvailable('trash', settings), false);
  assert.equal(resolveList('waiting', settings), 'waiting');
  assert.equal(resolveList('unknown', {}), 'inbox');
  assert.equal(isListAvailable('waiting', { enableWaiting: false }), false);
  assert.equal(resolveList('waiting', { enableWaiting: false }), 'anytime');
});

test('schedule normalization clears stale evening flags and leaves unrelated edits alone', () => {
  assert.deepEqual(normalizeSchedule({ when: 'evening' }, '2026-10-17'), {
    when: 'today',
    evening: '2026-10-17',
  });
  assert.deepEqual(normalizeSchedule({ when: '2026-11-01' }), {
    when: '2026-11-01',
    evening: null,
  });
  assert.deepEqual(normalizeSchedule({ when: 'today', evening: '2026-10-17' }), {
    when: 'today',
    evening: '2026-10-17',
  });
  const patch = { title: '' };
  assert.equal(normalizeSchedule(patch), patch);
});
