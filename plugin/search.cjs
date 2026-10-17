const { Modal, Notice, setIcon, addIcon } = require('obsidian');
const { search } = require('./search-model.cjs');
const { today: day } = require('./local-date.cjs');
module.exports = function install(plugin) {
  // A checkmark inside the lens distinguishes task search from vault search.
  // currentColor keeps the icon aligned with the active Obsidian theme.
  addIcon(
    'things-task-search',
    '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><circle cx="40" cy="40" r="29"/><path d="m62 62 26 26M30 40l7 7 14-15"/></g>',
  );
  class QuickFind extends Modal {
    onOpen() {
      this.modalEl.addClass('ot-search-modal');
      this.contentEl.empty();
      this.records = [];
      this.index = 0;
      this.version = 0;
      const bar = this.contentEl.createDiv('ot-search-bar');
      setIcon(bar.createSpan(), 'things-task-search');
      this.input = bar.createEl('input', {
        attr: {
          type: 'search',
          placeholder: 'Quick Find',
          'aria-label': 'Quick Find',
          autocomplete: 'off',
        },
      });
      this.input.oninput = () => {
        this.index = 0;
        this.draw();
      };
      this.input.onkeydown = (e) => {
        if (e.isComposing) return;
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          this.index = Math.max(
            0,
            Math.min(this.results.length - 1, this.index + (e.key === 'ArrowDown' ? 1 : -1)),
          );
          this.highlight();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.choose(this.results[this.index]);
        }
      };
      this.scope.register([], 'Escape', () => {
        this.close();
        return false;
      });
      this.scopeLabel = this.contentEl.createDiv('ot-search-scope');
      this.list = this.contentEl.createDiv({
        cls: 'ot-search-results',
        attr: { role: 'listbox', 'aria-label': 'Search results' },
      });
      this.input.setAttribute('role', 'combobox');
      this.input.setAttribute('aria-expanded', 'true');
      this.list.id = 'ot-quick-find-results';
      this.input.setAttribute('aria-controls', this.list.id);
      this.more = this.contentEl.createEl('button', {
        text: 'Continue Search',
        cls: 'ot-search-more',
      });
      this.more.onclick = () => {
        this.broad = true;
        this.index = 0;
        this.draw();
        this.input.focus();
      };
      this.status = this.contentEl.createDiv({ cls: 'ot-search-status', attr: { role: 'status' } });
      this.events = ['things-tasks-changed'].map((e) =>
        plugin.app.workspace.on(e, () => this.refresh()),
      );
      this.vaultEvents = ['modify', 'create', 'delete', 'rename'].map((e) =>
        plugin.app.vault.on(e, () => this.refresh()),
      );
      // Populate keyboard navigation before the asynchronous index read finishes.
      this.draw();
      this.refresh();
      this.input.focus();
    }
    async refresh() {
      const v = ++this.version;
      try {
        const records = await plugin.records();
        if (v !== this.version || !this.contentEl.isConnected) return;
        this.records = records;
        this.draw();
      } catch (e) {
        this.status.textContent = 'Unable to search tasks: ' + e.message;
      }
    }
    draw() {
      this.results = search(this.records, this.input.value, {
        broad: this.broad,
        today: day(),
        settings: plugin.settings,
      });
      if (!this.input.value.trim()) this.results = this.results.filter((r) => r.kind === 'list');
      this.list.empty();
      this.scopeLabel.empty();
      if (this.broad)
        this.scopeLabel.createSpan({ text: 'Including notes, checklists, and Logbook' });
      this.results.forEach((r, i) => {
        const row = this.list.createDiv({
          cls: 'ot-search-result',
          attr: { role: 'option', id: 'ot-find-' + i, 'aria-selected': 'false' },
        });
        setIcon(row.createSpan({ cls: 'ot-search-icon' }), r.icon);
        const text = row.createDiv('ot-search-text');
        text.createDiv({ text: r.title, cls: 'ot-search-title' });
        text.createDiv({ text: r.context, cls: 'ot-search-context' });
        row.onclick = () => this.choose(r);
      });
      this.index = Math.min(this.index, Math.max(0, this.results.length - 1));
      this.highlight();
      this.more.hidden = !!this.broad;
      this.status.textContent = this.results.length
        ? `${this.results.length} ${this.results.length === 1 ? 'result' : 'results'}`
        : 'No results';
    }
    highlight() {
      [...this.list.children].forEach((r, i) =>
        r.setAttribute('aria-selected', String(i === this.index)),
      );
      const row = this.list.children[this.index];
      if (row) {
        this.input.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView({ block: 'nearest' });
      } else this.input.removeAttribute('aria-activedescendant');
    }
    choose(r) {
      if (!r || this.opening) return this.opening;
      this.opening = (async () => {
        try {
          await plugin.revealSearchResult(r);
          this.close();
        } catch (error) {
          new Notice(error.message);
        } finally {
          this.opening = null;
        }
      })();
      return this.opening;
    }
    onClose() {
      this.version++;
      for (const e of this.events || []) plugin.app.workspace.offref(e);
      for (const e of this.vaultEvents || []) plugin.app.vault.offref(e);
      if (plugin.searchModal === this) plugin.searchModal = null;
      this.contentEl.empty();
    }
  }
  plugin.openSearch = async (initial = '') => {
    // A destination can render before navigation finishes. Reopening must wait
    // for the previous selection to close, rather than focus a retiring dialog.
    if (plugin.searchModal?.opening) await plugin.searchModal.opening;
    if (plugin.searchModal) {
      plugin.searchModal.input.focus();
      return;
    }
    const view = plugin.app.workspace.activeLeaf?.view;
    if (view?.taskDraft && !(await view.finishTask())) return;
    plugin.searchModal = new QuickFind(plugin.app);
    plugin.searchModal.open();
    if (initial) {
      plugin.searchModal.input.value = initial;
      plugin.searchModal.draw();
    }
  };
  plugin.revealSearchResult = async (r) => {
    if (r.kind === 'list') {
      await plugin.openList(r.page);
      return;
    }
    if (r.kind === 'project') {
      const file = plugin.app.vault.getAbstractFileByPath(r.path);
      if (!file) throw Error('This project no longer exists.');
      const leaf = plugin.mainWorkspaceLeaf();
      await leaf.openFile(file);
      plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
      return;
    }
    const records = await plugin.records(),
      task = records.find((t) => t.meta.id === r.id);
    if (!task) throw Error('This task no longer exists.');
    if (
      r.path &&
      !task.meta.deleted &&
      !require('./model.cjs').isLogged(task.meta, day(), plugin.settings.logbook)
    ) {
      const file = plugin.app.vault.getAbstractFileByPath(r.path);
      if (file) {
        const leaf = plugin.mainWorkspaceLeaf();
        await leaf.openFile(file);
        await leaf.setViewState({
          type: 'markdown',
          state: { file: r.path, mode: 'preview' },
          active: true,
        });
        const row = await new Promise((resolve) => {
          const until = Date.now() + 2000;
          const check = () => {
            const row = [
              ...leaf.view.containerEl.querySelectorAll(`[data-task-id="${CSS.escape(r.id)}"]`),
            ].find((el) => el.getBoundingClientRect().width && el.getBoundingClientRect().height);
            if (row || Date.now() >= until) resolve(row);
            else requestAnimationFrame(check);
          };
          check();
        });
        if (row) {
          row.scrollIntoView({ block: 'center' });
          row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          return;
        }
      }
    }
    const result = search(records, task.meta.title, {
      broad: true,
      today: day(),
      settings: plugin.settings,
    }).find((t) => t.id === r.id);
    await plugin.openList(task.meta.deleted ? 'trash' : result?.page || r.page);
    const view = plugin.app.workspace.activeLeaf.view;
    await view.render();
    await view.openTask(r.id);
    const row = view.contentEl.querySelector(`[data-task-id="${CSS.escape(r.id)}"]`);
    row?.scrollIntoView({ block: 'center' });
    row?.focus();
  };
  plugin.addCommand({ id: 'quick-find', name: 'Quick Find', callback: () => plugin.openSearch() });
  plugin.addRibbonIcon('things-task-search', 'Quick Find tasks', () => plugin.openSearch());
  plugin.register(() => plugin.searchModal?.close());
};
