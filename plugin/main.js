const { Plugin, Notice } = require('obsidian');
const { VIEW, resolveList } = require('./lists/lists.cjs');
const ThingsMDView = require('./lists/list-view.cjs');
const TaskCapture = require('./tasks/task-capture.cjs');

module.exports = class ThingsMDPlugin extends Plugin {
  async onload() {
    require('./shared/icons.cjs')();
    // Compose services before installing UI adapters that call them.
    require('./shared/dialogs.cjs')(this);
    require('./tasks/task-store.cjs')(this);
    require('./notes/task-note-frontmatter.cjs')(this);
    require('./tasks/task-actions.cjs')(this);
    require('./tasks/move-notice.cjs').install(this);
    await require('./settings/settings-service.cjs')(this);
    await require('./calendar/index.cjs')(this);
    await require('./tasks/task-folder.cjs')(this);
    await require('./identifier-migration.cjs')(this);
    require('./tasks/task-folder-explorer.cjs')(this);
    require('./notes/task-notes.cjs')(this);
    require('./notes/task-note-title.cjs')(this);
    require('./tasks/archives.cjs')(this, (path) => {
      const cards = [...document.querySelectorAll('.ot-native')].map((el) => el._thingsmdCard);
      cards.push(...this.app.workspace.getLeavesOfType(VIEW).map((leaf) => leaf.view));
      cards.push(...(this.taskNoteControllers || []));
      return (
        this.taskNoteTitleDrafts?.has(path) ||
        cards.some((card) => card?.taskDraft?.task.file.path === path)
      );
    });
    require('./settings/settings.cjs')(this);
    require('./tasks/task-menu.cjs')(this);
    require('./tasks/daily-capture.cjs')(this);
    this.registerView(VIEW, (leaf) => new ThingsMDView(leaf, this));
    // Restore old saved tabs through the new view, whose getViewType writes VIEW.
    this.registerView(
      require('./legacy-identifiers.cjs').LEGACY_VIEW,
      (leaf) => new ThingsMDView(leaf, this),
    );
    this.app.workspace.onLayoutReady(() => this.app.workspace.requestSaveLayout());
    require('./search/search.cjs')(this);
    require('./tasks/repeat-engine.cjs')(this);
    require('./tasks/repeat-ui.cjs').install(this);
    require('./tasks/touch-tasks.cjs')(this);
    require('./tasks/task-transfer.cjs').install(this);
    await require('./notes/native-editor.cjs')(this);
    require('./tasks/project-progress.cjs').install(this);
    require('./sidebar.cjs')(this);
    await require('./tasks/task-refresh.cjs')(this);
    this.addRibbonIcon('plus', 'New task', () =>
      this.newTaskHere().catch((error) => new Notice(error.message)),
    );
    require('./commands.cjs')(this);
    require('./tasks/global-capture.cjs')(this);
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
    this.app.workspace.trigger('thingsmd-tasks-changed');
  }
};
