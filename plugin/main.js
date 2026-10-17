const { Plugin, Notice } = require('obsidian');
const { VIEW, resolveList } = require('./lists.cjs');
const ThingsMDView = require('./list-view.cjs');
const TaskCapture = require('./task-capture.cjs');

module.exports = class ThingsMDPlugin extends Plugin {
  async onload() {
    // Compose services before installing UI adapters that call them.
    require('./dialogs.cjs')(this);
    require('./task-store.cjs')(this);
    require('./task-actions.cjs')(this);
    require('./move-notice.cjs').install(this);
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
    require('./touch-tasks.cjs')(this);
    require('./task-transfer.cjs').install(this);
    await require('./native-editor.cjs')(this);
    require('./project-progress.cjs').install(this);
    require('./sidebar.cjs')(this);
    await require('./task-refresh.cjs')(this);
    this.addRibbonIcon('plus', 'New task', () =>
      this.newTaskHere().catch((error) => new Notice(error.message)),
    );
    require('./commands.cjs')(this);
    require('./global-capture.cjs')(this);
    require('./mobile-navigation.cjs')(this);
    this.register(() => this.captureModal?.close());
    this.addCommand({ id: 'open', name: 'Open task lists', callback: () => this.open() });
  }
  async open() {
    await this.openList('inbox');
  }
  mainWorkspaceLeaf() {
    return require('./workspace-leaf.cjs')(this.app.workspace);
  }
  async openList(page) {
    page = resolveList(page, this.settings);
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
