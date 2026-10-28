const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../plugin/notes/task-notes.cjs');
const localRequire = createRequire(filename);

// Isolate keyboard routing from Obsidian's renderer; real UI suites cover rendering.
test('Enter on a rendered link remains available to the link', async () => {
  const module = { exports: {} };
  class Observer {
    observe() {}
    disconnect() {}
  }
  class Component {
    register() {}
    registerDomEvent() {}
    registerEvent() {}
    addChild(child) {
      return child;
    }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    setTimeout,
    MutationObserver: Observer,
    ResizeObserver: Observer,
    require: (name) =>
      name === 'obsidian'
        ? { Component }
        : name === '../shared/quiet-label.cjs'
          ? { quietLabel() {} }
          : localRequire(name),
  });
  let opened = 0;
  const preview = { isConnected: false };
  const plugin = {
    app: { vault: { on() {} } },
    addChild: (child) => child,
    readTask: async () => new Promise(() => {}),
  };
  module.exports(plugin);
  plugin.renderTaskNotes(
    { openNotes: async () => opened++ },
    { createDiv: () => preview, ownerDocument: { body: {} } },
    { file: { path: 'ThingsMD/test.md' } },
    {},
  );
  // Restoring tab focus must not reopen the note automatically.
  assert.equal(preview.onfocus, undefined);
  let prevented = false;
  const event = {
    key: 'Enter',
    target: { tagName: 'A' },
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  };
  preview.onkeydown(event);
  assert.equal(prevented, false);
  assert.equal(opened, 0);
  preview.onkeydown({ ...event, target: preview });
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.equal(opened, 1);
});

test('task navigation coalesces duplicates and preserves distinct requests after failure', async () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: (name) => (name === 'obsidian' ? {} : localRequire(name)),
  });
  const opened = [];
  let release;
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  const plugin = {
    settings: { taskNotesTab: 'new' },
    app: {
      vault: { getAbstractFileByPath: (path) => ({ path, extension: 'md' }) },
      workspace: {
        getLeaf: () => ({
          view: {},
          async setViewState({ state }) {
            opened.push(state.file);
            await loading;
            if (state.file === 'one.md') throw Error('Cannot open');
          },
        }),
        revealLeaf() {},
      },
    },
  };
  module.exports(plugin);
  const one = { file: { path: 'one.md' } },
    two = { file: { path: 'two.md' } };
  const results = Promise.allSettled([
    plugin.openTaskNotes(one),
    plugin.openTaskNotes(one),
    plugin.openTaskNotes(two),
  ]);
  release();
  const settled = await results;
  assert.deepEqual(opened, ['one.md', 'two.md']);
  assert.deepEqual(
    settled.map((result) => result.status),
    ['rejected', 'rejected', 'fulfilled'],
  );
  assert.equal(plugin.taskNotesOpening, null);
  await plugin.openTaskNotes(two);
  assert.deepEqual(opened, ['one.md', 'two.md', 'two.md']);
});
