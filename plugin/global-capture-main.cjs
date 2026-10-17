// Runs in Electron's main process. Keep this function self-contained so the
// renderer can send its source without passing callbacks through remote.
module.exports = function createMainCapture(win, channel, shortcuts) {
  const owned = new Set();
  const contents = win.webContents;
  let disposed = false;
  const activate = () =>
    setImmediate(() => {
      if (disposed || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      contents.send(channel);
    });
  const unregister = (value) => {
    if (!owned.delete(value)) return;
    shortcuts.unregister(value);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const value of owned) unregister(value);
    contents.removeListener('did-start-navigation', navigate);
    contents.removeListener('render-process-gone', dispose);
    contents.removeListener('destroyed', dispose);
  };
  const navigate = (details, url, isInPlace, isMainFrame) => {
    // Electron supports both event-details and legacy positional arguments.
    if ((details.isMainFrame ?? isMainFrame) && !(details.isSameDocument ?? isInPlace)) dispose();
  };
  contents.on('did-start-navigation', navigate);
  contents.on('render-process-gone', dispose);
  contents.on('destroyed', dispose);
  return {
    activate,
    register(value) {
      if (disposed || !shortcuts.register(value, activate)) return false;
      owned.add(value);
      return true;
    },
    unregister,
    dispose,
  };
};
