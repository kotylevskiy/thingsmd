const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function fixture() {
  const filename = require.resolve('../plugin/tasks/task-refresh.cjs');
  const localRequire = createRequire(filename),
    module = { exports: {} };
  let poll;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    console,
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
  const plugin = {
    register: (fn) => cleanup.push(fn),
    registerEvent() {},
    registerInterval() {},
    app: { vault: { on() {} } },
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
  };
}

test('background refresh stops before maintenance when unloaded during repeat reconciliation', async () => {
  const f = await fixture();
  let release;
  f.plugin.repeating.tick = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const work = f.poll();
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
  f.plugin.taskRecords = () => {
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
  assert.deepEqual(f.counts(), { maintenance: 1, changes: 0 });
});
