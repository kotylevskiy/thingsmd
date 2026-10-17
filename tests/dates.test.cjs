const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, dayKey, addDays, daysBetween, validDate } = require('../plugin/local-date.cjs');
test('local date parsing rejects impossible dates and accepts leap days', () => {
  assert.equal(parseDate('2028-02-29'), '2028-02-29');
  assert.equal(parseDate('2027-02-29'), null);
  assert.equal(parseDate('31.04.2026'), null);
  assert.equal(parseDate('24.10.2026'), '2026-10-24');
  assert.equal(parseDate('2026-13-01'), null);
});

test('calendar arithmetic crosses leap days, year ends and daylight-saving boundaries', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  assert.equal(daysBetween('2028-03-01', '2028-02-28'), -2);
  assert.equal(validDate('2027-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('tomorrow'), false);
  assert.equal(validDate('2026-2-1'), false);
  for (const value of [null, undefined, 20261017, new Date()]) {
    assert.equal(parseDate(value), null);
    assert.equal(validDate(value), false);
  }
});
test('relative dates cross month and year boundaries locally', () => {
  const now = new Date(2026, 11, 31, 23, 30);
  assert.equal(parseDate('tomorrow', now), '2027-01-01');
  assert.equal(parseDate('next week', now), '2027-01-07');
  assert.equal(dayKey(now), '2026-12-31');
});
