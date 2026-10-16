const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, dayKey } = require('../plugin/local-date.cjs');
test('local date parsing rejects impossible dates and accepts leap days', () => {
  assert.equal(parseDate('2028-02-29'), '2028-02-29');
  assert.equal(parseDate('2027-02-29'), null);
  assert.equal(parseDate('31.04.2026'), null);
  assert.equal(parseDate('24.10.2026'), '2026-10-24');
  assert.equal(parseDate('2026-13-01'), null);
});
test('relative dates cross month and year boundaries locally', () => {
  const now = new Date(2026, 11, 31, 23, 30);
  assert.equal(parseDate('tomorrow', now), '2027-01-01');
  assert.equal(parseDate('next week', now), '2027-01-07');
  assert.equal(dayKey(now), '2026-12-31');
});
