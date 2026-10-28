// Presentation only: the folder stays indexed even when its explorer row is hidden.
module.exports = (plugin) => {
  const roots = new Set();
  const clear = (root) => {
    for (const el of root.querySelectorAll(
      '.ot-task-folder-hidden,.ot-task-folder-last,.ot-task-folder-siblings',
    ))
      el.classList.remove(
        'ot-task-folder-hidden',
        'ot-task-folder-last',
        'ot-task-folder-siblings',
      );
  };
  plugin.paintTaskFolder = () => {
    // Closed explorer panes must not retain their entire DOM until plugin unload.
    for (const root of roots)
      if (!root.isConnected) {
        clear(root);
        roots.delete(root);
      }
    for (const leaf of plugin.app.workspace.getLeavesOfType('file-explorer')) {
      const root = leaf.view.containerEl;
      roots.add(root);
      clear(root);
      const title = [...root.querySelectorAll('.nav-folder-title[data-path]')].find(
        (el) => el.dataset.path === plugin.settings.tasksFolder,
      );
      const row = title?.closest('.nav-folder');
      if (!row) continue;
      if (plugin.settings.tasksFolderDisplay === 'hidden')
        row.classList.add('ot-task-folder-hidden');
      if (plugin.settings.tasksFolderDisplay === 'last') {
        row.classList.add('ot-task-folder-last');
        row.parentElement.classList.add('ot-task-folder-siblings');
      }
    }
  };
  let timer;
  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.target.closest?.('.nav-files-container'))) return;
    clearTimeout(timer);
    timer = setTimeout(plugin.paintTaskFolder, 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  plugin.registerEvent(plugin.app.workspace.on('layout-change', plugin.paintTaskFolder));
  plugin.app.workspace.onLayoutReady(plugin.paintTaskFolder);
  plugin.register(() => {
    observer.disconnect();
    clearTimeout(timer);
    for (const root of roots) clear(root);
  });
};
