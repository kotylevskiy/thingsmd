const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(native = false, meta = {}) {
  const notices = [],
    opened = [],
    menus = [],
    dialogCalls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('plugin/task-menu.cjs', 'utf8'), {
    module,
    document: { defaultView: {} },
    require: (name) =>
      name === './task-status.cjs'
        ? require('../plugin/task-status.cjs')
        : name === './project-navigation.cjs'
          ? { destinations: async () => [] }
          : name === './task-controller.cjs'
            ? require('../plugin/task-controller.cjs')
            : {
                Menu: class {
                  constructor() {
                    this.items = [];
                  }
                  setUseNativeMenu() {}
                  addSeparator() {}
                  hide() {}
                  showAtMouseEvent() {
                    menus.push(this);
                  }
                  addItem(build) {
                    const entry = {
                      setTitle(title) {
                        this.title = title;
                        return this;
                      },
                      setIcon() {
                        return this;
                      },
                      setDisabled() {
                        return this;
                      },
                      onClick(action) {
                        this.action = action;
                        return this;
                      },
                    };
                    build(entry);
                    this.items.push(entry);
                  }
                },
                Notice: class {
                  constructor(message) {
                    notices.push(message);
                  }
                },
              },
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
    closest: () => (native ? { _thingsmdCard: card } : null),
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
    settings: {},
    register() {},
    registerDomEvent() {},
    taskRecords: async () => [{ meta: { id: 'task', ...meta } }],
    openDialog: (Dialog, ...args) => {
      opened.push(args[0]);
      dialogCalls.push(args);
    },
  };
  module.exports(plugin);
  return { plugin, row, active, card, notices, opened, menus, dialogCalls, saves: () => saves };
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

test('context-menu calendars save the owning draft and use the current task snapshot', async () => {
  for (const native of [false, true]) {
    for (const [label, kind] of [
      ['When…', 'when'],
      ['Deadline…', 'deadline'],
    ]) {
      const f = fixture(native, { when: '2099-05-15', deadline: '2099-06-02' });
      await f.plugin.showTaskMenu(f.row, {});
      const titles = f.menus[0].items.map((item) => item.title);
      assert.deepEqual(
        titles.slice(titles.indexOf('This Evening'), titles.indexOf('Anytime') + 1),
        ['This Evening', 'When…', 'Deadline…', 'Anytime'],
      );
      await f.menus[0].items.find((item) => item.title === label).action();
      assert.equal(f.saves(), 1);
      assert.equal(f.dialogCalls.length, 1);
      assert.equal(f.dialogCalls[0][0].meta.id, 'task');
      assert.equal(f.dialogCalls[0][1], kind);
      assert.deepEqual(f.notices, []);
    }
    const f = fixture(native);
    (native ? f.card : f.active).finishTask = async () => false;
    await f.plugin.showTaskMenu(f.row, {});
    await f.menus[0].items.find((item) => item.title === 'When…').action();
    assert.equal(f.dialogCalls.length, 0, 'A failed draft save must not open the calendar');
  }
  const template = fixture(false, { repeat: { next: '2099-05-15' } });
  await template.plugin.showTaskMenu(template.row, {});
  assert.equal(
    template.menus[0].items.some((item) => item.title === 'When…'),
    true,
  );
  assert.equal(
    template.menus[0].items.some((item) => item.title === 'Deadline…'),
    false,
  );
});
