const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WriteQueue } = require('../plugin/write-queue.cjs');
const installArchives = require('../plugin/archives.cjs');
const installSettings = require('../plugin/settings-service.cjs');
async function fixture() {
  const task = {
    file: { path: '.thingsmd-storage/a.md' },
    meta: { id: 'a', status: 'done', deleted: true, deletedAt: '2020-01-01T12:00:00Z' },
    body: 'Keep task details',
  };
  const text =
    'Before\n![[.thingsmd-storage/a]]\n````md\n```\n![[.thingsmd-storage/a]]\n````\nAfter\n';
  const files = new Map([
    ['Note.md', text],
    ['.thingsmd-storage/a.md', JSON.stringify(task)],
  ]);
  const plugin = {
    loadData: async () => null,
    saveData: async () => {},
    tasksChanged() {},
    mountListLinks() {},
    taskRecords: async () =>
      files.has('.thingsmd-storage/a.md') ? [JSON.parse(files.get('.thingsmd-storage/a.md'))] : [],
    readTask: async (file) => files.get(file.path),
    patchTask: async (t, patch) => {
      const current = JSON.parse(files.get(t.file.path));
      Object.assign(current.meta, patch);
      files.set(t.file.path, JSON.stringify(current));
    },
    app: {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        getMarkdownFiles: () => [{ path: 'Note.md' }],
        read: async (f) => files.get(f.path),
        process: async (f, fn) => files.set(f.path, fn(files.get(f.path))),
        adapter: { remove: async (p) => files.delete(p) },
      },
    },
  };
  plugin.taskQueue = new WriteQueue();
  await installSettings(plugin);
  installArchives(plugin, () => false);
  return { plugin, task, files, text };
}
test('never-delete retains trash; expiry removes task and only live note references', async () => {
  const { plugin, task, files, text } = await fixture();
  await plugin.maintainArchives();
  assert.equal(files.get('Note.md'), text);
  assert.ok(files.has(task.file.path));
  plugin.settings.trashRetention = '1-year';
  await plugin.maintainArchives();
  assert.equal(files.has(task.file.path), false);
  assert.equal(files.get('Note.md'), text.replace('![[.thingsmd-storage/a]]\n', ''));
});
test('immediate cleanup also handles legacy trash without a deletion date', async () => {
  const { plugin, task, files } = await fixture();
  delete task.meta.deletedAt;
  files.set(task.file.path, JSON.stringify(task));
  plugin.settings.trashRetention = 'immediately';
  await plugin.purgeTask(task);
  assert.equal(files.has(task.file.path), false);
});
test('failed permanent deletion rolls back unchanged note edits and retains the task', async () => {
  const { plugin, task, files, text } = await fixture();
  plugin.settings.trashRetention = 'immediately';
  plugin.app.vault.adapter.remove = async () => {
    throw new Error('disk failure');
  };
  await assert.rejects(plugin.purgeTask(task), /disk failure/);
  assert.ok(files.has(task.file.path));
  assert.equal(files.get('Note.md'), text);
  assert.equal(plugin.taskQueue.pending.size, 0);
});
test('restored tasks are rechecked before permanent cleanup', async () => {
  const { plugin, task, files, text } = await fixture();
  await plugin.patchTask(task, { deleted: false });
  plugin.settings.trashRetention = 'immediately';
  await plugin.purgeTask(task);
  assert.ok(files.has(task.file.path));
  assert.equal(files.get('Note.md'), text);
});
test('Log Completed logs only completed non-trashed tasks and persists across policy changes', async () => {
  const { plugin, task, files } = await fixture();
  await plugin.logCompleted();
  assert.equal(JSON.parse(files.get(task.file.path)).meta.loggedAt, undefined);
  await plugin.patchTask(task, { deleted: false });
  plugin.settings.logbook = 'manually';
  await plugin.logCompleted();
  assert.ok(JSON.parse(files.get(task.file.path)).meta.loggedAt);
  const logged = JSON.parse(files.get(task.file.path)).meta.loggedAt;
  await plugin.updateSettings({ logbook: 'weekly' });
  assert.equal(JSON.parse(files.get(task.file.path)).meta.loggedAt, logged);
});
