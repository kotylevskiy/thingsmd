const test = require('node:test');
const assert = require('node:assert/strict');
const { install, placeLinks, repaintLinks } = require('../plugin/sidebar-lifecycle.cjs');
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
function fixture() {
  let changes, cleanup, resume;
  const watched = [],
    drawers = [
      { getBoundingClientRect: () => ({ width: 0, height: 0 }), querySelectorAll: () => [] },
      { getBoundingClientRect: () => ({ width: 0, height: 0 }), querySelectorAll: () => [] },
    ],
    events = new Map();
  let mounts = 0,
    disconnected = false;
  class Observer {
    constructor(callback) {
      changes = callback;
    }
    observe(target, options) {
      watched.push(target);
      assert.deepEqual(
        options,
        target === root
          ? { childList: true, subtree: true }
          : { attributes: true, attributeFilter: ['class', 'style'] },
      );
    }
    disconnect() {
      disconnected = true;
    }
  }
  const root = {
    ownerDocument: { defaultView: { MutationObserver: Observer }, hidden: false },
    querySelectorAll: () => drawers,
  };
  install(
    {
      mountListLinks: () => mounts++,
      register: (callback) => {
        cleanup = callback;
      },
      registerDomEvent: (doc, event, callback) => {
        resume = callback;
        events.set(event, callback);
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
    visibility: (target) => changes([{ type: 'attributes', target }]),
    transition: (target) => events.get('transitionend')({ target }),
    watched,
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
test('repainting a revealed shortcut reuses its controls and preserves focus without scrolling', () => {
  const anchor = {},
    calls = [];
  const focused = { focus: (options) => calls.push(['focus', options]) };
  const parent = { insertBefore: (node, next) => calls.push(['insert', node, next]) };
  const nav = {
    parentNode: parent,
    nextSibling: anchor,
    ownerDocument: { activeElement: focused },
    contains: (node) => node === focused,
    remove: () => calls.push(['remove']),
  };
  repaintLinks(nav);
  assert.deepEqual(calls, [
    ['remove'],
    ['insert', nav, anchor],
    ['focus', { preventScroll: true }],
  ]);
});
test('mobile drawer visibility changes retry mounting without a DOM replacement or scroll', async () => {
  const f = fixture();
  assert.equal(
    f.watched.length,
    3,
    'Observe structure globally but visibility only on the two drawer elements',
  );
  f.visibility(f.node(true));
  f.visibility(f.node(true));
  await delay();
  assert.equal(f.mounts(), 1);
  f.visibility(f.node(false));
  await delay();
  assert.equal(f.mounts(), 1, 'Ordinary row styling does not remount shortcuts');
  f.visibility(f.node(true));
  f.cleanup();
  await delay();
  assert.equal(f.mounts(), 1, 'Unload cancels a pending reveal refresh');
});
test('drawer transition completion refreshes shortcuts but note animations do not', async () => {
  const f = fixture();
  f.transition(f.node(true));
  await delay();
  assert.equal(f.mounts(), 1);
  f.transition(f.node(false));
  await delay();
  assert.equal(f.mounts(), 1);
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
