const test = require('node:test');
const assert = require('node:assert/strict');
const { install, placeLinks } = require('../plugin/sidebar-lifecycle.cjs');
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
function fixture() {
  let changes, cleanup, resume;
  let mounts = 0,
    disconnected = false;
  class Observer {
    constructor(callback) {
      changes = callback;
    }
    observe(root, options) {
      assert.deepEqual(options, { childList: true, subtree: true });
    }
    disconnect() {
      disconnected = true;
    }
  }
  const root = { ownerDocument: { defaultView: { MutationObserver: Observer }, hidden: false } };
  install(
    {
      mountListLinks: () => mounts++,
      register: (callback) => {
        cleanup = callback;
      },
      registerDomEvent: (doc, event, callback) => {
        resume = callback;
      },
    },
    root,
  );
  const node = (matches, nested = false) => ({
    nodeType: 1,
    matches: () => matches,
    querySelector: () => nested,
  });
  return {
    changes: (addedNodes = [], removedNodes = []) => changes([{ addedNodes, removedNodes }]),
    node,
    root,
    cleanup: () => cleanup(),
    resume: () => resume(),
    mounts: () => mounts,
    disconnected: () => disconnected,
  };
}
test('late explorer creation and removal of shortcuts retry mounting without a layout event', async () => {
  const f = fixture();
  f.changes([f.node(true)]);
  f.changes([f.node(false, true)]);
  await delay();
  assert.equal(f.mounts(), 1, 'Structural changes are coalesced');
  f.changes([], [f.node(true)]);
  await delay();
  assert.equal(f.mounts(), 2);
  f.changes([f.node(false)]);
  await delay();
  assert.equal(f.mounts(), 2, 'Ordinary task and folder content updates do not remount');
  f.cleanup();
});
test('returning from background retries mounting and unload cancels pending work', async () => {
  const f = fixture();
  f.root.ownerDocument.hidden = true;
  f.resume();
  assert.equal(f.mounts(), 0);
  f.root.ownerDocument.hidden = false;
  f.resume();
  assert.equal(f.mounts(), 1);
  f.changes([f.node(true)]);
  f.cleanup();
  await delay();
  assert.equal(f.mounts(), 1);
  assert.equal(f.disconnected(), true);
});
test('shortcuts follow a replaced file list without repeatedly moving healthy DOM', () => {
  const parentElement = {};
  let moves = 0;
  const nav = { parentElement: {}, nextElementSibling: null };
  const files = {
    parentElement,
    before: (element) => {
      moves++;
      element.parentElement = parentElement;
      element.nextElementSibling = files;
    },
  };
  placeLinks(files, nav);
  assert.equal(moves, 1);
  placeLinks(files, nav);
  assert.equal(moves, 1);
  nav.nextElementSibling = null;
  placeLinks(files, nav);
  assert.equal(moves, 2);
});
