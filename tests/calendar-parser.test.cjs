const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseCalendar, eventsOnDay, eventsInRange } = require('../plugin/calendar/parser.cjs');
const { wrap, event } = require('./helpers/calendar.cjs');
const day = (value) => new Date(value + 'T12:00:00');
const read = (body, value = '2026-10-28') => eventsOnDay(parseCalendar(body), day(value));

test('week expansion preserves recurrence exceptions and caches both displayed periods', () => {
  const parsed = parseCalendar(
    wrap(
      event([
        'DTSTART:20261028T100000',
        'DURATION:PT1H',
        'RRULE:FREQ=DAILY;COUNT=10',
        'EXDATE:20261030T100000',
      ]),
      event(['RECURRENCE-ID:20261031T100000', 'DTSTART:20261102T140000', 'SUMMARY:Moved']),
    ),
  );
  const start = new Date(2026, 9, 29),
    end = new Date(2026, 10, 5);
  const today = eventsOnDay(parsed, day('2026-10-28'));
  const week = eventsInRange(parsed, start, end);
  assert.equal(week.length, 6);
  assert.equal(week.filter((e) => e.title === 'Moved').length, 1);
  assert.equal(week.filter((e) => new Date(e.start).getDate() === 31).length, 0);
  assert.ok(week.every((e) => e.start >= start.getTime() && e.start < end.getTime()));
  assert.equal(eventsOnDay(parsed, day('2026-10-28')), today);
  assert.equal(eventsInRange(parsed, start, end), week);
  assert.throws(() => eventsInRange(parsed, end, start), /Invalid calendar date range/);
  assert.throws(() => eventsInRange(parsed, start, end, { maxIterations: 1 }), /expansion limit/);
  eventsOnDay(parsed, day('2026-11-05'));
  assert.equal(parsed.rangeCache.size, 2);
});

test('all-day exclusive end, floating times, overnight overlap, and zero duration', () => {
  const allDay = wrap(event(['DTSTART;VALUE=DATE:20261027', 'DTEND;VALUE=DATE:20261029']));
  assert.equal(read(allDay).length, 1);
  assert.equal(read(allDay)[0].allDay, true);
  assert.equal(read(allDay, '2026-10-29').length, 0);
  const floating = read(wrap(event(['DTSTART:20261028T093000', 'DURATION:PT45M'])))[0];
  assert.equal(new Date(floating.start).getHours(), 9);
  assert.equal(floating.end - floating.start, 45 * 60000);
  assert.equal(read(wrap(event(['DTSTART:20261027T230000', 'DTEND:20261028T010000']))).length, 1);
  assert.equal(read(wrap(event(['DTSTART:20261028T120000']))).length, 1);
});
test('missing IANA timezone definitions use bundled data across DST', () => {
  const body = wrap(
    event([
      'DTSTART;TZID=Europe/Berlin:20260328T090000',
      'DURATION:PT1H',
      'RRULE:FREQ=DAILY;COUNT=3',
    ]),
  );
  assert.equal(
    new Date(read(body, '2026-03-28')[0].start).toISOString(),
    '2026-03-28T08:00:00.000Z',
  );
  assert.equal(
    new Date(read(body, '2026-03-29')[0].start).toISOString(),
    '2026-03-29T07:00:00.000Z',
  );
});
test('feed timezone definitions take precedence without leaking into another feed', () => {
  const tz = [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Berlin',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0500',
    'TZOFFSETTO:+0500',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n');
  const ev = event(['DTSTART;TZID=Europe/Berlin:20261028T120000', 'DURATION:PT1H']);
  assert.equal(new Date(read(wrap(tz, ev))[0].start).getUTCHours(), 7);
  assert.equal(new Date(read(wrap(ev))[0].start).getUTCHours(), 11);
});
test('recurrence exclusions, extra dates, period durations and moved overrides', () => {
  const main = event([
    'DTSTART:20261026T100000Z',
    'DURATION:PT1H',
    'RRULE:FREQ=DAILY;COUNT=4',
    'EXDATE:20261027T100000Z',
    'RDATE:20261101T100000Z',
    'RDATE;VALUE=PERIOD:20261102T100000Z/20261102T130000Z',
  ]);
  const moved = event([
    'RECURRENCE-ID:20261028T100000Z',
    'DTSTART:20261030T120000Z',
    'DURATION:PT2H',
    'SUMMARY:Moved',
  ]);
  const body = wrap(main, moved);
  assert.equal(read(body, '2026-10-27').length, 0);
  assert.equal(read(body, '2026-10-28').length, 0);
  assert.equal(read(body, '2026-10-30').length, 1);
  assert.equal(read(body, '2026-11-01').length, 1);
  const period = read(body, '2026-11-02')[0];
  assert.equal(period.end - period.start, 3 * 3600000);
});
test('equivalent UTC override is not duplicated; repeated expansion is stable', () => {
  const body = wrap(
    event([
      'DTSTART;TZID=Europe/Berlin:20261028T110000',
      'DURATION:PT1H',
      'RRULE:FREQ=DAILY;COUNT=2',
    ]),
    event(['RECURRENCE-ID:20261028T100000Z', 'DTSTART:20261028T130000Z', 'DURATION:PT1H']),
  );
  const parsed = parseCalendar(body);
  assert.equal(eventsOnDay(parsed, day('2026-10-28')).length, 1);
  assert.deepEqual(eventsOnDay(parsed, day('2026-10-28')), eventsOnDay(parsed, day('2026-10-28')));
});
test('cancelled occurrences and series are hidden; private events and literal text remain', () => {
  const base = event(['DTSTART:20261028T100000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=2']);
  assert.equal(
    read(wrap(base, event(['RECURRENCE-ID:20261028T100000Z', 'STATUS:CANCELLED']))).length,
    0,
  );
  assert.equal(read(wrap(event(['DTSTART:20261028T100000Z', 'STATUS:CANCELLED']))).length, 0);
  assert.equal(
    read(
      wrap(
        event([
          'DTSTART:20261028T100000Z',
          'CLASS:PRIVATE',
          'SUMMARY:<img src=x onerror=alert(1)>',
        ]),
      ),
    )[0].allDay,
    false,
  );
});
test('valid empty and task-only calendars contain no events', () => {
  assert.deepEqual(read(wrap()), []);
  assert.deepEqual(read(wrap('BEGIN:VTODO\r\nUID:task\r\nEND:VTODO')), []);
});
test('reject partial, HTML, unknown zones, negative durations, and malformed recurrence', () => {
  for (const body of [
    '<html>Login</html>',
    wrap().replace('END:VCALENDAR', ''),
    wrap(event(['DTSTART;TZID=Unknown/Zone:20261028T100000'])),
    wrap(event(['DTSTART:20261028T100000Z', 'DURATION:-PT1H'])),
    wrap(event(['DTSTART:20261028T100000Z', 'RRULE:RRULE:bad;FREQ=DAILY'])),
  ])
    assert.throws(() => parseCalendar(body));
  assert.throws(
    () => parseCalendar(fs.readFileSync('tests/fixtures/calendar/node-ical/badRRULE.ics', 'utf8')),
    /recurrence/,
  );
});
test('historical infinite recurrence is bounded without silently dropping events', () => {
  const parsed = parseCalendar(wrap(event(['DTSTART:20000101T100000Z', 'RRULE:FREQ=DAILY'])));
  assert.equal(eventsOnDay(parsed, day('2026-10-28')).length, 1);
  assert.throws(() => eventsOnDay(parsed, day('2026-10-28'), { maxIterations: 10 }), /limit/);
});
test('upstream samples preserve duration, UTF8 task-only behavior and RDATE periods', () => {
  const fixture = (path) => fs.readFileSync('tests/fixtures/calendar/' + path, 'utf8');
  assert.equal(parseCalendar(fixture('node-ical/utf8-french-calendar.ics')).groups.size, 0);
  assert.equal(parseCalendar(fixture('ical-js/duration_instead_of_dtend.ics')).groups.size, 1);
  const parsed = parseCalendar(fixture('ical-js/recur_instances.ics'));
  const result = eventsOnDay(parsed, day('2023-11-25'));
  assert.equal(result.length, 1);
  assert.equal(result[0].end - result[0].start, 3.5 * 3600000);
});

test('DTSTART remains in RDATE-only recurrence sets and EXDATE can exclude it', () => {
  const original = event(['DTSTART:20261028T100000Z', 'RDATE:20261029T100000Z']);
  assert.equal(read(wrap(original)).length, 1);
  const excluded = event([
    'DTSTART:20261028T100000Z',
    'RDATE:20261029T100000Z',
    'EXDATE:20261028T100000Z',
  ]);
  assert.equal(read(wrap(excluded)).length, 0);
});
test('cancellation without DTSTART replaces an earlier master in the same feed', () => {
  const original = event(['DTSTART:20261028T100000Z', 'SEQUENCE:1']);
  const cancellation = event(['STATUS:CANCELLED', 'SEQUENCE:2']);
  assert.equal(read(wrap(original, cancellation)).length, 0);
});

test('calendar colors prefer standard names, fall back to Apple hex, and ignore event colors', () => {
  const color = (...props) => parseCalendar(wrap(...props)).color;
  assert.equal(color('COLOR:Turquoise', 'X-APPLE-CALENDAR-COLOR:#00FDFF'), 'turquoise');
  assert.equal(color('X-APPLE-CALENDAR-COLOR:#00FDFF80'), '#00fdff80');
  assert.equal(color('COLOR:invalid', 'X-APPLE-CALENDAR-COLOR:#2d73be'), '#2d73be');
  assert.equal(color('COLOR:var(--text-normal)', 'X-APPLE-CALENDAR-COLOR:url(example)'), '');
  assert.equal(color(event(['DTSTART:20261028T100000Z', 'COLOR:tomato'])), '');
  assert.equal(color(), '');
});

test('all pinned upstream fixtures have explicit acceptance or rejection expectations', () => {
  const accepted = {
    'ical-js/day_long_recur_yearly.ics': 1,
    'ical-js/duration_instead_of_dtend.ics': 1,
    'ical-js/minimal.ics': 1,
    'ical-js/recur_instances.ics': 1,
    'node-ical/dst-transition-rules.ics': 1,
    'node-ical/tentative-apple-calendar.ics': 4,
    'node-ical/utf8-french-calendar.ics': 0,
  };
  const rejected = {
    'node-ical/badRRULE.ics': /recurrence/,
    // These upstream edge-case snippets lack the required VERSION property.
    'node-ical/daily-count-exdate-recurrence-id.ics': /iCalendar 2.0/,
    'node-ical/whole_day_moved_over_dst_change_berlin.ics': /iCalendar 2.0/,
    // Includes DATE values declared implicitly as DATE-TIME.
    'node-ical/mixed-timezone-handling.ics': /parse/,
  };
  const fixtures = fs
    .readdirSync('tests/fixtures/calendar', { recursive: true })
    .filter((f) => f.endsWith('.ics'));
  assert.deepEqual(fixtures.sort(), [...Object.keys(accepted), ...Object.keys(rejected)].sort());
  for (const file of fixtures) {
    const source = fs.readFileSync('tests/fixtures/calendar/' + file, 'utf8');
    if (rejected[file]) assert.throws(() => parseCalendar(source), rejected[file], file);
    else assert.equal(parseCalendar(source).groups.size, accepted[file], file);
  }
  const moved = fs
    .readFileSync(
      'tests/fixtures/calendar/node-ical/whole_day_moved_over_dst_change_berlin.ics',
      'utf8',
    )
    .replace('BEGIN:VCALENDAR', 'BEGIN:VCALENDAR\nVERSION:2.0');
  assert.equal(read(moved, '2024-10-28').length, 0);
  assert.equal(read(moved, '2024-10-30')[0].allDay, true);
});

test('recurrence range exceptions shift following occurrences without duplicates', () => {
  const source = wrap(
    event(['DTSTART:20261026T100000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=5']),
    event([
      'RECURRENCE-ID;RANGE=THISANDFUTURE:20261027T100000Z',
      'DTSTART:20261027T120000Z',
      'DURATION:PT2H',
    ]),
  );
  const occurrence = read(source)[0];
  assert.equal(read(source).length, 1);
  assert.equal(new Date(occurrence.start).toISOString(), '2026-10-28T12:00:00.000Z');
  assert.equal(occurrence.end - occurrence.start, 2 * 3600000);
});

test('oversized feeds are rejected and newer event sequences win regardless of feed order', () => {
  const { MAX_BYTES } = require('../plugin/calendar/parser.cjs');
  assert.throws(() => parseCalendar('x'.repeat(MAX_BYTES + 1)), /8 MB/);
  const source = wrap(
    event(['DTSTART:20261028T100000Z', 'SEQUENCE:3', 'SUMMARY:Newest']),
    event(['DTSTART:20261028T100000Z', 'SEQUENCE:1', 'SUMMARY:Stale']),
  );
  assert.equal(read(source)[0].title, 'Newest');
});
