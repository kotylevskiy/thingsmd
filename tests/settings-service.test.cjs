const test = require('node:test');
const assert = require('node:assert/strict');
const install = require('../plugin/settings/settings-service.cjs');
async function fixture(data = null) {
  const writes = [],
    cleanup = [];
  const plugin = {
    loadData: async () => data,
    saveData: async (value) => writes.push(value),
    register: (cb) => cleanup.push(cb),
  };
  await install(plugin);
  return { plugin, writes, cleanup };
}
test('first setup saves the system time zone once, preserving other saved data', async () => {
  const { plugin, writes } = await fixture({ logbook: 'weekly', extra: 'keep' });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(plugin.settings.timeZone, timeZone);
  assert.deepEqual(writes, [{ logbook: 'weekly', extra: 'keep', timeZone }]);
  const reloaded = await fixture(writes[0]);
  assert.equal(reloaded.plugin.settings.timeZone, timeZone);
  assert.equal(reloaded.writes.length, 0);
});
test('an existing vault time zone is retained instead of following this device', async () => {
  const { plugin, writes } = await fixture({ timeZone: 'Pacific/Honolulu' });
  assert.equal(plugin.settings.timeZone, 'Pacific/Honolulu');
  assert.equal(writes.length, 0);
  await plugin.persistSettings({ showProjectProgress: false });
  assert.equal(writes.at(-1).timeZone, 'Pacific/Honolulu');
});
test('failure to save the initial time zone prevents starting with an unsaved device zone', async () => {
  await assert.rejects(
    install({
      loadData: async () => null,
      saveData: async () => {
        throw new Error('Disk full');
      },
    }),
    /Disk full/,
  );
});
test('a failed settings save never activates a destructive retention policy', async () => {
  const { plugin } = await fixture();
  let maintenance = 0;
  plugin.maintainArchives = async () => {
    maintenance++;
    assert.equal(plugin.settings.trashRetention, 'never');
  };
  plugin.saveData = async () => {
    throw Error('Disk full');
  };
  await assert.rejects(plugin.updateSettings({ trashRetention: 'immediately' }), /Disk full/);
  assert.equal(plugin.settings.trashRetention, 'never');
  assert.equal(maintenance, 1);
});
test('concurrent settings changes merge after persistence and failures do not poison the queue', async () => {
  const { plugin, writes } = await fixture();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  plugin.saveData = async (value) => {
    await gate;
    writes.push(value);
  };
  const first = plugin.persistSettings({ globalCaptureHotkey: 'Control+Y' });
  const second = plugin.persistSettings({ showProjectProgress: false });
  assert.equal(plugin.settings.globalCaptureHotkey, '');
  release();
  await Promise.all([first, second]);
  assert.equal(plugin.settings.globalCaptureHotkey, 'Control+Y');
  assert.equal(plugin.settings.showProjectProgress, false);
  assert.equal(writes.at(-1).globalCaptureHotkey, 'Control+Y');
  await assert.rejects(
    plugin.persistSettings(
      {},
      {
        prepare: () => {
          throw Error('Conflict');
        },
      },
    ),
  );
  await plugin.persistSettings({ showProjectProgress: true });
  assert.equal(plugin.settings.showProjectProgress, true);
});
test('failed persistence rolls back a prepared side effect; unload rejects queued changes', async () => {
  const { plugin, cleanup } = await fixture();
  let registered = 'old';
  plugin.saveData = async () => {
    throw Error('Failure');
  };
  await assert.rejects(
    plugin.persistSettings(
      { globalCaptureHotkey: 'new' },
      {
        prepare: () => {
          registered = 'new';
        },
        rollback: () => {
          registered = 'old';
        },
      },
    ),
  );
  assert.equal(registered, 'old');
  cleanup.forEach((cb) => cb());
  await assert.rejects(plugin.persistSettings({ logbook: 'manually' }), /unloaded/);
});

test('disabling Waiting For persists the setting and redirects its open list without rewriting tasks', async () => {
  const { plugin, writes } = await fixture();
  const navigated = [];
  let refreshed = 0;
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [
        { view: { page: 'waiting', navigate: async (page) => navigated.push(page) } },
      ],
    },
  };
  plugin.mountListLinks = () => {};
  plugin.tasksChanged = () => {};
  plugin.maintainArchives = async () => {};
  plugin.captureModal = { card: { refreshSettings: () => refreshed++ } };
  await plugin.updateSettings({ enableWaiting: false });
  assert.equal(writes.at(-1).enableWaiting, false);
  assert.deepEqual(navigated, ['anytime']);
  assert.equal(refreshed, 1);
});

test('settings leave deferred tabs unloaded and update the mounted list', async () => {
  const { plugin } = await fixture();
  const dormant = { isDeferred: true, view: {} };
  const navigated = [];
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [
        dormant,
        { view: { page: 'waiting', navigate: async (page) => navigated.push(page) } },
      ],
    },
  };
  plugin.mountListLinks = () => {};
  plugin.tasksChanged = () => {};
  plugin.maintainArchives = async () => {};
  await plugin.updateSettings({ enableWaiting: false });
  assert.deepEqual(navigated, ['anytime']);
  assert.equal(dormant.isDeferred, true);
  assert.deepEqual(dormant.view, {});
});

test('mobile navigation changes only after its preference is saved', async () => {
  const { plugin } = await fixture();
  const applied = [];
  plugin.app = { workspace: { getLeavesOfType: () => [] } };
  plugin.mountListLinks = () => {};
  plugin.tasksChanged = () => {};
  plugin.maintainArchives = async () => {};
  plugin.refreshMobileNavigation = () => applied.push(plugin.settings.mobileTaskNavigation);
  plugin.saveData = async () => {
    throw new Error('Disk full');
  };
  await assert.rejects(plugin.updateSettings({ mobileTaskNavigation: true }), /Disk full/);
  assert.equal(plugin.settings.mobileTaskNavigation, false);
  assert.deepEqual(applied, []);
  plugin.saveData = async () => {};
  await plugin.updateSettings({ mobileTaskNavigation: true });
  await plugin.updateSettings({ mobileTaskNavigation: false });
  assert.deepEqual(applied, [true, false]);
});

test('calendar edits resolve against committed settings without losing concurrent fields or removals', async () => {
  const { plugin, writes } = await fixture({
    timeZone: 'UTC',
    calendars: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
  });
  await Promise.all([
    plugin.persistSettings((settings) => ({
      calendars: settings.calendars.map((c) => (c.id === 'a' ? { ...c, name: 'Renamed' } : c)),
    })),
    plugin.persistSettings((settings) => ({
      calendars: settings.calendars.map((c) => (c.id === 'a' ? { ...c, color: 'tomato' } : c)),
    })),
    plugin.persistSettings((settings) => ({
      calendars: settings.calendars.filter((c) => c.id !== 'b'),
    })),
    plugin.persistSettings((settings) => ({
      calendars: [...settings.calendars, { id: 'c', name: 'C' }],
    })),
  ]);
  assert.deepEqual(
    plugin.settings.calendars.map((c) => [c.id, c.name, c.color]),
    [
      ['a', 'Renamed', 'tomato'],
      ['c', 'C', ''],
    ],
  );
  assert.deepEqual(writes.at(-1).calendars, plugin.settings.calendars);
});
