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
  const vaultEvents = new Map();
  const workspaceEvents = new Map();
  const cleanups = [];
  const files = new Map([
    ['A.md', 'Plain text'],
    ['B.md', 'More text'],
  ]);
  const reads = [];
  let timer,
    scans = 0,
    postprocess;
  const plugin = {
    settings: { tasksFolder: 'ThingsMD' },
    app: {
      vault: {
        on: (event, callback) => vaultEvents.set(event, callback),
        getMarkdownFiles: () => [...files.keys()].map((path) => ({ path })),
      },
      workspace: {
        on: (event, callback) => workspaceEvents.set(event, callback),
        getLeavesOfType: () => [],
      },
    },
    taskRecords: async () => [],
    register: (callback) => cleanups.push(callback),
    registerEvent() {},
    addCommand() {},
    registerDomEvent() {},
    registerMarkdownPostProcessor: (callback) => {
      postprocess = callback;
    },
  };
  const notes = {
    async read({ path }) {
      reads.push(path);
      return files.get(path);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require(name) {
      if (name === 'obsidian') return {};
      if (name === './presentation.cjs') return { labels: {} };
      if (name === '../shared/note-access.cjs') return { noteAccess: () => notes };
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
    setTimeout: (callback) => {
      timer = callback;
    },
    clearTimeout: () => {
      timer = undefined;
    },
  });
  return {
    install: () => module.exports(plugin),
    unload: () => cleanups.forEach((callback) => callback()),
    fire(event) {
      vaultEvents.get(event)();
      const callback = timer;
      timer = undefined;
      callback();
    },
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
    files,
    notes,
    reads,
  };
}

test('vault edits coalesce behind one conversion scan and publish the latest availability', async () => {
  const f = fixture();
  const read = f.notes.read;
  let release;
  f.notes.read = async (file) => {
    const result = await read(file);
    if (f.reads.length === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    return result;
  };
  f.install();
  await setImmediate();
  f.files.set('A.md', '- [ ] Latest task');
  for (const event of ['modify', 'create', 'rename', 'delete']) {
    f.fire(event);
    await setImmediate();
  }
  assert.deepEqual(f.reads, ['A.md']);
  assert.equal(f.menuAvailable('A.md'), false);
  release();
  await setImmediate();
  assert.deepEqual(f.reads, ['A.md', 'B.md', 'A.md', 'B.md']);
  assert.equal(f.menuAvailable('A.md'), true);
  f.unload();
});

test('unloading a conversion scan prevents further reads or a queued follow-up', async () => {
  const f = fixture();
  let release;
  f.notes.read = async ({ path }) => {
    f.reads.push(path);
    await new Promise((resolve) => {
      release = resolve;
    });
    return '- [ ] A task';
  };
  f.install();
  await setImmediate();
  f.fire('modify');
  f.unload();
  release();
  await setImmediate();
  assert.deepEqual(f.reads, ['A.md']);
  assert.equal(f.menuAvailable('A.md'), false);
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
