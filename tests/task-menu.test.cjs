const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(native = false) {
  const notices = [],
    opened = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('plugin/task-menu.cjs', 'utf8'), {
    module,
    document: { defaultView: {} },
    require: () => ({
      Notice: class {
        constructor(message) {
          notices.push(message);
        }
      },
    }),
  });
  let saves = 0;
  const card = {
    taskDraft: {},
    finishTask: async () => {
      saves++;
      return true;
    },
  };
  const row = {
    dataset: { taskId: 'task' },
    getBoundingClientRect: () => ({}),
    closest: () => (native ? { _thingsCard: card } : null),
  };
  const active = {
    ...card,
    containerEl: { contains: (node) => node === row },
    contentEl: { contains: (node) => node === row },
  };
  const dormant = { containerEl: { contains: () => false } };
  const plugin = {
    app: {
      workspace: {
        getLeavesOfType: (type) =>
          type === 'markdown' ? [{ view: dormant }] : [{ view: dormant }, { view: active }],
      },
    },
    register() {},
    registerDomEvent() {},
    taskRecords: async () => [{ meta: { id: 'task' } }],
    openDialog: (Dialog, ctx) => opened.push(ctx),
  };
  module.exports(plugin);
  return { plugin, row, active, card, notices, opened, saves: () => saves };
}

for (const native of [false, true])
  test(`Move skips deferred views and saves its owning ${native ? 'native card' : 'list'} draft`, async () => {
    const f = fixture(native);
    await f.plugin.openTaskMove(f.row);
    assert.deepEqual(f.notices, []);
    assert.equal(f.opened.length, 1);
    assert.equal(f.opened[0].card, native ? f.card : f.active);
    assert.equal(f.saves(), 1);
  });
