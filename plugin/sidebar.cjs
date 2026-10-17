const { Notice, setIcon } = require('obsidian');
const { LISTS, VIEW, isListAvailable } = require('./lists.cjs');
const { button } = require('./dom.cjs');

// Own only file-explorer shortcuts. Native note controls stay owned by Obsidian.
module.exports = function installSidebar(plugin) {
  plugin.mountListLinks = () => {
    if (!plugin.listLinks) return;
    const workspace = plugin.app.workspace;
    for (const nav of plugin.listLinks) if (!nav.isConnected) plugin.listLinks.delete(nav);
    for (const leaf of workspace.getLeavesOfType('file-explorer')) {
      const container = leaf.view.containerEl;
      const files = container.querySelector('.nav-files-container');
      if (!files) continue;
      let nav = container.querySelector('.ot-list-links');
      if (!nav) {
        nav = container.createEl('nav', {
          cls: 'ot-list-links',
          attr: { 'aria-label': 'Task lists' },
        });
        plugin.listLinks.add(nav);
        for (const [key, label, icon] of LISTS) {
          const row = button(
            nav,
            '',
            () => plugin.openList(key),
            'ot-list-link tree-item-self is-clickable',
          );
          row.dataset.list = key;
          setIcon(row.createSpan('ot-list-link-icon'), icon);
          row.createSpan({ text: label, cls: 'tree-item-inner' });
          if (key === 'inbox' || key === 'today') {
            const count = row.createSpan({ cls: 'ot-list-count', attr: { 'aria-hidden': 'true' } });
            count.hidden = true;
          }
          row.ondragover = (e) => {
            if (key !== 'logbook' && Array.from(e.dataTransfer.types).includes('text/ot-task')) {
              e.preventDefault();
              row.addClass('is-over');
            }
          };
          row.ondragleave = () => row.removeClass('is-over');
          row.ondrop = (e) => {
            row.removeClass('is-over');
            const id = e.dataTransfer.getData('text/ot-task');
            if (!id || key === 'logbook') return;
            e.preventDefault();
            plugin.dropTaskOnList({ id }, key).catch((error) => new Notice(error.message));
          };
        }
      }
      require('./sidebar-lifecycle.cjs').placeLinks(
        files,
        nav,
        container.querySelector('.nav-header'),
      );
      for (const row of nav.querySelectorAll('.ot-list-link')) {
        const active = workspace.activeLeaf?.view;
        row.hidden = !isListAvailable(row.dataset.list, plugin.settings);
        const selected = active?.getViewType() === VIEW && active.page === row.dataset.list;
        row.toggleClass('is-active', selected);
        if (selected) row.setAttribute('aria-current', 'page');
        else row.removeAttribute('aria-current');
      }
    }
    plugin.paintListCounts?.();
  };
  plugin.listLinks = new Set();
  require('./list-counts.cjs').install(plugin);
  plugin.register(() => {
    for (const nav of plugin.listLinks) nav.remove();
    plugin.listLinks.clear();
    plugin.listLinks = null;
  });
  plugin.app.workspace.onLayoutReady(() => {
    if (plugin.listLinks) plugin.mountListLinks();
  });
  require('./sidebar-lifecycle.cjs').install(plugin);
  plugin.registerEvent(plugin.app.workspace.on('layout-change', () => plugin.mountListLinks()));
  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', () => plugin.mountListLinks()),
  );
};
