const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarVaultStorage } = require('../plugin/calendar/vault-storage.cjs');

function fixture() {
  const files = new Map(),
    folders = new Set();
  const vault = {
    adapter: {
      exists: async (path) => files.has(path) || folders.has(path),
      stat: async (path) =>
        folders.has(path) ? { type: 'folder' } : files.has(path) ? { type: 'file' } : null,
      read: async (path) => files.get(path)?.body,
      list: async (folder) => ({
        files: [...files.keys()].filter((path) => path.startsWith(folder + '/')),
      }),
    },
    createFolder: async (path) => folders.add(path),
    create: async (path, body) => {
      if (files.has(path)) throw new Error('File exists');
      files.set(path, { path, body });
    },
    read: async (file) => file.body,
    getAbstractFileByPath: (path) => files.get(path),
    delete: async (file) => files.delete(file.path),
  };
  return { vault, files, folders, storage: calendarVaultStorage(vault) };
}

test('vault storage creates nested folders, tolerates concurrent directory creation and never overwrites snapshots', async () => {
  const f = fixture();
  f.vault.createFolder = async (path) => {
    f.folders.add(path);
    throw new Error('Another operation already created it');
  };
  await f.storage.create('ThingsMD/Calendars/test/snapshot.ics', 'original');
  await assert.rejects(
    f.storage.create('ThingsMD/Calendars/test/snapshot.ics', 'replacement'),
    /File exists/,
  );
  assert.equal(await f.storage.read('ThingsMD/Calendars/test/snapshot.ics'), 'original');
  await f.vault.create('Blocked', 'ordinary note');
  await assert.rejects(f.storage.create('Blocked/snapshot.ics', 'calendar'), /is a file/);
});

test('conditional vault deletion preserves changed bodies and files replaced while being read', async () => {
  const f = fixture();
  await f.storage.create('ThingsMD/test.ics', 'current');
  await f.storage.remove('ThingsMD/test.ics', 'old');
  assert.equal(f.files.size, 1);
  f.vault.read = async (file) => {
    f.files.set(file.path, { path: file.path, body: 'external replacement' });
    return file.body;
  };
  await f.storage.remove('ThingsMD/test.ics', 'current');
  assert.equal(await f.storage.read('ThingsMD/test.ics'), 'external replacement');
  f.vault.read = async (file) => file.body;
  await f.storage.remove('ThingsMD/test.ics', 'external replacement');
  await f.storage.remove('ThingsMD/missing.ics', 'missing');
  assert.equal(f.files.size, 0);
});
