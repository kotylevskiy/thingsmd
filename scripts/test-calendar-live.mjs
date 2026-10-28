// Opt-in provider checks. Never reads .env or writes downloaded event contents.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get } from 'node:https';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CalendarService } = require('../plugin/calendar/service.cjs');
const { parseCalendar } = require('../plugin/calendar/parser.cjs');
const feeds = JSON.parse(
  await readFile(new URL('../tests/fixtures/calendar/live-feeds.json', import.meta.url)),
);
function request(options, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = get(
      options.url,
      { headers: options.headers, rejectUnauthorized: true },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.statusCode !== 304
        ) {
          response.resume();
          const next = new URL(response.headers.location, options.url);
          if (redirects >= 3 || next.protocol !== 'https:')
            return reject(Error('Unexpected redirect'));
          resolve(request({ ...options, url: next.href }, redirects + 1));
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) req.destroy(Error('Feed exceeds limit'));
          else chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    req.on('error', () => reject(Error('Public provider request failed')));
    req.setTimeout(25000, () => req.destroy(Error('Timeout')));
  });
}
for (const feed of feeds) {
  const files = new Map(),
    responses = [];
  const service = new CalendarService({
    storage: {
      list: async () => [...files.keys()],
      read: async (path) => files.get(path),
      create: async (path, body) => files.set(path, body),
      remove: async (path) => files.delete(path),
    },
    request: async (options) => {
      const response = await request(options);
      responses.push(response.status);
      return response;
    },
    secret: async () => feed.url,
  });
  service.configure([{ id: feed.id, name: feed.name, secretName: feed.id }]);
  try {
    await service.refreshAll();
    assert.equal(service.today().statuses[0].error, '', `${feed.id} failed`);
    assert.equal(files.size, 1);
    const parsed = parseCalendar([...files.values()][0]);
    let allDay = 0,
      timed = 0;
    for (const group of parsed.groups.values())
      for (const event of group.values()) {
        if (event.startDate.isDate) allDay++;
        else timed++;
      }
    await service.refreshAll(true);
    assert.equal(service.today().statuses[0].error, '', `${feed.id} conditional refresh failed`);
    console.log(
      JSON.stringify({
        provider: feed.id,
        responses,
        allDay,
        timed,
        snapshots: files.size,
        today: service.today().events.length,
      }),
    );
  } finally {
    service.dispose();
  }
}
