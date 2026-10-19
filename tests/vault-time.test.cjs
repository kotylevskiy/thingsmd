const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { dayKey, startOfDay, validTimeZone } = require('../plugin/vault-time.cjs');
const { plannedLogAt, shouldLog } = require('../plugin/archive-policy.cjs');

test('vault day and midnight honor fractional offsets and daylight-saving transitions', () => {
  assert.equal(validTimeZone('UTC'), true);
  assert.equal(validTimeZone('Invalid/Zone'), false);
  assert.equal(dayKey(new Date('2026-10-19T22:30:00Z'), 'Europe/Berlin'), '2026-10-20');
  assert.equal(startOfDay('2026-10-20', 'Asia/Kathmandu'), '2026-10-19T18:15:00.000Z');
  assert.equal(startOfDay('2026-03-08', 'America/New_York'), '2026-03-08T05:00:00.000Z');
  assert.equal(startOfDay('2026-03-09', 'America/New_York'), '2026-03-09T04:00:00.000Z');
  assert.equal(startOfDay('2026-11-01', 'America/New_York'), '2026-11-01T04:00:00.000Z');
  assert.equal(startOfDay('2026-11-02', 'America/New_York'), '2026-11-02T05:00:00.000Z');
  // This day starts at 01:00 because the clock skips midnight.
  assert.equal(startOfDay('2018-11-04', 'America/Sao_Paulo'), '2018-11-04T03:00:00.000Z');
});

test('automatic archive stamps represent the planned boundary, including month end and DST', () => {
  const meta = { status: 'done', completed: '2026-01-31T23:30:00Z' };
  assert.equal(plannedLogAt(meta, 'daily', 'UTC'), '2026-02-01T00:00:00.000Z');
  assert.equal(plannedLogAt(meta, 'weekly', 'UTC'), '2026-02-07T00:00:00.000Z');
  assert.equal(plannedLogAt(meta, 'monthly', 'UTC'), '2026-02-28T00:00:00.000Z');
  assert.equal(plannedLogAt(meta, 'immediately', 'UTC'), '2026-01-31T23:30:00.000Z');
  assert.equal(plannedLogAt(meta, 'manually', 'UTC'), null);
  assert.equal(plannedLogAt({ completed: 'bad' }, 'daily', 'UTC'), null);
  assert.equal(plannedLogAt({ completed: null }, 'daily', 'UTC'), null);
  const dst = { status: 'done', completed: '2026-03-08T15:00:00Z' };
  assert.equal(plannedLogAt(dst, 'daily', 'America/New_York'), '2026-03-09T04:00:00.000Z');
  const late = { status: 'done', completed: '2026-10-19T22:30:00Z' };
  assert.equal(plannedLogAt(late, 'daily', 'Europe/Berlin'), '2026-10-20T22:00:00.000Z');
  assert.equal(shouldLog(late, '2026-10-20', 'daily', 'Europe/Berlin'), false);
  assert.equal(shouldLog(late, '2026-10-21', 'daily', 'Europe/Berlin'), true);
});

test('different device zones produce identical automatic timestamps and retain the saved vault zone', () => {
  const script = `
    const { plannedLogAt } = require('./plugin/archive-policy.cjs');
    const { startOfDay, dayKey } = require('./plugin/vault-time.cjs');
    const { settings } = require('./plugin/settings-model.cjs');
    const zone = settings({ timeZone: 'Europe/Berlin' }).timeZone;
    console.log(JSON.stringify({
      zone,
      loggedAt: plannedLogAt({ completed: '2026-10-19T22:30:00Z' }, 'daily', zone),
      created: startOfDay('2026-10-20', zone),
      day: dayKey(new Date('2026-10-19T22:30:00Z'), zone),
    }));
  `;
  const results = ['Europe/London', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Tokyo'].map(
    (TZ) =>
      JSON.parse(
        execFileSync(process.execPath, ['-e', script], {
          cwd: require('node:path').resolve(__dirname, '..'),
          env: { ...process.env, TZ },
          encoding: 'utf8',
        }),
      ),
  );
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].created, '2026-10-19T22:00:00.000Z');
  assert.equal(results[0].loggedAt, '2026-10-20T22:00:00.000Z');
});
