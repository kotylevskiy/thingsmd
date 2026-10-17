const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createMainCapture = require('../plugin/global-capture-main.cjs');
function fixture() {
  const contents = new EventEmitter();
  const bindings = new Map([['unrelated', () => {}]]);
  let captures = 0;
  contents.send = () => captures++;
  const win = {
    webContents: contents,
    isDestroyed: () => false,
    isMinimized: () => false,
    show() {},
    focus() {},
  };
  const bridge = createMainCapture(win, 'capture', {
    register(key, callback) {
      if (bindings.has(key)) return false;
      bindings.set(key, callback);
      return true;
    },
    unregister(key) {
      bindings.delete(key);
    },
  });
  bridge.register('old');
  bridge.register('new');
  return { contents, bindings, bridge, captures: () => captures };
}
for (const kind of ['legacy reload', 'reload', 'renderer crash', 'window destroyed'])
  test(`main capture cleans owned bindings after ${kind}`, async () => {
    const f = fixture();
    f.bridge.activate();
    if (kind === 'legacy reload')
      f.contents.emit('did-start-navigation', {}, 'app://obsidian.md', false, true);
    if (kind === 'reload')
      f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    if (kind === 'renderer crash') f.contents.emit('render-process-gone');
    if (kind === 'window destroyed') f.contents.emit('destroyed');
    await new Promise(setImmediate);
    assert.deepEqual([...f.bindings.keys()], ['unrelated']);
    assert.equal(f.captures(), 0, 'Queued activation cannot notify a retired renderer');
    assert.equal(f.bridge.register('late'), false);
    assert.equal(f.contents.eventNames().length, 0, 'Lifecycle listeners are removed');
    f.bridge.dispose();
  });
test('subframe and in-page navigation keep the current capture binding', () => {
  const f = fixture();
  f.contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  assert.equal(f.bindings.has('old'), true);
  f.bridge.unregister('unrelated');
  assert.equal(f.bindings.has('unrelated'), true);
  f.bridge.dispose();
});
