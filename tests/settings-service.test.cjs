const test = require('node:test');
const assert = require('node:assert/strict');
const install = require('../plugin/settings-service.cjs');
async function fixture() {
  const writes = [],
    cleanup = [];
  const plugin = {
    loadData: async () => null,
    saveData: async (value) => writes.push(value),
    register: (cb) => cleanup.push(cb),
  };
  await install(plugin);
  return { plugin, writes, cleanup };
}
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
