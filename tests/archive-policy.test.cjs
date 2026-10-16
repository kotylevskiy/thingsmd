const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settings, shouldLog, trashExpired } = require('../plugin/archive-policy.cjs');
test('archive settings default safely and validate saved values', () => {
  assert.deepEqual(settings(), {
    globalCaptureHotkey: '',
    logbook: 'daily',
    trashRetention: 'never',
    captureDestination: 'inbox',
    showProjectProgress: true,
    showWaitingInToday: true,
  });
  assert.deepEqual(settings({ logbook: 'bad', trashRetention: 'bad' }), settings());
});
test('logging supports manual, immediate, daily, weekly, monthly and explicit logging', () => {
  const m = { status: 'done', completed: new Date(2026, 0, 31, 23, 59).toISOString() };
  assert.equal(shouldLog(m, '2026-01-31', 'immediately'), true);
  assert.equal(shouldLog(m, '2027-01-01', 'manually'), false);
  assert.equal(shouldLog(m, '2026-01-31', 'daily'), false);
  assert.equal(shouldLog(m, '2026-02-01', 'daily'), true);
  assert.equal(shouldLog(m, '2026-02-06', 'weekly'), false);
  assert.equal(shouldLog(m, '2026-02-07', 'weekly'), true);
  assert.equal(shouldLog(m, '2026-02-27', 'monthly'), false);
  assert.equal(shouldLog(m, '2026-02-28', 'monthly'), true);
  assert.equal(shouldLog({ ...m, loggedAt: '2026-02-01' }, '2026-02-01', 'manually'), true);
  assert.equal(
    shouldLog({ ...m, status: 'todo', loggedAt: '2026-02-01' }, '2026-02-01', 'immediately'),
    false,
  );
});
test('trash retention uses deletion time, calendar months, and safe missing-date behavior', () => {
  const m = { deleted: true, deletedAt: new Date(2024, 1, 29, 12).toISOString() };
  for (const [policy, expiry] of [
    ['5-years', new Date(2029, 1, 28, 12)],
    ['3-years', new Date(2027, 1, 28, 12)],
    ['1-year', new Date(2025, 1, 28, 12)],
    ['3-months', new Date(2024, 4, 29, 12)],
    ['1-month', new Date(2024, 2, 29, 12)],
    ['1-week', new Date(2024, 2, 7, 12)],
  ]) {
    assert.equal(trashExpired(m, policy, new Date(+expiry - 1)), false, policy);
    assert.equal(trashExpired(m, policy, expiry), true, policy);
  }
  assert.equal(trashExpired(m, 'never', new Date(2099, 0)), false);
  assert.equal(trashExpired(m, 'immediately'), true);
  assert.equal(trashExpired({ ...m, deleted: false }, 'immediately'), false);
  assert.equal(trashExpired({ deleted: true }, '1-week'), false);
  assert.equal(trashExpired({ deleted: true, deletedAt: 'bad' }, '1-year'), false);
  assert.equal(
    trashExpired(
      { deleted: true, deletedAt: new Date(2026, 0, 31, 12).toISOString() },
      '1-month',
      new Date(2026, 1, 28, 12),
    ),
    true,
  );
});
