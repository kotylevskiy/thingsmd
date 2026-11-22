const { test } = require('node:test');
const assert = require('node:assert/strict');
const { logbookGroups } = require('../plugin/lists/logbook-groups.cjs');
const task = (id, completed, fields = {}) => ({ meta: { id, completed, ...fields } });
const options = { now: new Date('2026-10-26T12:00:00Z'), timeZone: 'UTC', locale: 'en-GB' };
test('an explicit Sunday overrides the locale week boundary without changing task dates', () => {
  const tasks = [task('sunday', '2026-10-25T12:00:00Z')];
  assert.equal(logbookGroups(tasks, options)[0].title, 'Last Week');
  assert.equal(logbookGroups(tasks, { ...options, weekStartsOn: 0 })[0].title, 'Yesterday');
});

test('Logbook uses recent daily sections then calendar months, newest first', () => {
  const tasks = [
    task('old', '2025-10-12'),
    task('week', '2026-10-19'),
    task('six', '2026-10-20'),
    task('today', '2026-10-26T11:00Z'),
    task('yesterday', '2026-10-25'),
    task('two', '2026-10-24'),
    task('month', '2026-09-30'),
    task('earlier', '2026-10-01'),
    task('newest', '2026-10-26T12:00Z'),
  ];
  const groups = logbookGroups(tasks, options);
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Today', 'Last Week', 'October', 'September', 'October 2025'],
  );
  assert.deepEqual(
    groups[0].tasks.map((t) => t.meta.id),
    ['newest', 'today'],
  );
  assert.deepEqual(
    groups[1].tasks.map((t) => t.meta.id),
    ['yesterday', 'two', 'six', 'week'],
  );
  assert.equal(tasks[0].meta.id, 'old');
});
test('relative days cross month/year boundaries and honor the vault time zone', () => {
  const groups = logbookGroups(
    [task('boundary', '2026-01-01T00:30Z'), task('older', '2025-12-20')],
    {
      now: new Date('2026-01-01T12:00Z'),
      timeZone: 'America/Los_Angeles',
      locale: 'en',
    },
  );
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Yesterday', 'December 2025'],
  );
});
test('DST day lengths do not change grouping and invalid completion dates remain visible', () => {
  const groups = logbookGroups(
    [
      task('dst', '2026-03-07T17:00Z'),
      task('fallback', 'invalid', { loggedAt: '2026-03-08T17:00Z' }),
      task('missing', null),
      task('invalid', 'bad'),
    ],
    {
      now: new Date('2026-03-09T16:00Z'),
      timeZone: 'America/New_York',
      locale: 'en',
    },
  );
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Yesterday', 'Last Week', 'No completion date'],
  );
  assert.equal(groups[2].tasks.length, 2);
});

for (const [locale, day, headings] of [
  ['en-GB', '2026-10-27', ['Today', 'Yesterday', 'Last Week']],
  ['en-GB', '2026-10-28', ['Today', 'Yesterday', '2 Days Ago', 'Last Week']],
  ['en-US', '2026-10-27', ['Today', 'Yesterday', '2 Days Ago', 'Last Week']],
  ['en-US', '2026-10-25', ['Today', 'Last Week']],
  ['en-GB', '2026-10-26', ['Today', 'Last Week']],
]) {
  test(`calendar-week sections on ${day} in ${locale}`, () => {
    const groups = logbookGroups(
      Array.from({ length: 15 }, (_, age) =>
        task(
          String(age),
          `${require('../plugin/shared/local-date.cjs').addDays(day, -age)}T12:00Z`,
        ),
      ),
      {
        now: new Date(`${day}T18:00Z`),
        timeZone: 'UTC',
        locale,
      },
    );
    assert.deepEqual(
      groups.slice(0, headings.length).map((g) => g.title),
      headings,
    );
    const lastWeek = groups.find((g) => g.title === 'Last Week');
    assert.equal(lastWeek.tasks.length, 7);
    const seen = groups.flatMap((g) => g.tasks.map((t) => t.meta.id));
    assert.equal(new Set(seen).size, 15);
  });
}
test('last week spans a year boundary without splitting into monthly groups', () => {
  const groups = logbookGroups(
    [task('sun', '2026-01-04'), task('mon', '2025-12-29'), task('older', '2025-12-28')],
    {
      now: new Date('2026-01-06T12:00Z'),
      timeZone: 'UTC',
      locale: 'en-GB',
    },
  );
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Last Week', 'December 2025'],
  );
  assert.equal(groups[0].tasks.length, 2);
});
