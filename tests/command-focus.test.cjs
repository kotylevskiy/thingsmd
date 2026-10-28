const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../plugin/commands.cjs');
const localRequire = createRequire(filename);

async function fixture() {
  let release,
    queued,
    modal = false,
    focused = 0;
  const waiting = new Promise((resolve) => {
    queued = resolve;
  });
  const tasks = ['a', 'b'].map((id) => ({
    meta: { id, title: id },
    file: { path: `.thingsmd-storage/${id}.md` },
  }));
  let text = tasks.map((task) => `![[${task.file.path}]]`).join('\n');
  const rows = tasks.map((task) => {
    const row = {
      dataset: { taskId: task.meta.id },
      getBoundingClientRect: () => ({ width: 100 }),
      focus: () => focused++,
      closest: (selector) => (selector.startsWith('.ot-task') ? row : null),
    };
    return row;
  });
  const view = {
    file: { path: 'Note.md' },
    currentTask: tasks[0],
    getViewType: () => 'markdown',
    getMode: () => 'preview',
    containerEl: { contains: (element) => rows.includes(element), querySelectorAll: () => rows },
  };
  const document = { activeElement: rows[0], querySelector: () => (modal ? {} : null) };
  const plugin = {
    app: { workspace: { activeLeaf: { view } } },
    taskRecords: async () => tasks,
    registerDomEvent() {},
    register() {},
    addCommand: (command) => commands.set(command.id, command),
  };
  const commands = new Map();
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    document,
    setTimeout: (callback, delay) => {
      assert.equal(delay, 220);
      release = callback;
      queued();
    },
    require: (name) =>
      name === 'obsidian'
        ? {}
        : name === './shared/note-access.cjs'
          ? {
              noteAccess: () => ({
                read: async () => text,
                write: async (file, before, next) => {
                  assert.equal(before, text);
                  text = next;
                },
              }),
            }
          : localRequire(name),
  });
  module.exports(plugin);
  assert.equal(commands.get('move-task-down').checkCallback(false), true);
  await waiting;
  assert.ok(text.indexOf(tasks[1].file.path) < text.indexOf(tasks[0].file.path));
  return {
    finish: async () => {
      release();
      await new Promise(setImmediate);
    },
    modal: () => {
      modal = true;
    },
    navigate: () => {
      plugin.app.workspace.activeLeaf = { view: {} };
    },
    focused: () => focused,
  };
}

test('delayed reorder focus does not steal focus from a newly opened modal', async () => {
  const f = await fixture();
  f.modal();
  await f.finish();
  assert.equal(f.focused(), 0);
});
test('delayed reorder focus respects navigation to a different view', async () => {
  const f = await fixture();
  f.navigate();
  await f.finish();
  assert.equal(f.focused(), 0);
});
test('a settled reorder still focuses its task when the user stayed in the note', async () => {
  const f = await fixture();
  await f.finish();
  assert.equal(f.focused(), 1);
});
