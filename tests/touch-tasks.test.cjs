const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const handlers = new Map(),
    classes = new Set(),
    menus = [];
  const row = {
    isConnected: true,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    closest: () => null,
  };
  const checkbox = {
    closest: (selector) => (selector.startsWith('.ot-task[') ? row : null),
    matches: () => true,
  };
  let timer,
    changes = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('plugin/tasks/touch-tasks.cjs', 'utf8'), {
    module,
    document: { defaultView: {} },
    setTimeout: (callback) => {
      timer = callback;
      return 1;
    },
    clearTimeout: () => {
      timer = null;
    },
    Date,
    Math,
  });
  module.exports({
    registerDomEvent: (target, type, handler) => handlers.set(type, handler),
    register() {},
    tasksChanged: () => {
      changes++;
      assert.equal(classes.has('ot-touch-pending'), false);
    },
    showTaskMenu: (target) => menus.push(target),
  });
  const point = { identifier: 1, clientX: 10, clientY: 10 };
  const start = () => handlers.get('touchstart')({ target: checkbox, touches: [point] });
  const end = () => {
    let prevented = false;
    handlers.get('touchend')({
      changedTouches: [point],
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  const container = { querySelector: () => (classes.has('ot-touch-pending') ? row : null) };
  return {
    handlers,
    row,
    menus,
    classes,
    start,
    end,
    hold: () => timer(),
    defer: () => module.exports.deferTouchRender(container),
    changes: () => changes,
  };
}

test('checkbox holds keep their row through metadata refreshes and replay one refresh after release', () => {
  const f = fixture();
  f.start();
  assert.equal(f.defer(), true);
  assert.equal(f.defer(), true);
  assert.equal(f.changes(), 0);
  f.hold();
  assert.equal(f.end(), true, 'The held checkbox must not synthesize a completion click');
  assert.deepEqual(f.menus, [f.row]);
  assert.equal(f.changes(), 1);
  assert.equal(f.defer(), false);
  assert.equal(f.classes.has('ot-touch-held'), false);
});

test('canceled and scrolling gestures release their pending refresh without opening a menu', () => {
  for (const cancel of ['touchcancel', 'blur', 'touchmove']) {
    const f = fixture();
    f.start();
    f.defer();
    f.handlers.get(cancel)({ touches: [{ identifier: 1, clientX: 40, clientY: 40 }] });
    assert.equal(f.defer(), false);
    assert.equal(f.changes(), 1);
    assert.deepEqual(f.menus, []);
  }
});
