const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers/promises');

function fixture() {
  const filename = require.resolve('../plugin/conversion/ui.cjs');
  const localRequire = createRequire(filename);
  const format = localRequire('./format.cjs');
  const module = { exports: {} };
  const workspaceEvents = new Map();
  const cleanups = [];
  let scans = 0,
    postprocess;
  const plugin = {
    settings: { tasksFolder: 'ThingsMD' },
    app: {
      workspace: {
        on: (event, callback) => workspaceEvents.set(event, callback),
        getLeavesOfType: () => [],
      },
    },
    records: async () => [],
    register: (callback) => cleanups.push(callback),
    registerEvent() {},
    addCommand() {},
    registerDomEvent() {},
    registerMarkdownPostProcessor: (callback) => {
      postprocess = callback;
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require(name) {
      if (name === 'obsidian') return {};
      if (name === './presentation.cjs') return { labels: {} };
      if (name === './format.cjs')
        return {
          scan(text) {
            scans++;
            return format.scan(text);
          },
        };
      return localRequire(name);
    },
    document: {},
    MutationObserver: class {
      disconnect() {}
    },
    console,
  });
  return {
    install: () => module.exports(plugin),
    unload: () => cleanups.forEach((callback) => callback()),
    refresh: () => workspaceEvents.get('thingsmd-tasks-changed')(),
    menuAvailable(path) {
      const labels = [];
      const item = {
        setTitle: (label) => {
          labels.push(label);
          return item;
        },
        setIcon: () => item,
        onClick: () => item,
      };
      workspaceEvents.get('file-menu')({ addItem: (configure) => configure(item) }, { path });
      return labels.length > 0;
    },
    render: (element, context) => postprocess(element, context),
    scanCount: () => scans,
    plugin,
  };
}

const indexedNote = (hasInlineTasks, referencePaths = []) => ({
  file: { path: 'A.md' },
  meta: { type: 'thingsmd-project' },
  hasInlineTasks,
  referencePaths,
});

test('conversion availability follows the latest shared snapshot', async () => {
  const f = fixture();
  let release;
  f.plugin.records = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.install();
  f.plugin.records = async () => [indexedNote(true)];
  await f.refresh();
  release([indexedNote(false)]);
  await setImmediate();
  assert.equal(f.menuAvailable('A.md'), true);
  f.unload();
});

test('conversion availability does not publish after unload', async () => {
  const f = fixture();
  let release;
  f.plugin.records = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.install();
  f.unload();
  release([indexedNote(true)]);
  await setImmediate();
  assert.equal(f.menuAvailable('A.md'), false);
});

test('only selected and available converted tasks enable restoring a closed note', async () => {
  const f = fixture();
  const task = {
    file: { path: 'ThingsMD/A.md' },
    meta: { type: 'thingsmd-task', conversion: { version: 1 } },
  };
  const note = indexedNote(false, [task.file.path]);
  f.plugin.records = async () => [note, { ...task, conflicts: [{}] }];
  f.install();
  await setImmediate();
  assert.equal(f.menuAvailable('A.md'), false);
  f.plugin.records = async () => [note, task];
  await f.refresh();
  assert.equal(f.menuAvailable('A.md'), true);
  f.unload();
});

test('reading sections without checkboxes skip parsing the full note', async () => {
  const f = fixture();
  f.install();
  await setImmediate();
  const before = f.scanCount();
  f.render(
    { closest: () => null, querySelectorAll: () => [] },
    {
      sourcePath: 'A.md',
      getSectionInfo: () => ({ text: '- [ ] A task in another section', lineStart: 1, lineEnd: 2 }),
    },
  );
  assert.equal(f.scanCount(), before);
  f.unload();
});
