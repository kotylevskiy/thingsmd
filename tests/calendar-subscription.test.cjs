const test = require('node:test');
const assert = require('node:assert/strict');
const { saveSubscription, SubscriptionMismatch } = require('../plugin/calendar/subscription.cjs');
const { body } = require('./helpers/calendar.cjs');
const { newSource, sameUrl } = require('../plugin/calendar/identity.cjs');
const { createHash } = require('node:crypto');

function fixture(reply = async () => ({ status: 200, text: body() })) {
  const salt = 'test-salt-000000000';
  const calendar = {
    id: 'test',
    secretName: 'existing-secret',
    name: 'Work',
    color: '#123456',
    source: {
      salt,
      urlHash: createHash('sha256').update(`${salt}\nhttps://example.com/feed`).digest('hex'),
      uid: '',
      generation: '',
    },
  };
  const secrets = new Map();
  const refreshes = [];
  const plugin = {
    app: {
      secretStorage: {
        getSecret: (key) => secrets.get(key),
        setSecret: (key, value) => secrets.set(key, value),
        deleteSecret: (key) => secrets.delete(key),
      },
    },
    settings: { calendars: [calendar] },
    calendar: {
      request: reply,
      configure: () => {},
      states: new Map([['test', { snapshot: { body: body() }, validator: { url: 'old' } }]]),
      pending: new Map(),
      refresh: async (config, force) => refreshes.push({ config, force }),
    },
  };
  plugin.persistSettings = async (patch, { prepare, rollback } = {}) => {
    const next = { ...plugin.settings, ...patch(plugin.settings) };
    await prepare?.(next);
    try {
      await plugin.saveData?.(next);
    } catch (error) {
      await rollback?.();
      throw error;
    }
    plugin.settings = next;
  };
  return { plugin, calendar, secrets, refreshes };
}

async function replacementExpected(f) {
  let warning;
  await assert.rejects(
    saveSubscription(f.plugin, f.calendar, 'https://example.com/new'),
    (error) => {
      warning = error;
      return error instanceof SubscriptionMismatch;
    },
  );
  return warning.expected;
}

test('a new device can validate and save a URL for an existing calendar without duplicating it', async () => {
  const f = fixture();
  await saveSubscription(f.plugin, f.calendar, 'webcal://example.com/feed');
  assert.equal(f.secrets.get('existing-secret'), 'https://example.com/feed');
  assert.deepEqual(f.plugin.settings.calendars, [f.calendar]);
  assert.ok(!JSON.stringify(f.plugin.settings).includes('example.com'));
  assert.equal(f.refreshes.length, 1);
  assert.equal(f.refreshes[0].force, true);
  assert.equal(f.plugin.calendar.states.get('test').validator, undefined);
  assert.equal(f.plugin.calendar.states.get('test').snapshot.body, body());
});

test('invalid feeds, network failures and timeouts preserve the saved secret and cached events', async () => {
  for (const reply of [
    async () => ({ status: 404 }),
    async () => ({ status: 200, text: '<html>Login</html>' }),
    async () => {
      throw new Error('private-token');
    },
    () => new Promise(() => {}),
  ]) {
    const f = fixture(reply);
    f.secrets.set('existing-secret', 'https://example.com/old');
    const state = f.plugin.calendar.states.get('test');
    await assert.rejects(
      saveSubscription(f.plugin, f.calendar, 'https://example.com/new', { timeoutMs: 5 }),
      /Unable to load a valid ICS/,
    );
    assert.equal(f.secrets.get('existing-secret'), 'https://example.com/old');
    assert.equal(f.plugin.calendar.states.get('test'), state);
    assert.equal(f.refreshes.length, 0);
  }
});

test('a different URL with the same calendar UID is accepted without replacing the source', async () => {
  const f = fixture(async () => ({
    status: 200,
    text: body().replace('VERSION:2.0', 'VERSION:2.0\r\nUID:calendar-a'),
  }));
  f.calendar.source = await newSource('https://example.com/original', 'calendar-a');
  await saveSubscription(f.plugin, f.calendar, 'https://example.com/rotated');
  assert.equal(f.secrets.get('existing-secret'), 'https://example.com/rotated');
  assert.deepEqual(f.plugin.settings.calendars[0].source, f.calendar.source);
});

test('hash mismatch with a missing or different UID warns without changing the secret or source', async () => {
  for (const [expectedUid, incomingUid] of [
    ['calendar-a', 'calendar-b'],
    ['calendar-a', ''],
    ['', 'calendar-a'],
    ['', ''],
  ]) {
    const f = fixture(async () => ({
      status: 200,
      text: body().replace(
        'VERSION:2.0',
        `VERSION:2.0${incomingUid ? `\r\nUID:${incomingUid}` : ''}`,
      ),
    }));
    f.calendar.source = await newSource('https://example.com/original', expectedUid);
    f.secrets.set('existing-secret', 'https://example.com/original');
    const original = JSON.stringify(f.plugin.settings);
    await assert.rejects(
      saveSubscription(f.plugin, f.calendar, 'https://example.com/other'),
      SubscriptionMismatch,
    );
    assert.equal(f.secrets.get('existing-secret'), 'https://example.com/original');
    assert.equal(JSON.stringify(f.plugin.settings), original);
    assert.equal(f.refreshes.length, 0);
  }
});

test('a confirmed replacement preserves presentation and starts a fresh cache generation', async () => {
  const f = fixture();
  f.secrets.set('existing-secret', 'https://example.com/feed');
  let warning;
  try {
    await saveSubscription(f.plugin, f.calendar, 'https://example.com/new');
  } catch (error) {
    warning = error;
  }
  assert.ok(warning instanceof SubscriptionMismatch);
  assert.ok(!JSON.stringify(warning).includes('https://example.com/feed'));
  assert.ok(!JSON.stringify(warning).includes('https://example.com/new'));
  await saveSubscription(f.plugin, f.calendar, 'https://example.com/new', {
    replace: true,
    expected: warning.expected,
  });
  const saved = f.plugin.settings.calendars[0];
  assert.equal(saved.id, f.calendar.id);
  assert.equal(saved.name, f.calendar.name);
  assert.equal(saved.color, f.calendar.color);
  assert.ok(saved.source.generation);
  assert.deepEqual(saved.source.retiredGenerations, ['']);
  assert.equal(await sameUrl(saved.source, 'https://example.com/new'), true);
  assert.equal(f.plugin.calendar.states.get('test').snapshot, undefined);
  assert.equal(f.secrets.get('existing-secret'), 'https://example.com/new');
});

test('replacement refuses a stale confirmation after source or local secret changes', async () => {
  for (const target of ['source', 'secret']) {
    const f = fixture();
    const expected = await replacementExpected(f);
    if (target === 'source') f.calendar.source = await newSource('https://example.com/external');
    else f.secrets.set('existing-secret', 'https://example.com/external');
    await assert.rejects(
      saveSubscription(f.plugin, f.calendar, 'https://example.com/new', {
        replace: true,
        expected,
      }),
      /source changed/,
    );
    assert.notEqual(f.secrets.get('existing-secret'), 'https://example.com/new');
  }
});

test('a failed replacement settings write restores the previous secret and cache', async () => {
  const f = fixture();
  f.secrets.set('existing-secret', 'https://example.com/feed');
  const oldState = f.plugin.calendar.states.get('test');
  f.plugin.saveData = async () => {
    throw new Error('disk unavailable');
  };
  const expected = await replacementExpected(f);
  await assert.rejects(
    saveSubscription(f.plugin, f.calendar, 'https://example.com/new', {
      replace: true,
      expected,
    }),
    /disk unavailable/,
  );
  assert.equal(f.secrets.get('existing-secret'), 'https://example.com/feed');
  assert.equal(f.plugin.settings.calendars[0], f.calendar);
  assert.equal(f.plugin.calendar.states.get('test'), oldState);
});

test('an existing calendar without identity or a local secret never trusts the first pasted URL', async () => {
  const f = fixture();
  delete f.calendar.source;
  await assert.rejects(
    saveSubscription(f.plugin, f.calendar, 'https://example.com/feed'),
    SubscriptionMismatch,
  );
  assert.equal(f.secrets.size, 0);
});

test('a legacy cached UID takes precedence over an unverified local secret', async () => {
  const f = fixture(async () => ({
    status: 200,
    text: body().replace('VERSION:2.0', 'VERSION:2.0\r\nUID:wrong-calendar'),
  }));
  delete f.calendar.source;
  f.secrets.set('existing-secret', 'https://example.com/feed');
  f.plugin.calendar.states.get('test').snapshot.parsed = { uid: 'expected-calendar' };
  await assert.rejects(
    saveSubscription(f.plugin, f.calendar, 'https://example.com/feed'),
    SubscriptionMismatch,
  );
  assert.equal(f.calendar.source, undefined);
});

test('cancellation, unload, removal and concurrent secret edits reject late validation', async () => {
  const changes = [
    (f) => {
      f.plugin.calendar.disposed = true;
    },
    (f) => {
      f.plugin.settings.calendars = [];
    },
    (f) => {
      f.secrets.set('existing-secret', 'external URL');
    },
    () => {},
  ];
  for (const [index, change] of changes.entries()) {
    const f = fixture(async () => {
      change(f);
      return { status: 200, text: body() };
    });
    await assert.rejects(
      saveSubscription(f.plugin, f.calendar, 'https://example.com/feed', {
        cancelled: () => index === 3,
      }),
    );
    assert.notEqual(f.secrets.get('existing-secret'), 'https://example.com/feed');
    assert.equal(f.refreshes.length, 0);
  }
});

test('an in-flight download from the previous URL cannot publish after the new URL is saved', async () => {
  const { CalendarService } = require('../plugin/calendar/service.cjs');
  const f = fixture();
  const files = new Map();
  let release;
  f.secrets.set('existing-secret', 'https://example.com/old');
  f.calendar.source = await newSource('https://example.com/old', 'shared-calendar');
  const feed = (title) => body(title).replace('VERSION:2.0', 'VERSION:2.0\r\nUID:shared-calendar');
  const service = (f.plugin.calendar = new CalendarService({
    now: () => Date.parse('2026-10-28T12:00:00Z'),
    secret: (name) => f.secrets.get(name),
    storage: {
      list: async (folder) => [...files.keys()].filter((p) => p.startsWith(folder + '/')),
      read: async (p) => files.get(p),
      create: async (p, value) => files.set(p, value),
    },
    request: ({ url }) =>
      url.endsWith('/old')
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ status: 200, text: feed('New subscription') }),
  }));
  service.configure([f.calendar]);
  const previous = service.refreshAll(true);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const saved = saveSubscription(f.plugin, f.calendar, 'https://example.com/new');
  while (f.secrets.get('existing-secret').endsWith('/old'))
    await new Promise((resolve) => setImmediate(resolve));
  release({ status: 200, text: feed('Old subscription') });
  await Promise.all([previous, saved]);
  assert.equal(files.size, 1);
  assert.ok([...files.values()][0].includes('New subscription'));
  assert.equal(service.today().events[0].title, 'New subscription');
});
