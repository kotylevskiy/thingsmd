const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture(paths) {
  const opened = [],
    menus = [];
  const texts = new Map(paths.map((path) => [path, 'Before\n![[task]]\nAfter']));
  const leaf = { openFile: async (file, options) => opened.push({ path: file.path, options }) };
  const plugin = {
    beginTaskMenu: () => 1,
    presentTaskMenu() {},
    records: async () =>
      [...texts].map(([path, body]) => ({
        file: { path },
        body,
        meta: { type: 'thingsmd-project' },
      })),
    app: {
      vault: { getAbstractFileByPath: (path) => (texts.has(path) ? { path } : null) },
      workspace: { revealLeaf: async () => {} },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('plugin/project-navigation.cjs', 'utf8'), {
    module,
    innerWidth: 1000,
    innerHeight: 800,
    require: (name) => {
      if (name === './task-references.cjs') return require('../plugin/task-references.cjs');
      if (name === './note-access.cjs')
        return { noteAccess: () => ({ read: async (file) => texts.get(file.path) }) };
      if (name === './workspace-leaf.cjs') return () => leaf;
      return {
        Notice: class {},
        Menu: class {
          constructor() {
            this.items = [];
            menus.push(this);
          }
          addItem(build) {
            const item = {
              setTitle(title) {
                this.title = title;
                return this;
              },
              setIcon() {
                return this;
              },
              onClick(action) {
                this.action = action;
                return this;
              },
            };
            build(item);
            this.items.push(item);
          }
          setUseNativeMenu() {}
          showAtPosition() {}
        },
      };
    },
  });
  return { api: module.exports, plugin, opened, menus, texts, task: { file: { path: 'task.md' } } };
}
test('Show in Project reveals the reference line in the containing note', async () => {
  const f = fixture(['Project.md']);
  await f.api.show(f.plugin, f.task);
  assert.equal(f.opened[0].path, 'Project.md');
  assert.equal(f.opened[0].options.eState.line, 1);
});
test('multiple containing notes require a chooser; missing references cannot navigate', async () => {
  const f = fixture(['A.md', 'B.md']);
  await f.api.show(f.plugin, f.task);
  assert.equal(f.opened.length, 0);
  assert.deepEqual(
    f.menus[0].items.map((item) => item.title),
    ['A.md', 'B.md'],
  );
  await f.menus[0].items[1].action();
  assert.equal(f.opened[0].path, 'B.md');
  f.texts.clear();
  await assert.rejects(f.api.show(f.plugin, f.task), /no longer in a project/);
});
