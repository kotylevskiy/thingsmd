const test = require('node:test');
const assert = require('node:assert/strict');
const {
  newSource,
  sameUrl,
  matchesSource,
  sourceIdentity,
} = require('../plugin/calendar/identity.cjs');
const { parseCalendar } = require('../plugin/calendar/parser.cjs');
const { body, wrap } = require('./helpers/calendar.cjs');

test('URL fingerprints use a per-calendar salt and do not expose the URL', async () => {
  const url = 'https://example.com/private?token=never-store-me';
  const a = await newSource(url, 'calendar-a');
  const b = await newSource(url, 'calendar-a');
  assert.match(a.urlHash, /^[a-f0-9]{64}$/);
  assert.notEqual(a.urlHash, b.urlHash);
  assert.ok(!JSON.stringify(a).includes('never-store-me'));
  assert.equal(await sameUrl(a, url), true);
  assert.equal(await sameUrl(a, 'https://example.com/other'), false);
});

test('identity compares the URL first, then requires two nonempty equal calendar UIDs', async () => {
  const source = await newSource('https://example.com/original', 'calendar-a');
  assert.equal(await matchesSource(source, 'https://example.com/original', 'different-uid'), true);
  assert.equal(await matchesSource(source, 'https://example.com/rotated', 'calendar-a'), true);
  assert.equal(await matchesSource(source, 'https://example.com/other', 'calendar-b'), false);
  assert.equal(await matchesSource(source, 'https://example.com/other', ''), false);
  assert.equal(
    await matchesSource({ ...source, uid: '' }, 'https://example.com/other', 'calendar-a'),
    false,
  );
  assert.equal(await matchesSource(undefined, 'https://example.com/other', ''), false);
});

test('the parser takes identity from VCALENDAR, never from a meeting UID or calendar name', () => {
  assert.equal(parseCalendar(body()).uid, '');
  assert.equal(
    parseCalendar(body().replace('VERSION:2.0', 'VERSION:2.0\r\nUID:calendar-a')).uid,
    'calendar-a',
  );
  assert.equal(parseCalendar(wrap('UID:empty-calendar')).uid, 'empty-calendar');
  assert.equal(parseCalendar(wrap(`UID:${'a'.repeat(1025)}`)).uid, '');
});

test('source metadata accepts only fingerprints and safe cache generations', async () => {
  const source = await newSource('https://example.com/feed', 'calendar-a');
  assert.deepEqual(sourceIdentity({ ...source, url: 'secret' }), source);
  for (const patch of [
    { salt: '' },
    { urlHash: 'secret' },
    { generation: '../other' },
    { uid: 'line\nbreak' },
  ])
    assert.equal(sourceIdentity({ ...source, ...patch }), undefined);
  assert.equal(sourceIdentity({ ...source, urlHash: '', uid: '' }), undefined);
});

test('replacement metadata retains known retired generations without retiring the active one', async () => {
  const source = await newSource('https://example.com/new', 'calendar-a', 'active', [
    '',
    'old',
    'old',
    'active',
  ]);
  assert.deepEqual(source.retiredGenerations, ['', 'old']);
  assert.deepEqual(sourceIdentity(source), source);
  assert.equal(sourceIdentity({ ...source, retiredGenerations: ['../other'] }), undefined);
  assert.equal(sourceIdentity({ ...source, retiredGenerations: 'old' }), undefined);
});

test('legacy calendars bootstrap identity from established secrets or cached calendar UID', async () => {
  const bootstrap = require('../plugin/calendar/identity-bootstrap.cjs');
  const calendars = [
    { id: 'secret', secretName: 'secret' },
    { id: 'cache', secretName: 'missing' },
    { id: 'unknown' },
  ];
  const plugin = {
    settings: { calendars },
    app: {
      secretStorage: {
        getSecret: (name) => (name === 'secret' ? 'https://example.com/trusted' : null),
      },
    },
    calendar: {
      load: async (config) => ({ parsed: { uid: config.id === 'cache' ? 'cached-calendar' : '' } }),
      configure: () => {},
    },
    persistSettings: async (patch) => {
      plugin.settings = { ...plugin.settings, ...patch(plugin.settings) };
    },
  };
  await bootstrap(plugin);
  assert.equal(
    await sameUrl(plugin.settings.calendars[0].source, 'https://example.com/trusted'),
    true,
  );
  assert.equal(plugin.settings.calendars[1].source.uid, 'cached-calendar');
  assert.equal(plugin.settings.calendars[1].source.urlHash, '');
  assert.equal(plugin.settings.calendars[2].source, undefined);
});
