const { Platform, Notice } = require('obsidian');

module.exports = function installGlobalCapture(plugin) {
  // Obsidian's mobile emulation still runs in a desktop shell, but blocks Node imports.
  if (!Platform.isDesktopApp || Platform.isMobile) return;
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
    // Register the callback inside the main process too. Passing a remote
    // function back to globalShortcut wraps it as a renderer callback, which
    // can freeze native activation before our capture IPC is delivered.
    systemCapture = remote
      .require('vm')
      .compileFunction(
        `return (${require('./global-capture-main.cjs').toString()})(win,channel,shortcuts);`,
        ['win', 'channel', 'shortcuts'],
      )(window, channel, remote.globalShortcut);
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
  plugin.openGlobalCapture = () => systemCapture?.activate();
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
        success = systemCapture.register(value);
      } catch {}
      if (!success)
        throw new Error(
          'Could not register this shortcut. Check its spelling or choose a combination not used by another app or vault.',
        );
    }
    // Register the replacement first: a conflict must not disable the old key.
    if (registered) systemCapture.unregister(registered);
    registered = value;
  };
  plugin.pauseGlobalCapture = () => {
    if (registered) systemCapture.unregister(registered);
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
    systemCapture?.dispose();
    registered = '';
    ipcRenderer.removeListener(channel, capture);
    delete plugin.openGlobalCapture;
    delete plugin.pauseGlobalCapture;
  });
};
