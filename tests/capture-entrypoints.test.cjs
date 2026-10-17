const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../plugin/commands.cjs');
const localRequire = createRequire(filename);

function fixture(view, { sidebar = false, deferred = false } = {}) {
  const captured = [],
    commands = new Map();
  const leaf = {
    view: deferred ? {} : view,
    loadIfDeferred: async () => {
      leaf.view = view;
    },
  };
  const plugin = {
    app: {
      workspace: { activeLeaf: sidebar ? { view: { getViewType: () => 'file-explorer' } } : leaf },
    },
    mainWorkspaceLeaf: () => leaf,
    capture: (fields) => captured.push(fields),
    registerDomEvent() {},
    register() {},
    addCommand: (command) => commands.set(command.id, command),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    document: { activeElement: null },
    require: (name) => (name === 'obsidian' ? {} : localRequire(name)),
  });
  module.exports(plugin);
  return { plugin, captured, commands };
}
for (const type of ['empty', 'canvas', 'search', 'logbook', 'trash', 'repeating']) {
  test(`New task opens capture from ${type}`, async () => {
    const f = fixture({
      getViewType: () =>
        ['logbook', 'trash', 'repeating'].includes(type) ? 'things-project-view' : type,
      page: type,
    });
    await f.plugin.newTaskHere();
    assert.equal(f.captured.length, 1);
    assert.equal(f.captured[0], undefined);
    assert.equal(typeof f.commands.get('capture').callback, 'function');
  });
}
test('capture resolves a deferred main note while sidebar owns focus', async () => {
  const f = fixture(
    { getViewType: () => 'markdown', file: { path: 'Project.md', extension: 'md' } },
    { sidebar: true, deferred: true },
  );
  await f.plugin.newTaskHere();
  assert.equal(f.captured.length, 1);
  assert.equal(f.captured[0].project, 'Project.md');
  assert.equal(f.plugin.app.workspace.activeLeaf.view.getViewType(), 'file-explorer');
});
test('an unsaved list draft that cannot finish is preserved', async () => {
  const f = fixture({
    getViewType: () => 'things-project-view',
    page: 'today',
    taskDraft: {},
    finishTask: async () => false,
  });
  await f.plugin.newTaskHere();
  assert.equal(f.captured.length, 0);
});
