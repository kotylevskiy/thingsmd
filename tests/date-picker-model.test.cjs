const { test } = require('node:test');
const assert = require('node:assert/strict');
const { firstWeekday, calendarDays, dateSuggestions } = require('../plugin/date-picker-model.cjs');
const keys = (text, now = new Date(2026, 9, 17, 23, 30)) =>
  dateSuggestions(text, now, 'en-GB').map((item) => item.date);

test('calendar uses locale week boundaries across years and leap days', () => {
  assert.equal(firstWeekday('en-US'), 0);
  assert.equal(firstWeekday('en-GB'), 1);
  assert.equal(firstWeekday('ru-RU'), 1);
  assert.deepEqual(calendarDays('2027-01-01', 7, 1), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]);
  assert.equal(calendarDays('2028-03-01', 7, 0)[2], '2028-02-29');
});
test('date search resolves relative shorthand locally without affecting stored date validation', () => {
  assert.deepEqual(keys('tom'), ['2026-10-18']);
  assert.deepEqual(keys('завтра'), ['2026-10-18']);
  assert.deepEqual(keys('17d'), ['2026-11-03']);
  assert.deepEqual(keys('in 3 weeks'), ['2026-11-07']);
  assert.deepEqual(keys('через 2 дня'), ['2026-10-19']);
  assert.deepEqual(keys('in3'), ['2026-10-20', '2026-11-07', '2027-01-17']);
  assert.deepEqual(keys('1mo', new Date(2028, 0, 31)), ['2028-02-29']);
  assert.deepEqual(keys('1y', new Date(2028, 1, 29)), ['2029-02-28']);
});
test('date search offers upcoming weekday and named month alternatives', () => {
  assert.deepEqual(keys('mon'), ['2026-10-19', '2026-10-26', '2026-11-02']);
  assert.deepEqual(keys('понедельник'), keys('mon'));
  assert.deepEqual(keys('jul26').slice(0, 3), ['2027-07-26', '2028-07-26', '2029-07-26']);
  assert.deepEqual(keys('26 July 2028'), ['2028-07-26']);
  assert.deepEqual(keys('24.10.2099'), ['2099-10-24']);
});
test('date search rejects impossible dates, unsupported time expressions and empty input', () => {
  for (const text of ['', '31.04.2026', '2027-02-29', 'February 30', 'tomorrow 2pm', 'nonsense'])
    assert.deepEqual(keys(text), [], text);
});
