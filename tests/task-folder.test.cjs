const test = require('node:test');
const assert = require('node:assert/strict');
const { taskFolder } = require('../plugin/tasks/task-folder-policy.cjs');
const { settings } = require('../plugin/settings/settings-model.cjs');
const { taskReferences, removeReferences } = require('../plugin/notes/task-references.cjs');
test('task folder defaults and validation keep tasks indexed and inside the vault', () => {
  assert.equal(settings().tasksFolder, 'ThingsMD');
  assert.equal(settings().tasksFolderDisplay, 'hidden');
  assert.equal(taskFolder(' Work/Tasks/ '), 'Work/Tasks');
  for (const path of [
    '',
    '/',
    '/Tasks',
    '../Tasks',
    '.obsidian/Tasks',
    'Tasks/../Other',
    'Tasks//Other',
    'Tasks\\Other',
    'Tasks#Heading',
    'Tasks\nOther',
    'Tasks\tOther',
    'Tasks\u0000Other',
  ])
    assert.throws(() => taskFolder(path));
  for (const mode of ['normal', 'hidden'])
    assert.equal(settings({ tasksFolderDisplay: mode }).tasksFolderDisplay, mode);
});
test('folder visibility defaults to hidden and converts the removed Show last mode to shown', () => {
  for (const value of [undefined, null, '', 'invalid', false])
    assert.equal(settings({ tasksFolderDisplay: value }).tasksFolderDisplay, 'hidden');
  assert.equal(settings({ tasksFolderDisplay: 'last' }).tasksFolderDisplay, 'normal');
});
test('custom-folder placements preserve fenced examples and unrelated embeds', () => {
  const body =
    'Before\r\n![[Work/Tasks/id]]\r\n![[Photo.png]]\r\n```\r\n![[Work/Tasks/id]]\r\n```\r\nAfter';
  assert.equal(taskReferences(body)[0].path, 'Work/Tasks/id.md');
  assert.equal(
    removeReferences(body, 'Work/Tasks/id.md'),
    'Before\r\n![[Photo.png]]\r\n```\r\n![[Work/Tasks/id]]\r\n```\r\nAfter',
  );
});

function migrationFixture() {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const filename = require.resolve('../plugin/tasks/task-folder.cjs');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    document: { querySelectorAll: () => [] },
    require: (name) => (name === 'obsidian' ? { parseYaml: JSON.parse } : localRequire(name)),
  });
  const body = '---\n{"type":"thingsmd-task","id":"one"}\n---\nBody\n';
  const files = new Map([
    ['.thingsmd-storage/one.md', body],
    ['Project.md', 'Before\n![[.thingsmd-storage/one]]\nAfter\n'],
  ]);
  const folders = new Set(['.thingsmd-storage']);
  const file = (path) =>
    files.has(path) && !path.startsWith('.') ? { path, extension: 'md' } : null;
  const vault = {
    adapter: {
      exists: async (path) => files.has(path) || folders.has(path),
      list: async (folder) => ({
        files: [...files.keys()].filter((path) => path.startsWith(folder + '/')),
      }),
      stat: async (path) => ({ type: folders.has(path) ? 'folder' : 'file' }),
      read: async (path) => files.get(path),
      remove: async (path) => files.delete(path),
    },
    createFolder: async (path) => folders.add(path),
    create: async (path, text) => {
      files.set(path, text);
      return file(path);
    },
    getAbstractFileByPath: file,
    getMarkdownFiles: () => [...files.keys()].map(file).filter(Boolean),
    read: async (f) => files.get(f.path),
    process: async (f, fn) => files.set(f.path, fn(files.get(f.path))),
    delete: async (f) => files.delete(f.path),
  };
  const plugin = {
    settings: { tasksFolder: 'ThingsMD' },
    taskQueue: { pending: new Map() },
    tasksChanged() {},
    app: {
      vault,
      workspace: { getLeavesOfType: () => [] },
      metadataCache: { getFirstLinkpathDest: () => null },
      fileManager: {
        renameFile: async (f, to) => {
          files.set(to, files.get(f.path));
          files.delete(f.path);
          f.path = to;
        },
      },
    },
    readTask: async (path) => files.get(path),
    persistSettings: async (patch) =>
      Object.assign(plugin.settings, typeof patch === 'function' ? patch(plugin.settings) : patch),
  };
  return { install: module.exports, plugin, files, body };
}
test('legacy migration preserves task bytes and surrounding Markdown', async () => {
  const { install, plugin, files, body } = migrationFixture();
  await install(plugin);
  assert.equal(files.get('ThingsMD/one.md'), body);
  assert.equal(files.has('.thingsmd-storage/one.md'), false);
  assert.equal(files.get('Project.md'), 'Before\n![[ThingsMD/one]]\nAfter\n');
});
test('failed settings persistence rolls files and references back', async () => {
  const { install, plugin, files, body } = migrationFixture();
  await install(plugin);
  plugin.persistSettings = async () => {
    throw Error('Settings unavailable');
  };
  await assert.rejects(plugin.changeTasksFolder('Work/Tasks'), /Settings unavailable/);
  assert.equal(files.get('ThingsMD/one.md'), body);
  assert.equal(files.has('Work/Tasks/one.md'), false);
  assert.equal(files.get('Project.md'), 'Before\n![[ThingsMD/one]]\nAfter\n');
  assert.equal(plugin.settings.tasksFolder, 'ThingsMD');
});
test('migration collisions preserve both copies without rewriting references', async () => {
  const { install, plugin, files } = migrationFixture();
  files.set('ThingsMD/one.md', 'External content');
  await assert.rejects(install(plugin), /already contains/);
  assert.equal(files.get('ThingsMD/one.md'), 'External content');
  assert.ok(files.has('.thingsmd-storage/one.md'));
  assert.ok(files.get('Project.md').includes('.thingsmd-storage/one'));
});

test('folder migration restores a live reference buffer when saving it fails', async () => {
  const { install, plugin, files } = migrationFixture();
  await install(plugin);
  const original = files.get('Project.md');
  let buffer = original,
    saves = 0;
  const view = {
    file: { path: 'Project.md' },
    getMode: () => 'source',
    editor: {
      getValue: () => buffer,
      offsetToPos: (offset) => offset,
      replaceRange: (text, from, to) => {
        buffer = buffer.slice(0, from) + text + buffer.slice(to);
      },
    },
    async save() {
      if (++saves === 1) throw Error('Save failed');
      files.set('Project.md', buffer);
    },
  };
  plugin.app.workspace.getLeavesOfType = () => [{ view }];
  await assert.rejects(plugin.changeTasksFolder('Work/Tasks'), /Save failed/);
  assert.equal(buffer, original);
  assert.equal(files.get('Project.md'), original);
  assert.ok(files.has('ThingsMD/one.md'));
  assert.equal(files.has('Work/Tasks/one.md'), false);
  assert.equal(plugin.settings.tasksFolder, 'ThingsMD');
});
