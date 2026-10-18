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
    taskRecords: async () => [],
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
        ['logbook', 'trash', 'repeating'].includes(type) ? 'thingsmd-project-view' : type,
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
    getViewType: () => 'thingsmd-project-view',
    page: 'today',
    taskDraft: {},
    finishTask: async () => false,
  });
  await f.plugin.newTaskHere();
  assert.equal(f.captured.length, 0);
});

test('New task from a task note does not file another task inside its description', async () => {
  const f = fixture({
    getViewType: () => 'markdown',
    file: { path: 'ThingsMD/task.md', extension: 'md' },
    containerEl: { classList: { contains: (cls) => cls === 'ot-task-note-view' } },
  });
  f.plugin.taskRecords = async () => [{ file: { path: 'ThingsMD/task.md' } }];
  await f.plugin.newTaskHere();
  assert.deepEqual(f.captured, [undefined]);
});

// Markdown views are reused; presentation classes can lag behind navigation.
test('capture uses the current note even while task-note styling is stale', async () => {
  const f = fixture({
    getViewType: () => 'markdown',
    file: { path: 'Project.md', extension: 'md' },
    containerEl: { classList: { contains: () => true } },
  });
  f.plugin.taskRecords = async () => [{ file: { path: 'ThingsMD/task.md' } }];
  await f.plugin.newTaskHere();
  assert.equal(f.captured[0].project, 'Project.md');
});
