const test = require('node:test');
const assert = require('node:assert/strict');
const installSettings = require('../plugin/settings/settings-service.cjs');
const installSync = require('../plugin/calendar/settings-sync.cjs');
const { CalendarService } = require('../plugin/calendar/service.cjs');
const { newSource } = require('../plugin/calendar/identity.cjs');
const { body } = require('./helpers/calendar.cjs');
const feed = (uid, title = uid) => body(title).replace('VERSION:2.0', `VERSION:2.0\r\nUID:${uid}`);

async function fixture({ legacy = false } = {}) {
  const a = {
    id: 'shared',
    name: 'Work',
    secretName: 'thingsmd-calendar-shared',
    enabled: true,
    source: await newSource('https://example.com/a', 'calendar-a', 'source-a'),
  };
  const b = {
    ...a,
    source: await newSource('https://example.com/b', 'calendar-b', 'source-b', ['source-a']),
  };
  if (legacy) delete a.source;
  let disk = { timeZone: 'UTC', tasksFolder: 'ThingsMD', calendars: [a] };
  const files = new Map(),
    secrets = new Map([['thingsmd-calendar-shared', 'https://example.com/a']]),
    requests = [],
    writes = [];
  const plugin = {
    loadData: async () => {
      if (disk === 'invalid-json') throw new Error('Partial JSON');
      return structuredClone(disk);
    },
    saveData: async (data) => {
      disk = structuredClone(data);
      writes.push(data);
    },
    register: () => {},
  };
  await installSettings(plugin);
  const service = (plugin.calendar = new CalendarService({
    now: () => Date.parse('2026-10-28T12:00:00Z'),
    synchronize: () => plugin.syncCalendarSettings(),
    storage: {
      list: async (folder) => [...files.keys()].filter((path) => path.startsWith(folder + '/')),
      read: async (path) => {
        if (!files.has(path)) throw new Error('Missing');
        return files.get(path);
      },
      create: async (path, text) => files.set(path, text),
      remove: async (path, expected) => {
        if (expected === undefined || files.get(path) === expected) files.delete(path);
      },
    },
    secret: (name) => secrets.get(name),
    request: async ({ url }) => {
      requests.push(url);
      return { status: 200, text: url.endsWith('/a') ? feed('calendar-a') : feed('calendar-b') };
    },
  }));
  service.configure(plugin.settings.calendars);
  installSync(plugin);
  return {
    plugin,
    service,
    a,
    b,
    files,
    secrets,
    requests,
    writes,
    disk: () => disk,
    setDisk: (value) => {
      disk = value;
    },
    receive: (calendar, extra = {}) => {
      disk = { ...disk, ...extra, calendars: calendar ? [calendar] : [] };
    },
  };
}

test('synced calendar settings keep the locally derived secret key', async () => {
  const f = await fixture();
  f.receive({ ...f.a, secretName: 'stale-key-label' });
  await f.service.refreshAll(true);

  assert.equal(f.plugin.settings.calendars[0].secretName, 'thingsmd-calendar-shared');
  assert.deepEqual(f.requests, ['https://example.com/a']);
  assert.equal(f.service.today().events[0].title, 'calendar-a');
});

test('a running device adopts the synced source before refreshing and rejects its old local URL', async () => {
  const f = await fixture();
  await f.service.refreshAll();
  f.receive(f.b);
  await f.service.refreshAll(true);
  assert.equal(f.plugin.settings.calendars[0].source.uid, 'calendar-b');
  assert.equal(f.service.config[0].source.uid, 'calendar-b');
  assert.equal(f.service.today().events.length, 0);
  assert.match(f.service.today().statuses[0].error, /does not match/);
  assert.equal(f.secrets.get('thingsmd-calendar-shared'), 'https://example.com/a');
  assert.ok([...f.files.keys()].every((path) => path.endsWith('_s-source-a.ics')));
  f.secrets.set('thingsmd-calendar-shared', 'https://example.com/b');
  await f.service.refreshAll(true);
  assert.equal(f.service.today().events[0].title, 'calendar-b');
  assert.ok([...f.files.keys()].every((path) => path.endsWith('_s-source-b.ics')));
});

test('settings received during an HTTP request discard its old response without restarting', async () => {
  const f = await fixture();
  let release;
  const request = f.service.request;
  f.service.request = (options) => {
    f.service.request = request;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = f.service.refreshAll(true);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  f.receive(f.b);
  release({ status: 200, text: feed('calendar-a', 'Obsolete response') });
  await pending;
  assert.equal(f.files.size, 0);
  assert.equal(f.service.config[0].source.uid, 'calendar-b');
  assert.equal(f.writes.length, 0);
});

test('a source update while reading the secret is checked before the HTTP request starts', async () => {
  const f = await fixture();
  const secret = f.service.secret;
  f.service.secret = async () => {
    f.service.secret = secret;
    f.receive(f.b);
    f.secrets.set('thingsmd-calendar-shared', 'https://example.com/b');
    return 'https://example.com/a';
  };
  await f.service.refreshAll(true);
  assert.deepEqual(f.requests, ['https://example.com/b']);
  assert.equal(f.service.today().events[0].title, 'calendar-b');
});

test('a synced replacement invalidates an old in-flight 304 response and its validator', async () => {
  const f = await fixture();
  const request = f.service.request;
  f.service.request = async (options) => ({
    ...(await request(options)),
    headers: { ETag: 'old-etag' },
  });
  await f.service.refreshAll();
  let release;
  f.service.request = () => {
    f.service.request = request;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = f.service.refreshAll(true);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  f.receive(f.b);
  release({ status: 304, headers: { ETag: 'old-etag' } });
  await pending;
  assert.equal(f.service.config[0].source.uid, 'calendar-b');
  assert.equal(f.service.state(f.service.config[0]).validator, undefined);
  assert.equal(f.service.today().events.length, 0);
});

test('first-time identity capture uses the settings queue without losing the verified response', async () => {
  const { rememberSource } = require('../plugin/calendar/identity.cjs');
  const f = await fixture({ legacy: true });
  f.service.verified = (config, url, parsed) => rememberSource(f.plugin, config, url, parsed);
  await f.service.refreshAll();
  assert.equal(f.disk().calendars[0].source.uid, 'calendar-a');
  assert.equal(f.service.today().events[0].title, 'calendar-a');
  assert.equal(f.files.size, 1);
  assert.equal(f.requests.length, 1);
});

test('a sync update racing with cache creation removes the stale write before publishing it', async () => {
  const f = await fixture();
  f.service.storage.create = async (path, text) => {
    f.files.set(path, text);
    f.receive(f.b);
  };
  await f.service.refreshAll(true);
  assert.equal(f.files.size, 0);
  assert.equal(f.service.today().events.length, 0);
  assert.equal(f.service.config[0].source.uid, 'calendar-b');
});

test('local preference edits merge against synced calendar settings instead of restoring an old source', async () => {
  const f = await fixture();
  f.receive(f.b, { globalCaptureHotkey: 'Control+X', remoteExtra: 'preserve' });
  await f.plugin.persistSettings((settings) => ({
    calendars: settings.calendars.map((c) => ({ ...c, color: 'tomato' })),
  }));
  assert.equal(f.disk().calendars[0].source.uid, 'calendar-b');
  assert.equal(f.disk().calendars[0].color, 'tomato');
  assert.equal(f.disk().globalCaptureHotkey, 'Control+X');
  assert.equal(f.disk().remoteExtra, 'preserve');
  assert.equal(f.plugin.settings.calendars[0].source.uid, 'calendar-b');
  assert.equal(f.plugin.settings.globalCaptureHotkey, '');
});

test('a synced change during save preparation rejects the stale save and rolls back its side effect', async () => {
  const f = await fixture();
  let prepared = false;
  await assert.rejects(
    f.plugin.persistSettings(
      { showProjectProgress: false },
      {
        prepare: () => {
          prepared = true;
          f.receive(f.b);
        },
        rollback: () => {
          prepared = false;
        },
      },
    ),
    /Settings changed/,
  );
  assert.equal(prepared, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.plugin.settings.calendars[0].source.uid, 'calendar-b');
  assert.equal(f.disk().calendars[0].source.uid, 'calendar-b');
});

test('incomplete settings pause refreshes without losing the last good cache, then recover', async () => {
  const f = await fixture();
  await f.service.refreshAll();
  const valid = f.disk();
  const count = f.requests.length;
  for (const data of [
    null,
    'invalid-json',
    {},
    { ...valid, calendars: 'partial' },
    { ...valid, calendars: [{ ...f.a, source: undefined }] },
  ]) {
    f.setDisk(data);
    await f.service.refreshAll(true);
    assert.equal(f.requests.length, count);
    assert.equal(f.service.today().events[0].title, 'calendar-a');
    assert.match(f.service.today().statuses[0].error, /temporarily unavailable/);
  }
  f.setDisk(valid);
  await f.service.refreshAll(true);
  assert.equal(f.service.today().statuses[0].error, '');
  assert.equal(f.service.today().events[0].title, 'calendar-a');
});

test('synced calendar removal stops requests and a synced home change redirects new cache files', async () => {
  const f = await fixture();
  f.receive(null);
  await f.service.refreshAll(true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.service.config.length, 0);
  f.receive(f.b, { tasksFolder: 'Synced home' });
  f.secrets.set('thingsmd-calendar-shared', 'https://example.com/b');
  await f.service.refreshAll(true);
  assert.equal(f.plugin.settings.tasksFolder, 'Synced home');
  assert.equal(f.service.root, 'Synced home/Calendars');
  assert.ok([...f.files.keys()].every((path) => path.startsWith('Synced home/Calendars/shared/')));
});
