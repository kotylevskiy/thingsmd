const test = require('node:test');
const assert = require('node:assert/strict');
const { createCalendar } = require('../plugin/calendar/create.cjs');
const { body } = require('./helpers/calendar.cjs');
function fixture(reply = async () => ({ status: 200, text: body() })) {
  const secrets = new Map();
  const calls = [];
  const plugin = {
    app: {
      secretStorage: {
        setSecret: (key, value) => secrets.set(key, value),
        deleteSecret: (key) => secrets.delete(key),
      },
    },
    settings: { calendars: [] },
    calendar: {
      request: async (options) => {
        calls.push(options);
        return reply();
      },
    },
    updateSettings: async (next) => {
      plugin.settings = {
        ...plugin.settings,
        ...(typeof next === 'function' ? next(plugin.settings) : next),
      };
    },
  };
  return { plugin, secrets, calls };
}
test('calendar creation validates the feed before storing a secret or configuration', async () => {
  const f = fixture(async () => {
    assert.equal(f.secrets.size, 0);
    assert.deepEqual(f.plugin.settings.calendars, []);
    return { status: 200, text: body() };
  });
  const calendar = await createCalendar(f.plugin, {
    url: 'webcal://example.com/feed',
  });
  assert.equal(f.calls[0].url, 'https://example.com/feed');
  assert.equal(calendar.name, 'Calendar');
  assert.equal(f.secrets.get(calendar.secretName), 'https://example.com/feed');
  assert.ok(!JSON.stringify(f.plugin.settings).includes('example.com'));
});
test('invalid URL syntax never makes a request or creates anything', async () => {
  for (const url of [
    '',
    'garbage',
    'file:///secret',
    'http://example.com/feed',
    'https://user:password@example.com',
  ]) {
    const f = fixture();
    await assert.rejects(createCalendar(f.plugin, { url }));
    assert.equal(f.calls.length, 0);
    assert.equal(f.secrets.size, 0);
    assert.deepEqual(f.plugin.settings.calendars, []);
  }
});
test('failed, non-ICS and incomplete responses create no calendar or secret', async () => {
  for (const reply of [
    async () => ({ status: 404, text: body() }),
    async () => ({ status: 200, text: '<html>Sign in</html>' }),
    async () => ({ status: 200, text: body().replace('END:VCALENDAR', '') }),
    async () => {
      throw new Error('private URL');
    },
  ]) {
    const f = fixture(reply);
    await assert.rejects(
      createCalendar(f.plugin, { url: 'https://example.com/feed' }),
      /Unable to load a valid ICS/,
    );
    assert.equal(f.secrets.size, 0);
    assert.deepEqual(f.plugin.settings.calendars, []);
  }
});
test('timed-out and cancelled validation cannot create a calendar when the request finishes', async () => {
  let resolve;
  const f = fixture(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await assert.rejects(
    createCalendar(f.plugin, { url: 'https://example.com/feed' }, { timeoutMs: 5 }),
  );
  resolve({ status: 200, text: body() });
  await new Promise((done) => setImmediate(done));
  assert.equal(f.secrets.size, 0);
  assert.deepEqual(f.plugin.settings.calendars, []);
  const cancelled = fixture();
  await assert.rejects(
    createCalendar(
      cancelled.plugin,
      { url: 'https://example.com/feed' },
      { cancelled: () => true },
    ),
  );
  assert.equal(cancelled.secrets.size, 0);
  assert.deepEqual(cancelled.plugin.settings.calendars, []);
});
test('a failed settings write removes the newly allocated secret', async () => {
  const f = fixture();
  f.plugin.updateSettings = async () => {
    throw new Error('write failed');
  };
  await assert.rejects(
    createCalendar(f.plugin, { url: 'https://example.com/feed' }),
    /Unable to add/,
  );
  assert.equal(f.secrets.size, 0);
  assert.deepEqual(f.plugin.settings.calendars, []);
});

test('creation uses calendar NAME, then X-WR-CALNAME, then Calendar', async () => {
  for (const [properties, expected] of [
    ['NAME:Work\r\nX-WR-CALNAME:Other', 'Work'],
    ['X-WR-CALNAME:Personal', 'Personal'],
    ['', 'Calendar'],
    ['NAME:   \r\nX-WR-CALNAME: Holidays ', 'Holidays'],
    ['NAME: \r\nX-WR-CALNAME: ', 'Calendar'],
    ['NAME;LANGUAGE=fr:Équipe\r\nNAME;LANGUAGE=en:Team', 'Équipe'],
    ['NAME:Long calen\r\n dar', 'Long calendar'],
    [String.raw`NAME:Work\, travel\nPlans`, 'Work, travel Plans'],
    [String.raw`X-WR-CALNAME:Work\, travel`, 'Work, travel'],
    [String.raw`NAME;VALUE=TEXT:Literal\\n`, String.raw`Literal\n`],
    [`NAME:${'a'.repeat(120)}`, 'a'.repeat(100)],
  ]) {
    const text = body().replace('VERSION:2.0', `VERSION:2.0\r\n${properties}`);
    const f = fixture(async () => ({ status: 200, text }));
    const calendar = await createCalendar(f.plugin, { url: 'https://example.com/feed' });
    assert.equal(calendar.name, expected);
    assert.equal(f.plugin.settings.calendars[0].name, expected);
  }
});

test('cancelling a creation queued behind another settings save rolls back its secret', async () => {
  const f = fixture();
  let patch;
  let release;
  f.plugin.updateSettings = (value) => {
    patch = value;
    return new Promise((resolve, reject) => {
      release = () => {
        try {
          f.plugin.settings = patch(f.plugin.settings);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
    });
  };
  let cancelled = false;
  const creation = createCalendar(
    f.plugin,
    { url: 'https://example.com/feed' },
    { cancelled: () => cancelled },
  );
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  cancelled = true;
  release();
  await assert.rejects(creation, /Unable to add/);
  assert.equal(f.secrets.size, 0);
  assert.equal(f.plugin.settings.calendars.length, 0);
});

test('a creation finishing after plugin unload stores neither secret nor configuration', async () => {
  const f = fixture(async () => {
    f.plugin.calendar.disposed = true;
    return { status: 200, text: body() };
  });
  await assert.rejects(createCalendar(f.plugin, { url: 'https://example.com/feed' }), /cancelled/);
  assert.equal(f.secrets.size, 0);
  assert.equal(f.plugin.settings.calendars.length, 0);
});

test('a committed calendar is reported as created even if a post-save hook fails', async () => {
  const f = fixture();
  f.plugin.updateSettings = async (patch) => {
    f.plugin.settings = { ...f.plugin.settings, ...patch(f.plugin.settings) };
    throw new Error('UI refresh failed after saving');
  };
  const calendar = await createCalendar(f.plugin, { url: 'https://example.com/feed' });
  assert.equal(f.plugin.settings.calendars.length, 1);
  assert.equal(f.plugin.settings.calendars[0].id, calendar.id);
  assert.ok(f.secrets.has(calendar.secretName));
});
