import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CalendarService } = require('../plugin/calendar/service.cjs');
const { body, wrap } = require('../tests/helpers/calendar.cjs');
const files = new Map(),
  requests = [];
let endpoint = 'etag',
  clock = Date.parse('2026-10-28T12:00:00Z');
const server = createServer((req, res) => {
  requests.push({ path: req.url, headers: req.headers });
  if (req.url === '/rate') {
    res.writeHead(429, { 'Retry-After': '3600' });
    res.end();
    return;
  }
  if (req.url === '/missing') {
    res.writeHead(404);
    res.end();
    return;
  }
  if (req.url === '/slow') {
    setTimeout(() => {
      res.writeHead(200);
      res.end(body());
    }, 100);
    return;
  }
  if (req.url === '/bad') {
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end('BEGIN:VCALENDAR\nVERSION:2.0');
    return;
  }
  const headers =
    req.url === '/etag' ? { ETag: '"test"' } : { 'Last-Modified': 'Wed, 28 Oct 2026 10:00:00 GMT' };
  if (req.headers['if-none-match'] || req.headers['if-modified-since']) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/calendar', ...headers });
  res.end(req.url === '/empty' ? wrap() : body());
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const service = new CalendarService({
  storage: {
    list: async () => [...files.keys()],
    read: async (p) => files.get(p),
    create: async (p, b) => files.set(p, b),
    remove: async (p) => files.delete(p),
  },
  request: async (options) => {
    const r = await fetch(options.url, { headers: options.headers });
    return { status: r.status, headers: Object.fromEntries(r.headers), text: await r.text() };
  },
  secret: () => `${url}/${endpoint}`,
  now: () => clock,
});
service.configure([{ id: 'http', secretName: 'test' }]);
try {
  await service.refreshAll();
  await service.refreshAll(true);
  assert.equal(files.size, 1);
  assert.equal(requests.at(-1).headers['if-none-match'], '"test"');
  endpoint = 'modified';
  await service.refreshAll(true);
  await service.refreshAll(true);
  assert.ok(requests.at(-1).headers['if-modified-since']);
  assert.equal(files.size, 1);
  for (const route of ['bad', 'missing']) {
    endpoint = route;
    await service.refreshAll(true);
    assert.equal(files.size, 1);
    assert.equal(service.today().events.length, 1);
    assert.ok(service.today().statuses[0].error);
  }
  endpoint = 'rate';
  await service.refreshAll(true);
  const count = requests.length;
  await service.refreshAll(true);
  assert.equal(requests.length, count);
  clock += 3600001;
  endpoint = 'slow';
  service.timeoutMs = 10;
  await service.refreshAll(true);
  assert.match(service.today().statuses[0].error, /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(files.size, 1);
  endpoint = 'empty';
  service.timeoutMs = 1000;
  await service.refreshAll(true);
  assert.equal(service.today().events.length, 0);
  console.log(
    'PASS real localhost HTTP: ETag, Last-Modified, 304, 404, Retry-After/429, incomplete body, timeout/late response, empty snapshot',
  );
} finally {
  service.dispose();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
