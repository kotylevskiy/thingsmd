const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function fixture(
  initial = { 'Note.md': '- [ ] First [onCompletion:: delete]\n- [ ] Second 📅 2099-01-01\n' },
) {
  const files = new Map(Object.entries(initial));
  const file = (path) => ({ path, basename: path.split('/').pop().slice(0, -3), extension: 'md' });
  const vault = {
    getAbstractFileByPath: (path) => (files.has(path) ? file(path) : null),
    getMarkdownFiles: () => [...files.keys()].map(file),
    read: async (f) => {
      if (!files.has(f.path)) throw Error('Missing');
      return files.get(f.path);
    },
    create: async (path, text) => {
      if (files.has(path)) throw Error('Exists');
      files.set(path, text);
      return file(path);
    },
    createFolder: async () => {},
    process: async (f, fn) => {
      files.set(f.path, fn(files.get(f.path)));
    },
    delete: async (f) => {
      files.delete(f.path);
    },
    adapter: {
      exists: async (path) => path === 'ThingsMD' || files.has(path),
      read: async (path) => files.get(path),
      list: async () => ({
        files: [...files.keys()].filter((path) => path.startsWith('ThingsMD/')),
      }),
      remove: async (path) => files.delete(path),
    },
  };
  const plugin = {
    app: { vault, workspace: { getLeavesOfType: () => [] } },
    settings: { tasksFolder: 'ThingsMD' },
    tasksChanged() {},
    register() {},
    assertTaskAuthority: async () => {},
  };
  const filename = require.resolve('../plugin/tasks/task-store.cjs');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    crypto: require('node:crypto').webcrypto,
    require: (name) =>
      name === 'obsidian'
        ? { parseYaml: JSON.parse, stringifyYaml: (value) => JSON.stringify(value) + '\n' }
        : createRequire(filename)(name),
  });
  module.exports(plugin);
  require('../plugin/conversion/service.cjs')(plugin);
  return { plugin, files, vault };
}
async function convert(plugin, direction, extra = {}) {
  const plan = await plugin.planConversion({ direction, ...extra });
  return plugin.runConversion(plan);
}
test('whole-note round trip restores exactly and removes converted task files', async () => {
  const { plugin, files } = fixture();
  const original = files.get('Note.md');
  assert.equal((await convert(plugin, 'thingsmd', { path: 'Note.md' })).converted, 2);
  assert.equal((await plugin.taskRecords()).length, 2);
  assert.equal((await convert(plugin, 'inline', { path: 'Note.md' })).converted, 2);
  assert.equal(files.get('Note.md'), original);
  assert.equal((await plugin.taskRecords()).length, 0);
});
test('partial selection converts entire touched task but leaves other content alone', async () => {
  const { plugin, files } = fixture();
  const original = files.get('Note.md');
  await convert(plugin, 'thingsmd', { path: 'Note.md', ranges: [{ from: 8, to: 10 }] });
  assert.equal((await plugin.taskRecords()).length, 1);
  assert.ok(files.get('Note.md').endsWith(original.split('\n').slice(1).join('\n')));
});
test('restores every occurrence across notes before deleting shared task', async () => {
  const { plugin, files, vault } = fixture({
    'Note.md': '- [ ] Shared [dependsOn:: dcf64c,0h17ye]\n',
  });
  await convert(plugin, 'thingsmd');
  files.set('Other.md', files.get('Note.md') + files.get('Note.md'));
  const remove = vault.delete;
  vault.delete = async (file) => {
    assert.ok(files.get('Note.md').startsWith('- [ ] Shared'));
    assert.equal(files.get('Other.md').split('Shared').length - 1, 2);
    await remove(file);
  };
  await convert(plugin, 'inline', { path: 'Note.md' });
  assert.equal((await plugin.taskRecords()).length, 0);
});
test('stale plan refuses external source changes before creating task files', async () => {
  const { plugin, files } = fixture();
  const plan = await plugin.planConversion({ direction: 'thingsmd' });
  files.set('Note.md', 'External draft');
  await assert.rejects(plugin.runConversion(plan), /changed/);
  assert.equal(files.get('Note.md'), 'External draft');
  assert.equal((await plugin.taskRecords()).length, 0);
});
test('failed note write restores earlier notes and cleans unchanged new files', async () => {
  const { plugin, files, vault } = fixture({ 'A.md': '- [ ] One', 'B.md': '- [ ] Two' });
  const process = vault.process;
  vault.process = async (file, fn) => {
    if (file.path === 'B.md') {
      const next = fn(files.get(file.path));
      if (next.startsWith('![[')) throw Error('Write failed');
    }
    return process(file, fn);
  };
  await assert.rejects(convert(plugin, 'thingsmd'), /Write failed/);
  assert.equal(files.get('A.md'), '- [ ] One');
  assert.equal(files.get('B.md'), '- [ ] Two');
  // A rejected write leaves before unchanged; recovery should not report a conflict.
  assert.equal((await plugin.taskRecords()).length, 0);
});
test('failed task deletion restores task files and all source references', async () => {
  const { plugin, files, vault } = fixture();
  await convert(plugin, 'thingsmd');
  const converted = files.get('Note.md');
  let removed = 0;
  const remove = vault.delete;
  vault.delete = async (file) => {
    if (++removed === 2) throw Error('Delete failed');
    await remove(file);
  };
  await assert.rejects(convert(plugin, 'inline'), /Delete failed/);
  assert.equal(files.get('Note.md'), converted);
  assert.equal((await plugin.taskRecords()).length, 2);
});
test('task draft and changed task metadata prevent destructive reverse conversion', async () => {
  const { plugin, files } = fixture();
  await convert(plugin, 'thingsmd');
  const converted = files.get('Note.md');
  plugin.hasTaskDraft = () => true;
  await assert.rejects(convert(plugin, 'inline'), /draft/);
  plugin.hasTaskDraft = () => false;
  const plan = await plugin.planConversion({ direction: 'inline' });
  const t = (await plugin.taskRecords())[0];
  await plugin.update(t.file, (record) => ({ ...record, body: 'New notes' }));
  await assert.rejects(plugin.runConversion(plan), /changed/);
  assert.equal(files.get('Note.md'), converted);
});
test('concurrent reference creation prevents deletion and preserves new reference', async () => {
  const { plugin, files, vault } = fixture({ 'Note.md': '- [ ] Task' });
  await convert(plugin, 'thingsmd');
  const reference = files.get('Note.md');
  const process = vault.process;
  vault.process = async (file, fn) => {
    await process(file, fn);
    if (file.path === 'Note.md' && files.get(file.path).startsWith('- [ ]'))
      files.set('New.md', reference);
  };
  await assert.rejects(convert(plugin, 'inline'), /appeared/);
  assert.equal(files.get('New.md'), reference);
  assert.equal(files.get('Note.md'), reference);
  assert.equal((await plugin.taskRecords()).length, 1);
});

test('conversion preserves an unsaved source buffer and rejects a concurrent disk change', async () => {
  const { plugin, files } = fixture({ 'Note.md': 'Saved text\n- [ ] Task' });
  let buffer = 'Unsaved introduction\n- [ ] Task';
  const view = {
    file: { path: 'Note.md' },
    getMode: () => 'source',
    editor: {
      getValue: () => buffer,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: (text, from, to) => {
        buffer = buffer.slice(0, from.ch) + text + buffer.slice(to.ch);
      },
    },
    save: async () => {
      files.set('Note.md', buffer);
    },
  };
  plugin.app.workspace.getLeavesOfType = () => [{ view }];
  const stale = await plugin.planConversion({ direction: 'thingsmd', path: 'Note.md' });
  files.set('Note.md', 'External text\n- [ ] Task');
  await assert.rejects(plugin.runConversion(stale), /changed/);
  assert.equal(buffer, 'Unsaved introduction\n- [ ] Task');
  // A fresh explicit action uses the current source draft and its new disk snapshot.
  await convert(plugin, 'thingsmd', { path: 'Note.md' });
  assert.match(buffer, /^Unsaved introduction\n!\[\[/);
  assert.equal(files.get('Note.md'), buffer);
});
test('rollback never overwrites a later edit and retains recoverable task files', async () => {
  const { plugin, files, vault } = fixture({ 'A.md': '- [ ] One', 'B.md': '- [ ] Two' });
  const process = vault.process;
  vault.process = async (file, fn) => {
    if (file.path === 'B.md' && fn(files.get(file.path)).startsWith('![[')) {
      files.set('A.md', files.get('A.md') + '\nExternal addition');
      throw Error('Write failed');
    }
    return process(file, fn);
  };
  await assert.rejects(convert(plugin, 'thingsmd'), /Recovery needed: A.md/);
  assert.ok(files.get('A.md').endsWith('External addition'));
  assert.equal((await plugin.taskRecords()).length, 2);
});

test('reverse conversion retains task files referenced by ordinary prose links', async () => {
  const { plugin, files } = fixture({ 'Note.md': '- [ ] Linked task' });
  await convert(plugin, 'thingsmd');
  const task = (await plugin.taskRecords())[0];
  const converted = files.get('Note.md');
  files.set('Prose.md', `Read [[${task.file.path}|this task]] for context.`);
  const result = await convert(plugin, 'inline');
  assert.equal(result.converted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(files.get('Note.md'), converted);
  assert.ok(files.has(task.file.path));
});
test('code examples do not keep an otherwise restored task file alive', async () => {
  const { plugin, files } = fixture({ 'Note.md': '- [ ] Linked task' });
  await convert(plugin, 'thingsmd');
  const task = (await plugin.taskRecords())[0];
  files.set('Example.md', '```md\n[[' + task.file.path + ']]\n```');
  assert.equal((await convert(plugin, 'inline')).converted, 1);
  assert.ok(!files.has(task.file.path));
});

test('export renders from the same fresh snapshot used for conflict checks', async () => {
  const { plugin, files } = fixture({ 'Note.md': '- [ ] Original' });
  await convert(plugin, 'thingsmd');
  const originalRead = plugin.readTaskSnapshot;
  plugin.readTaskSnapshot = async function (file) {
    await this.update(file, (record) => ({
      ...record,
      meta: { ...record.meta, title: 'Latest title' },
    }));
    return originalRead.call(this, file);
  };
  // The task changed after the initial index read. The captured disk snapshot
  // makes this plan stale; it must not export the old title and delete the new one.
  await assert.rejects(convert(plugin, 'inline'), /changed/);
  assert.match(files.get('Note.md'), /^!\[\[/);
  plugin.readTaskSnapshot = originalRead;
  await convert(plugin, 'inline');
  assert.equal(files.get('Note.md'), '- [ ] Latest title');
});

test('an edit during import is never absorbed into the baseline or removed by rollback', async () => {
  const { plugin, files } = fixture({ 'Note.md': '- [ ] Original' });
  const update = plugin.update;
  let injected = false;
  plugin.update = async function (file, fn) {
    if (!injected) {
      injected = true;
      await update.call(this, file, (record) => ({
        ...record,
        meta: { ...record.meta, title: 'External title' },
      }));
    }
    return update.call(this, file, fn);
  };
  await assert.rejects(convert(plugin, 'thingsmd'), /Recovery needed/);
  assert.equal(files.get('Note.md'), '- [ ] Original');
  assert.equal((await plugin.taskRecords())[0].meta.title, 'External title');
});
