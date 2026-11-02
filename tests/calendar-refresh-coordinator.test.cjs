const test = require('node:test');
const assert = require('node:assert/strict');
const { CalendarRefreshCoordinator } = require('../plugin/calendar/refresh-coordinator.cjs');

function fixture(read = async () => true) {
  const timers = new Map(),
    calls = [];
  let serial = 0;
  const service = {
    reload: async () => calls.push('reload'),
    refreshAll: async () => calls.push('refresh'),
  };
  const coordinator = new CalendarRefreshCoordinator(service, read, {
    setTimer: (callback) => {
      timers.set(++serial, callback);
      return serial;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return { coordinator, service, timers, calls };
}

test('consecutive synced changes coalesce into one deferred refresh and disposal cancels it', async () => {
  const f = fixture();
  await f.coordinator.synchronize();
  await f.coordinator.synchronize();
  assert.equal(f.timers.size, 1);
  assert.deepEqual(f.calls, []);
  const callback = [...f.timers.values()][0];
  f.coordinator.dispose();
  assert.equal(f.timers.size, 0);
  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls, []);
});

test('foreground polls do not overlap, recover from incomplete settings and continue during slow downloads', async () => {
  let reads = 0,
    releaseRead;
  const f = fixture(() => {
    reads++;
    return new Promise((resolve) => {
      releaseRead = resolve;
    });
  });
  const polling = f.coordinator.poll();
  await f.coordinator.poll();
  assert.equal(reads, 1);
  releaseRead(true);
  await polling;
  let releaseDownload;
  f.service.refreshAll = () =>
    new Promise((resolve) => {
      releaseDownload = resolve;
    });
  const refreshing = f.coordinator.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(releaseDownload);
  const nextPoll = f.coordinator.poll();
  assert.equal(reads, 2);
  releaseRead(false);
  await nextPoll;
  f.coordinator.readSettings = async () => {
    throw new Error('Incomplete sync');
  };
  await f.coordinator.poll();
  assert.equal(f.coordinator.polling, false);
  releaseDownload();
  await refreshing;
  f.coordinator.dispose();
});

test('disposal between cache reload and download prevents a late request', async () => {
  const f = fixture();
  f.service.reload = async () => f.coordinator.dispose();
  await f.coordinator.refresh();
  assert.deepEqual(f.calls, []);
});

test('cache reload failure does not start a download and a later trigger can recover', async () => {
  const f = fixture();
  f.service.reload = async () => {
    throw new Error('Unreadable cache');
  };
  await f.coordinator.refresh();
  assert.deepEqual(f.calls, []);
  f.service.reload = async () => f.calls.push('reload');
  await f.coordinator.refresh();
  assert.deepEqual(f.calls, ['reload', 'refresh']);
});
