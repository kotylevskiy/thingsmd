const { test } = require('node:test');
const assert = require('node:assert/strict');
const mainWorkspaceLeaf = require('../plugin/workspace-leaf.cjs');

test('navigation rejects active and recent sidebar panes', () => {
  const rootSplit = {};
  const main = { getRoot: () => rootSplit };
  const sidebar = { getRoot: () => ({}) };
  const workspace = {
    rootSplit,
    activeLeaf: sidebar,
    getMostRecentLeaf: () => sidebar,
    iterateAllLeaves: (visit) => [sidebar, main].forEach(visit),
    getLeaf: () => assert.fail('An existing main pane should be reused'),
  };
  assert.equal(mainWorkspaceLeaf(workspace), main);
  workspace.activeLeaf = main;
  assert.equal(mainWorkspaceLeaf(workspace), main);
  workspace.activeLeaf = sidebar;
  workspace.getMostRecentLeaf = () => main;
  assert.equal(mainWorkspaceLeaf(workspace), main);
});

test('navigation creates a main tab when no main pane exists', () => {
  const created = {};
  assert.equal(
    mainWorkspaceLeaf({
      rootSplit: {},
      activeLeaf: null,
      getMostRecentLeaf: () => null,
      iterateAllLeaves: () => {},
      getLeaf: (mode) => {
        assert.equal(mode, 'tab');
        return created;
      },
    }),
    created,
  );
});
