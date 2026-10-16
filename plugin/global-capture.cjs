const { Platform, Notice } = require('obsidian');

module.exports = function installGlobalCapture(plugin) {
  if (!Platform.isDesktopApp) return;
  let remote,
    window,
    systemCapture,
    registered = '',
    disposed = false;
  const channel = `things-global-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { ipcRenderer } = require('electron');
  try {
    remote = require('@electron/remote');
    window = remote.getCurrentWindow();
    // Keep OS activation in the main process, before notifying the background
    // renderer. The callback owns only this vault window and this IPC channel.
    systemCapture = remote.require('vm').compileFunction(
      `return function(){setImmediate(()=>{
      if(win.isDestroyed())return;
      if(win.isMinimized())win.restore();
      win.show();win.focus();
      win.webContents.send(channel);
    });}`,
      ['win', 'channel'],
    )(window, channel);
  } catch {
    plugin.globalCaptureError = 'Global capture is unavailable in this Obsidian version.';
  }
  const capture = () => {
    try {
      plugin.app.setting.close();
      plugin.capture();
    } catch (e) {
      new Notice(`Could not open global capture: ${e.message}`);
    }
  };
  plugin.openGlobalCapture = () => systemCapture?.();
  ipcRenderer.on(channel, capture);
  const change = (value) => {
    if (value === registered) return;
    if (value) {
      if (!systemCapture)
        throw new Error('Global capture is unavailable in this Obsidian version.');
      if (
        !/(^|\+)(CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|Super|Meta)(\+|$)/i.test(
          value,
        )
      )
        throw new Error('Include Command, Control, or Alt with the key.');
      let success = false;
      try {
        success = remote.globalShortcut.register(value, systemCapture);
      } catch {}
      if (!success)
        throw new Error(
          'Could not register this shortcut. Check its spelling or choose a combination not used by another app or vault.',
        );
    }
    // Register the replacement first: a conflict must not disable the old key.
    if (registered) remote.globalShortcut.unregister(registered);
    registered = value;
  };
  plugin.pauseGlobalCapture = () => {
    if (registered) remote.globalShortcut.unregister(registered);
    registered = '';
    return () => {
      if (!disposed) change(plugin.settings.globalCaptureHotkey);
    };
  };
  plugin.setGlobalCaptureHotkey = async (value) => {
    let previous;
    await plugin.persistSettings(
      { globalCaptureHotkey: value.trim() },
      {
        prepare: (next) => {
          previous = registered;
          change(next.globalCaptureHotkey);
        },
        rollback: () => {
          if (!disposed) change(previous);
        },
      },
    );
    plugin.globalCaptureError = '';
  };
  try {
    change(plugin.settings.globalCaptureHotkey);
  } catch (e) {
    plugin.globalCaptureError = e.message;
    new Notice(`Global capture: ${e.message}`);
  }
  plugin.register(() => {
    disposed = true;
    if (registered) remote.globalShortcut.unregister(registered);
    registered = '';
    ipcRenderer.removeListener(channel, capture);
    delete plugin.openGlobalCapture;
    delete plugin.pauseGlobalCapture;
  });
};
