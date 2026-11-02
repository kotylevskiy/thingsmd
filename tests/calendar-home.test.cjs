const test = require('node:test');
const assert = require('node:assert/strict');
const { moveCalendarHome, calendarRoot, LEGACY_ROOT } = require('../plugin/calendar/home.cjs');
const { CalendarService } = require('../plugin/calendar/service.cjs');
const { body } = require('./helpers/calendar.cjs');
const name = '2026-10-28T12-00-00-000Z_device.ics';

function fixture(root = LEGACY_ROOT) {
  const files = new Map([[`${root}/test/${name}`, body()]]);
  const folders = new Set([root, `${root}/test`]);
  const list = async (folder) => ({
    files: [...files.keys()].filter((p) => p.slice(0, p.lastIndexOf('/')) === folder),
    folders: [...folders].filter((p) => p.slice(0, p.lastIndexOf('/')) === folder),
  });
  const vault = {
    adapter: {
      exists: async (p) => files.has(p) || folders.has(p),
      stat: async (p) =>
        folders.has(p) ? { type: 'folder' } : files.has(p) ? { type: 'file' } : null,
      read: async (p) => files.get(p),
      list,
      rmdir: async (p, recursive) => {
        assert.equal(recursive, false);
        const children = await list(p);
        assert.equal(children.files.length + children.folders.length, 0);
        folders.delete(p);
      },
    },
    createFolder: async (p) => folders.add(p),
    getAbstractFileByPath: (p) => (files.has(p) || folders.has(p)) && { path: p },
    rename: async (file, to) => {
      assert.ok(!files.has(to), 'Never overwrite an existing snapshot');
      files.set(to, files.get(file.path));
      files.delete(file.path);
    },
  };
  const service = new CalendarService({
    root,
    now: () => Date.parse('2026-10-28T12:00:00Z'),
    storage: {
      list: async (p) => (await list(p)).files,
      read: async (p) => files.get(p),
    },
    secret: () => null,
  });
  service.configure([{ id: 'test' }]);
  return { plugin: { calendar: service, app: { vault } }, files, folders, service };
}

test('legacy calendar snapshots move inside the home, preserving bytes and unrelated files', async () => {
  const f = fixture();
  f.files.set(`${LEGACY_ROOT}/test/notes.md`, 'keep');
  await moveCalendarHome(f.plugin, 'Work/ThingsMD', undefined, LEGACY_ROOT);
  assert.equal(f.files.get(`Work/ThingsMD/Calendars/test/${name}`), body());
  assert.equal(f.files.has(`${LEGACY_ROOT}/test/${name}`), false);
  assert.equal(f.files.get(`${LEGACY_ROOT}/test/notes.md`), 'keep');
  assert.equal(f.service.root, calendarRoot('Work/ThingsMD'));
  assert.equal(f.service.today().events.length, 1);
});

test('moving a custom home retains cached events and removes empty legacy folders', async () => {
  const f = fixture('Work/ThingsMD/Calendars');
  await f.service.reload();
  const oldState = f.service.state(f.service.config[0]);
  await moveCalendarHome(f.plugin, 'New home');
  assert.equal(f.files.get(`New home/Calendars/test/${name}`), body());
  assert.equal(f.service.today().events.length, 1);
  assert.notEqual(f.service.state(f.service.config[0]), oldState);
  assert.equal(f.folders.has('Work/ThingsMD/Calendars'), false);
});

test('a collision rejects migration before any snapshot or settings change', async () => {
  const f = fixture();
  f.files.set(`ThingsMD/Calendars/test/${name}`, 'external');
  let committed = false;
  await assert.rejects(
    moveCalendarHome(f.plugin, 'ThingsMD', () => {
      committed = true;
    }),
    /already contains/,
  );
  assert.equal(committed, false);
  assert.equal(f.files.get(`ThingsMD/Calendars/test/${name}`), 'external');
  assert.equal(f.files.get(`${LEGACY_ROOT}/test/${name}`), body());
  assert.equal(f.service.moving, false);
});

test('identical snapshots synced into both homes migrate without overwriting either copy', async () => {
  const f = fixture();
  f.files.set(`ThingsMD/Calendars/test/${name}`, body());
  await moveCalendarHome(f.plugin, 'ThingsMD');
  assert.equal(f.files.has(`${LEGACY_ROOT}/test/${name}`), false);
  assert.equal(f.files.size, 2);
  assert.ok([...f.files.keys()].every((p) => p.startsWith('ThingsMD/Calendars/test/')));
  assert.ok([...f.files.values()].every((value) => value === body()));
  assert.equal(f.service.today().events.length, 1);
});
test('home migration preserves cache generations, including duplicate snapshot names', async () => {
  const f = fixture();
  const tagged = name.replace('.ics', '_s-replacement.ics');
  f.files.set(`${LEGACY_ROOT}/test/${tagged}`, body('New source'));
  f.files.set(`ThingsMD/Calendars/test/${tagged}`, body('New source'));
  await moveCalendarHome(f.plugin, 'ThingsMD');
  const taggedFiles = [...f.files.keys()].filter((p) => p.endsWith('_s-replacement.ics'));
  assert.equal(taggedFiles.length, 2);
  assert.ok(taggedFiles.every((p) => p.startsWith('ThingsMD/Calendars/test/')));
});

test('failed home persistence rolls calendars back, including external edits to moved files', async () => {
  const f = fixture();
  await assert.rejects(
    moveCalendarHome(f.plugin, 'ThingsMD', async () => {
      f.files.set(`ThingsMD/Calendars/test/${name}`, 'externally edited');
      throw new Error('settings failed');
    }),
    /settings failed/,
  );
  assert.equal(f.files.get(`${LEGACY_ROOT}/test/${name}`), 'externally edited');
  assert.equal(f.files.has(`ThingsMD/Calendars/test/${name}`), false);
  assert.equal(f.service.root, LEGACY_ROOT);
});

test('migration waits for an in-flight refresh and prevents new downloads while moving', async () => {
  const f = fixture();
  let finish;
  f.service.pending.set(
    'test',
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const moving = moveCalendarHome(f.plugin, 'ThingsMD');
  assert.equal(f.service.moving, true);
  await f.service.refreshAll(true);
  assert.equal(f.files.has(`ThingsMD/Calendars/test/${name}`), false);
  finish();
  await moving;
  assert.equal(f.files.get(`ThingsMD/Calendars/test/${name}`), body());
});

test('empty-folder cleanup failures cannot fail a committed move', async () => {
  const f = fixture();
  f.plugin.app.vault.adapter.rmdir = async () => {
    throw new Error('folder changed');
  };
  await moveCalendarHome(f.plugin, 'ThingsMD');
  assert.equal(f.service.root, 'ThingsMD/Calendars');
});

function desktopRemoval(f, beforeRemove = () => {}) {
  const adapter = f.plugin.app.vault.adapter;
  const reconciled = [];
  adapter.rmdir = async () => {
    throw new Error('EISDIR: rm with recursive:false refuses a directory');
  };
  adapter.queue = (operation) => operation();
  adapter.getFullPath = (path) => `/disposable/${path}`;
  adapter.reconcileInternalFile = async (path) => reconciled.push(path);
  adapter.fsPromises = {
    async rmdir(fullPath) {
      assert.ok(fullPath.startsWith('/disposable/'));
      const path = fullPath.slice('/disposable/'.length);
      beforeRemove(path);
      const children = await adapter.list(path);
      if (children.files.length || children.folders.length) throw new Error('ENOTEMPTY');
      f.folders.delete(path);
    },
  };
  return reconciled;
}

test('desktop home moves remove empty calendar directories even when the public nonrecursive API fails', async () => {
  const root = 'ThingsMD/Tasks/Calendars';
  const f = fixture(root);
  for (const id of ['second', 'third']) {
    f.folders.add(`${root}/${id}`);
    f.files.set(`${root}/${id}/${name}`, body(id));
  }
  const reconciled = desktopRemoval(f);
  await moveCalendarHome(f.plugin, 'ThingsMD-Home');
  for (const id of ['test', 'second', 'third']) {
    assert.equal(f.files.has(`ThingsMD-Home/Calendars/${id}/${name}`), true);
    assert.equal(f.folders.has(`${root}/${id}`), false);
  }
  assert.equal(f.folders.has(root), false);
  assert.deepEqual(reconciled, [`${root}/test`, `${root}/second`, `${root}/third`, root]);
});

test('desktop cleanup retains a file synced into an empty old folder before its removal', async () => {
  const f = fixture();
  const oldFolder = `${LEGACY_ROOT}/test`;
  desktopRemoval(f, (path) => {
    if (path === oldFolder) f.files.set(`${oldFolder}/external.md`, 'Synced while moving');
  });
  await moveCalendarHome(f.plugin, 'ThingsMD-Home');
  assert.equal(f.files.has(`ThingsMD-Home/Calendars/test/${name}`), true);
  assert.equal(f.files.get(`${oldFolder}/external.md`), 'Synced while moving');
  assert.equal(f.folders.has(oldFolder), true);
  assert.equal(f.folders.has(LEGACY_ROOT), true);
  assert.equal(f.service.root, 'ThingsMD-Home/Calendars');
});
