const { Plugin, Notice, setIcon } = require('obsidian');
const { VIEW, LISTS, TASKS } = require('./lists.cjs');
const { today } = require('./local-date.cjs');
const { button } = require('./dom.cjs');
const ThingsMDView = require('./list-view.cjs');
const TaskCapture = require('./task-capture.cjs');

module.exports = class ThingsMDPlugin extends Plugin {
  async onload() {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(TASKS))) await adapter.mkdir(TASKS);
    require('./task-store.cjs')(this);
    require('./task-actions.cjs')(this);
    await require('./settings-service.cjs')(this);
    require('./archives.cjs')(this, (path) => {
      const cards = [...document.querySelectorAll('.ot-native')].map((el) => el._thingsCard);
      cards.push(...this.app.workspace.getLeavesOfType(VIEW).map((leaf) => leaf.view));
      return cards.some((card) => card?.taskDraft?.task.file.path === path);
    });
    require('./settings.cjs')(this);
    require('./task-menu.cjs')(this);
    require('./daily-capture.cjs')(this);
    this.registerView(VIEW, (leaf) => new ThingsMDView(leaf, this));
    require('./search.cjs')(this);
    require('./repeat-engine.cjs')(this);
    require('./repeat-ui.cjs').install(this);
    await this.repeating.tick().catch((error) => new Notice('Repeating tasks: ' + error.message));
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        (async () => {
          for (const task of await this.taskRecords()) {
            const path = task.meta.project;
            if (path === oldPath || (typeof path === 'string' && path.startsWith(oldPath + '/')))
              await this.patchTask(task, { project: file.path + path.slice(oldPath.length) });
          }
        })().catch((error) => new Notice(error.message));
      }),
    );
    require('./touch-tasks.cjs')(this);
    require('./task-transfer.cjs').install(this);
    await require('./native-editor.cjs')(this);
    require('./project-progress.cjs').install(this);
    let fingerprint;
    let scanning = false;
    let currentDay = today();
    this.registerInterval(
      window.setInterval(async () => {
        if (scanning) return;
        scanning = true;
        try {
          await this.repeating.tick();
          await this.maintainArchives();
          if (currentDay !== today()) {
            currentDay = today();
            this.tasksChanged();
          }
          const next = JSON.stringify(await this.taskRecords());
          if (next !== fingerprint) this.tasksChanged();
          fingerprint = next;
        } catch (error) {
          console.error('ThingsMD task refresh:', error);
        } finally {
          scanning = false;
        }
      }, 1500),
    );
    this.listLinks = new Set();
    require('./list-counts.cjs').install(this);
    this.register(() => {
      for (const nav of this.listLinks) nav.remove();
      this.listLinks.clear();
      this.listLinks = null;
    });
    this.app.workspace.onLayoutReady(() => {
      if (this.listLinks) this.mountListLinks();
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mountListLinks()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.mountListLinks()));
    this.addRibbonIcon('plus', 'New task', () => this.newTaskHere());
    require('./commands.cjs')(this);
    require('./global-capture.cjs')(this);
    this.register(() => this.captureModal?.close());
    this.addCommand({ id: 'open', name: 'Open task lists', callback: () => this.open() });
  }
  async open() {
    await this.openList('inbox');
  }
  mountListLinks() {
    if (!this.listLinks) return;
    const workspace = this.app.workspace;
    for (const nav of this.listLinks) if (!nav.isConnected) this.listLinks.delete(nav);
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
        files.before(nav);
        this.listLinks.add(nav);
        for (const [key, label, icon] of LISTS) {
          const row = button(
            nav,
            '',
            () => this.openList(key),
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
            this.dropTaskOnList({ id }, key).catch((error) => new Notice(error.message));
          };
        }
      }
      for (const row of nav.querySelectorAll('.ot-list-link')) {
        const active = workspace.activeLeaf?.view;
        row.hidden =
          (row.dataset.list === 'trash' && this.settings.trashRetention === 'immediately') ||
          (row.dataset.list === 'inbox' && this.settings.captureDestination === 'daily-note');
        const selected = active?.getViewType() === VIEW && active.page === row.dataset.list;
        row.toggleClass('is-active', selected);
        if (selected) row.setAttribute('aria-current', 'page');
        else row.removeAttribute('aria-current');
      }
    }
    this.paintListCounts?.();
  }
  mainWorkspaceLeaf() {
    return require('./workspace-leaf.cjs')(this.app.workspace);
  }
  async openList(page) {
    if (page === 'trash' && this.settings.trashRetention === 'immediately') page = 'inbox';
    if (page === 'inbox' && this.settings.captureDestination === 'daily-note') page = 'today';
    const leaf = this.mainWorkspaceLeaf();
    await leaf.loadIfDeferred?.();
    if (leaf.view.getViewType() !== VIEW)
      await leaf.setViewState({ type: VIEW, state: { page }, active: true });
    else await leaf.view.navigate(page);
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.mountListLinks();
  }
  capture(fields = {}) {
    if (this.captureModal) {
      this.captureModal.contentEl.querySelector('.ot-title-input')?.focus();
      return;
    }
    this.captureModal = new TaskCapture(this, fields);
    this.captureModal.open();
  }
  tasksChanged() {
    this.app.workspace.trigger('things-tasks-changed');
  }
};
