const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function fixture(now = Date.now()) {
  const filename = require.resolve('../plugin/tasks/task-refresh.cjs');
  const localRequire = createRequire(filename),
    module = { exports: {} };
  let poll;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    console,
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
    },
    window: {
      setInterval: (callback) => {
        poll = callback;
        return 1;
      },
    },
    require: (name) => (name === 'obsidian' ? { Notice: class {} } : localRequire(name)),
  });
  const cleanup = [];
  let maintenance = 0,
    changes = 0;
  const records = [];
  const plugin = {
    register: (fn) => cleanup.push(fn),
    registerEvent() {},
    registerInterval() {},
    app: { vault: { on() {} } },
    settings: { timeZone: 'UTC', trashRetention: 'never' },
    indexedTasks: async () => records,
    probeTaskFiles: async () => false,
    repeating: { tick: async () => {} },
    maintainArchives: async () => {
      maintenance++;
    },
    taskRecords: async () => [],
    tasksChanged: () => {
      changes++;
    },
  };
  await module.exports(plugin);
  return {
    plugin,
    poll: () => poll(),
    unload: () => cleanup.forEach((fn) => fn()),
    counts: () => ({ maintenance, changes }),
    advance: (ms) => {
      now += ms;
    },
  };
}

test('background refresh stops before maintenance when unloaded during repeat reconciliation', async () => {
  const f = await fixture();
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  f.plugin.repeating.tick = () =>
    new Promise((resolve) => {
      release = resolve;
      started();
    });
  const work = f.poll();
  await entered;
  f.unload();
  release();
  await work;
  await f.poll();
  assert.deepEqual(f.counts(), { maintenance: 0, changes: 0 });
});

test('background refresh does not publish a read completed after unload', async () => {
  const f = await fixture();
  let release, entered;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  f.plugin.indexedTasks = () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const work = f.poll();
  await reading;
  f.unload();
  release([]);
  await work;
  assert.deepEqual(f.counts(), { maintenance: 0, changes: 0 });
});

test('unchanged maintenance ticks reuse the snapshot and skip archive and repeat work', async () => {
  const f = await fixture();
  let repeats = 0;
  f.plugin.repeating.tick = async () => {
    repeats++;
  };
  await f.poll();
  await f.poll();
  f.plugin.settings = { ...f.plugin.settings };
  await f.poll();
  assert.equal(repeats, 1);
  assert.deepEqual(f.counts(), { maintenance: 1, changes: 0 });
});

test('Trash expiration wakes maintenance without a task change or a new calendar day', async () => {
  const f = await fixture(Date.parse('2026-05-08T12:00:00Z'));
  const records = [{ meta: { deleted: true, deletedAt: '2026-05-01T12:00:02Z' } }];
  f.plugin.indexedTasks = async () => records;
  f.plugin.settings.trashRetention = '1-week';
  await f.poll();
  f.advance(1000);
  await f.poll();
  assert.equal(f.counts().maintenance, 1);
  f.advance(2000);
  await f.poll();
  assert.equal(f.counts().maintenance, 2);
});
