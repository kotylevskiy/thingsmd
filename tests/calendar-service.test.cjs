const test = require('node:test');
const assert = require('node:assert/strict');
const { CalendarService, ROOT } = require('../plugin/calendar/service.cjs');
const { calendars, subscriptionUrl } = require('../plugin/calendar/model.cjs');
const { wrap, body } = require('./helpers/calendar.cjs');
const { event } = require('./helpers/calendar.cjs');
const config = {
  id: 'test',
  name: 'Calendar',
  secretName: 'calendar-url',
  refreshMinutes: 15,
  enabled: true,
};
function fixture(files = new Map(), options = {}) {
  let clock = Date.parse('2026-10-28T12:00:00Z'),
    serial = 0;
  const calls = [];
  let reply = { status: 200, headers: { ETag: '"one"' }, text: body() };
  const service = new CalendarService({
    storage: {
      list: async (folder) => [...files.keys()].filter((p) => p.startsWith(folder + '/')),
      read: async (p) => {
        if (!files.has(p)) throw Error('missing');
        return files.get(p);
      },
      create: async (p, b) => {
        assert.ok(!files.has(p));
        files.set(p, b);
      },
      remove: async (p) => files.delete(p),
    },
    request: async (request) => {
      calls.push(request);
      return typeof reply === 'function' ? reply() : reply;
    },
    secret: async () => 'https://example.com/private-token',
    now: () => clock,
    random: () => 0.5,
    uuid: () => `device-${++serial}`,
    ...options,
  });
  service.configure([config]);
  return {
    service,
    files,
    calls,
    reply: (r) => {
      reply = r;
    },
    advance: (n) => {
      clock += n;
    },
  };
}
test('Upcoming groups the next seven local days, with exclusive ends and shared visibility/colors', async () => {
  const f = fixture();
  const ev = (id, ...properties) => event(properties).replace('UID:test', `UID:${id}`);
  f.reply({
    status: 200,
    headers: {},
    text: wrap(
      'COLOR:tomato',
      ev('past', 'DTSTART:20261028T090000'),
      ev('series', 'DTSTART:20261029T090000', 'RRULE:FREQ=DAILY;COUNT=2'),
      ev('trip', 'DTSTART;VALUE=DATE:20261028', 'DTEND;VALUE=DATE:20261031', 'SUMMARY:Trip'),
      ev('overnight', 'DTSTART:20261029T230000', 'DTEND:20261030T010000', 'SUMMARY:Overnight'),
      ev(
        'midnight-end',
        'DTSTART:20261029T220000',
        'DTEND:20261030T000000',
        'SUMMARY:Until midnight',
      ),
      ev('last', 'DTSTART:20261104T235900', 'SUMMARY:Last day'),
      ev('outside', 'DTSTART:20261105T000000', 'SUMMARY:Outside'),
    ),
  });
  await f.service.refreshAll();
  const date = new Date(2026, 9, 28, 12);
  const { days, statuses } = f.service.upcoming(date);
  assert.deepEqual(
    [...days.keys()],
    [
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ],
  );
  assert.deepEqual(
    days.get('2026-10-29').map((e) => [e.title, e.allDay]),
    [
      ['Trip', true],
      ['Overnight', true],
      ['Meeting', false],
      ['Until midnight', false],
    ],
  );
  assert.deepEqual(
    days.get('2026-10-30').map((e) => e.title),
    ['Trip', 'Overnight', 'Meeting'],
  );
  assert.equal(days.get('2026-10-31').length, 0);
  assert.equal(days.get('2026-11-04')[0].title, 'Last day');
  assert.ok(
    [...days.values()].flat().every((e) => e.color === 'tomato' && e.calendarId === config.id),
  );
  assert.equal(statuses.length, 1);
  assert.equal(f.calls.length, 1, 'Upcoming reuses the same snapshot without another download');
  f.service.configure([{ ...config, color: '#123456' }]);
  assert.equal(f.service.upcoming(date).days.get('2026-10-29')[0].color, '#123456');
  assert.equal(f.service.today(date).events[0].color, '#123456');
  f.service.configure([{ ...config, enabled: false }]);
  assert.equal([...f.service.upcoming(date).days.values()].flat().length, 0);
  assert.equal(f.service.upcoming(date).statuses.length, 0);
  assert.equal(f.service.today(date).events.length, 0);
});
test('settings store only secret names and normalize paths and intervals', () => {
  assert.deepEqual(
    calendars([{ ...config, url: 'secret', refreshMinutes: 1 }, { ...config }, { id: '../bad' }]),
    [{ ...config, color: '', refreshMinutes: 5 }],
  );
  assert.equal(subscriptionUrl('webcal://example.com/token'), 'https://example.com/token');
  assert.throws(() => subscriptionUrl('http://example.com/token'));
  assert.throws(() => subscriptionUrl('https://user:pass@example.com/'));
  assert.equal(subscriptionUrl('http://127.0.0.1:8765/feed'), 'http://127.0.0.1:8765/feed');
});
test('200, identical bodies, 304, and valid empty snapshot replacement', async () => {
  const f = fixture();
  await f.service.refreshAll();
  assert.equal(f.files.size, 1);
  await f.service.refreshAll(true);
  assert.equal(f.files.size, 1);
  assert.equal(f.calls[1].headers['If-None-Match'], '"one"');
  f.reply({ status: 304, headers: {} });
  await f.service.refreshAll(true);
  assert.equal(f.files.size, 1);
  f.advance(1000);
  f.reply({ status: 200, headers: {}, text: wrap() });
  await f.service.refreshAll(true);
  assert.equal(f.files.size, 2);
  assert.equal(f.service.today().events.length, 0);
});
test('a malformed response retains cache and never publishes a snapshot', async () => {
  const f = fixture();
  await f.service.refreshAll();
  f.reply({ status: 200, headers: {}, text: 'BEGIN:VCALENDAR\nVERSION:2.0' });
  await f.service.refreshAll(true);
  assert.equal(f.files.size, 1);
  assert.equal(f.service.today().events.length, 1);
  assert.match(f.service.today().statuses[0].error, /incomplete/);
});
test('newest valid filename wins; incomplete synced files fall back, without merging', async () => {
  const f = fixture();
  await f.service.refreshAll();
  f.files.set(`${ROOT}/test/2026-10-29T00-00-00-000Z_remote.ics`, wrap());
  f.files.set(`${ROOT}/test/2026-10-30T00-00-00-000Z_partial.ics`, 'BEGIN:VCALENDAR');
  await f.service.reload();
  assert.equal(f.service.today().events.length, 0);
  f.reply({ status: 200, headers: {}, text: wrap() });
  await f.service.refreshAll(true);
  assert.equal(f.calls.at(-1).headers['If-None-Match'], undefined);
});
test('independent devices create unique files and converge on one snapshot', async () => {
  const files = new Map(),
    a = fixture(files, { uuid: () => 'a' }),
    b = fixture(files, { uuid: () => 'b' });
  a.reply({ status: 200, headers: {}, text: body('First') });
  b.reply({ status: 200, headers: {}, text: body('Second') });
  await Promise.all([a.service.refreshAll(), b.service.refreshAll()]);
  await a.service.reload();
  await b.service.reload();
  assert.deepEqual(a.service.today().events, b.service.today().events);
  assert.equal(a.service.today().events.length, 1);
});
test('304 without a matching body is rejected', async () => {
  const f = fixture();
  f.reply({ status: 304, headers: {} });
  await f.service.refreshAll();
  assert.equal(f.files.size, 0);
  assert.match(f.service.today().statuses[0].error, /304/);
});
test('missing secret can read synced snapshots without downloading', async () => {
  const a = fixture();
  await a.service.refreshAll();
  const b = fixture(a.files, { secret: async () => null });
  await b.service.refreshAll();
  assert.equal(b.calls.length, 0);
  assert.equal(b.service.today().events.length, 1);
});
test('refresh hints, jitter and Retry-After prevent excessive requests', async () => {
  const f = fixture();
  f.reply({ status: 200, headers: {}, text: wrap('X-PUBLISHED-TTL:PT4H') });
  await f.service.refreshAll();
  f.advance(3600000);
  await f.service.refreshAll();
  assert.equal(f.calls.length, 1);
  f.advance(4 * 3600000);
  f.reply({ status: 429, headers: { 'Retry-After': '3600' } });
  await f.service.refreshAll();
  await f.service.refreshAll(true);
  assert.equal(f.calls.length, 2);
  f.advance(3600001);
  await f.service.refreshAll(true);
  assert.equal(f.calls.length, 3);
});
test('only old surplus valid snapshots are pruned; unrelated files survive', async () => {
  const f = fixture();
  for (let day = 1; day <= 6; day++)
    f.files.set(`${ROOT}/test/2026-10-0${day}T00-00-00-000Z_device.ics`, wrap());
  f.files.set(`${ROOT}/test/notes.md`, 'keep');
  await f.service.cleanup(config);
  assert.equal(f.files.size, 4);
  assert.equal(f.files.get(`${ROOT}/test/notes.md`), 'keep');
});
test('coalesces in-flight requests and ignores completion after unload or removal', async () => {
  let release;
  const f = fixture();
  f.reply(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const work = f.service.refreshAll();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const second = f.service.refreshAll(true);
  assert.equal(f.calls.length, 1);
  f.service.dispose();
  release({ status: 200, headers: {}, text: body() });
  await Promise.all([work, second]);
  assert.equal(f.files.size, 0);
});
test('network exceptions never expose the URL or response details', async () => {
  const f = fixture();
  f.reply(() => {
    throw Error('https://example.com/private-token');
  });
  await f.service.refreshAll();
  assert.ok(!JSON.stringify(f.service.today()).includes('private-token'));
});

test('a slow older scan cannot replace a newer synchronized snapshot', async () => {
  const f = fixture();
  await f.service.refreshAll();
  const previous = f.service.state(config).snapshot.path;
  const read = f.service.storage.read;
  let release,
    waiting = true;
  f.service.storage.read = async (path) => {
    if (path === previous && waiting) {
      waiting = false;
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return read(path);
  };
  const oldScan = f.service.reload();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  f.files.set(`${ROOT}/test/2026-10-29T00-00-00-000Z_remote.ics`, wrap());
  await f.service.reload();
  release();
  await oldScan;
  assert.equal(f.service.today().events.length, 0);
});
test('retention keeps recent snapshots while synchronization settles', async () => {
  const f = fixture();
  for (let minute = 0; minute < 6; minute++)
    f.files.set(`${ROOT}/test/2026-10-28T11-5${minute}-00-000Z_device.ics`, wrap());
  await f.service.cleanup(config);
  assert.equal(f.files.size, 6);
  f.advance(2 * 3600000);
  await f.service.cleanup(config);
  assert.equal(f.files.size, 3);
});

test('color overrides update cached events immediately and clearing restores the feed color', async () => {
  const f = fixture();
  f.reply({
    status: 200,
    headers: {},
    text: body().replace('VERSION:2.0', 'VERSION:2.0\r\nCOLOR:tomato'),
  });
  await f.service.refreshAll();
  assert.equal(f.service.today().events[0].color, 'tomato');
  const snapshot = [...f.files.values()][0];
  f.service.configure([{ ...config, color: ' #AABBCC ' }]);
  assert.equal(f.service.today().events[0].color, '#aabbcc');
  f.service.configure([{ ...config, color: '' }]);
  assert.equal(f.service.today().events[0].color, 'tomato');
  assert.equal(f.calls.length, 1);
  assert.equal([...f.files.values()][0], snapshot);
  const otherDevice = fixture(f.files);
  await otherDevice.service.reload();
  assert.equal(otherDevice.service.today().events[0].color, 'tomato');
});
test('invalid configured colors are discarded and missing feed colors use a stable default', async () => {
  for (const color of ['url(https://example.com)', 'red;display:none', 'currentColor', 123])
    assert.equal(calendars([{ ...config, color }])[0].color, '');
  assert.equal(calendars([{ ...config, color: ' Navy ' }])[0].color, 'navy');
  const f = fixture();
  await f.service.refreshAll();
  const color = f.service.today().events[0].color;
  assert.match(color, /^#[a-f0-9]{6}$/);
  const otherDevice = fixture(f.files);
  await otherDevice.service.reload();
  assert.equal(otherDevice.service.today().events[0].color, color);
});

test('calendar IDs must be explicit safe strings, never coerced missing values or objects', () => {
  const invalid = [
    null,
    'calendar',
    {},
    { id: null },
    { id: 42 },
    { id: {} },
    { id: ['safe'] },
    { id: '' },
    { id: '../escape' },
  ];
  assert.deepEqual(calendars(invalid), []);
  assert.equal(calendars([{ ...config }]).length, 1);
});

test('removing or hiding a calendar during a request prevents snapshot publication', async () => {
  for (const next of [[], [{ ...config, enabled: false }]]) {
    let release;
    const f = fixture();
    f.reply(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.service.refreshAll();
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    f.service.configure(next);
    release({ status: 200, headers: {}, text: body() });
    await pending;
    assert.equal(f.files.size, 0);
    assert.equal(f.service.today().events.length, 0);
    assert.equal(f.service.pending.size, 0);
  }
});

test('changing a URL secret never reuses a validator from the old source', async () => {
  const f = fixture();
  await f.service.refreshAll();
  f.service.secret = () => 'https://example.com/new-token';
  f.reply({ status: 304, headers: {} });
  await f.service.refreshAll(true);
  assert.equal(f.calls.at(-1).headers['If-None-Match'], undefined);
  assert.match(f.service.today().statuses[0].error, /304/);
  assert.equal(f.service.today().events.length, 1);
});
