const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs');
test('global capture focuses the vault, keeps old binding on conflict, and removes only its own binding', async () => {
  const bindings = new Map([['Ctrl+K', () => {}]]),
    calls = [],
    cleanup = [];
  const ipc = new (require('node:events').EventEmitter)();
  const remote = {
    require: () => ({ compileFunction: vm.compileFunction }),
    globalShortcut: {
      register: (key, cb) => {
        if (bindings.has(key)) return false;
        bindings.set(key, cb);
        return true;
      },
      unregister: (key) => bindings.delete(key),
    },
    getCurrentWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel) => ipc.emit(channel) },
      isMinimized: () => true,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus'),
    }),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('plugin/global-capture.cjs', 'utf8'), {
    module,
    setTimeout: (cb) => cb(),
    require: (name) =>
      name === 'obsidian'
        ? { Platform: { isDesktopApp: true }, Notice: class {} }
        : name === 'electron'
          ? { ipcRenderer: ipc }
          : remote,
  });
  const p = {
    loadData: async () => ({ globalCaptureHotkey: '' }),
    app: { setting: { close: () => calls.push('close settings') } },
    capture: () => calls.push('capture'),
    register: (cb) => cleanup.push(cb),
    saveData: async () => {},
  };
  await require('../plugin/settings-service.cjs')(p);
  module.exports(p);
  await p.setGlobalCaptureHotkey('Ctrl+Shift+Space');
  bindings.get('Ctrl+Shift+Space')();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['restore', 'show', 'focus', 'close settings', 'capture']);
  await assert.rejects(p.setGlobalCaptureHotkey('Ctrl+K'), /Could not register/);
  assert.equal(p.settings.globalCaptureHotkey, 'Ctrl+Shift+Space');
  assert(bindings.has('Ctrl+Shift+Space'));
  await p.setGlobalCaptureHotkey('Ctrl+Alt+Space');
  assert(!bindings.has('Ctrl+Shift+Space'));
  cleanup.forEach((cb) => cb());
  assert.deepEqual([...bindings.keys()], ['Ctrl+K']);
});

test('global capture avoids desktop imports in the real mobile emulation mode', () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../plugin/global-capture.cjs'), 'utf8'), {
    module,
    require(name) {
      assert.equal(name, 'obsidian', 'A mobile UI must not load desktop-only modules');
      return { Platform: { isDesktopApp: true, isMobile: true } };
    },
  });
  assert.doesNotThrow(() => module.exports({}));
});
