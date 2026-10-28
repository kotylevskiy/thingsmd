const { quietLabel } = require('../shared/quiet-label.cjs');
const { Component, MarkdownRenderer, Notice } = require('obsidian');
const { WriteQueue } = require('../shared/write-queue.cjs');
module.exports = (plugin) => {
  const navigation = new WriteQueue(),
    pending = new Map();
  plugin.openTaskNotes = async (task, newTab = false) => {
    const tab = newTab || plugin.settings.taskNotesTab !== 'current';
    const key = JSON.stringify([task.file.path, tab]);
    if (pending.has(key)) return pending.get(key);
    // Coalesce repeated activation of one task, but never drop another task's
    // request. Navigation shares one workspace and must finish in request order.
    const opening = navigation.run('workspace', async () => {
      const file = plugin.app.vault.getAbstractFileByPath(task.file.path);
      if (!file || file.extension !== 'md') throw new Error('Task note is unavailable.');
      const leaf = tab ? plugin.app.workspace.getLeaf('tab') : plugin.mainWorkspaceLeaf();
      await leaf.loadIfDeferred?.();
      // Open once, directly in editing mode. A second open/mode switch can
      // replace text typed while the tab is loading. Preserve an existing editor.
      if (leaf.view.file?.path !== file.path || leaf.view.getMode?.() !== 'source')
        await leaf.setViewState({
          type: 'markdown',
          state: { file: file.path, mode: 'source' },
          active: true,
        });
      await plugin.app.workspace.revealLeaf(leaf);
    });
    pending.set(key, opening);
    plugin.taskNotesOpening = opening;
    try {
      await opening;
    } finally {
      pending.delete(key);
      if (plugin.taskNotesOpening === opening) plugin.taskNotesOpening = null;
    }
  };
  plugin.renderTaskNotes = (editor, fields, task, title) => {
    const preview = fields.createDiv({
      cls: 'ot-task-notes-preview markdown-rendered',
      attr: {
        tabindex: '0',
        role: 'group',
      },
    });
    quietLabel(preview, 'Task notes. Press Enter to edit.');
    const owner = plugin.addChild(new Component());
    const dispose = () => {
      observer.disconnect();
      plugin.removeChild(owner);
    };
    const observer = new MutationObserver(() => {
      if (!preview.isConnected) dispose();
    });
    observer.observe(fields.ownerDocument.body, { childList: true, subtree: true });
    owner.register(() => observer.disconnect());
    const resize = new ResizeObserver(() => editor.measure?.());
    resize.observe(preview);
    owner.register(() => resize.disconnect());
    let disposed = false,
      version = 0,
      renderOwner;
    owner.register(() => {
      disposed = true;
      version++;
    });
    let opening = false;
    const open = async (newTab = false) => {
      if (opening) return;
      opening = true;
      try {
        await editor.openNotes(task, newTab);
      } catch (error) {
        new Notice(error.message);
      } finally {
        opening = false;
      }
    };
    owner.registerDomEvent(title, 'keydown', (e) => {
      if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.isComposing)
        return;
      e.preventDefault();
      e.stopPropagation();
      open();
    });
    // Focus can be restored by Obsidian when returning to a tab. Only an
    // explicit click, Enter, or Tab from the title should navigate away.
    preview.onclick = (e) => {
      const link = e.target.closest('a.internal-link');
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        plugin.app.workspace.openLinkText(
          link.dataset.href || link.getAttribute('href'),
          task.file?.path || `${plugin.settings.tasksFolder}/`,
          e.metaKey || e.ctrlKey,
        );
        return;
      }
      if (e.target.closest('a,button,input,audio,video')) return;
      const selection = fields.ownerDocument.getSelection();
      if (selection?.toString() && preview.contains(selection.anchorNode)) return;
      open(e.metaKey || e.ctrlKey);
    };
    preview.onkeydown = (e) => {
      // Links and media keep their own keyboard activation.
      if (e.key === 'Enter' && e.target === preview) {
        e.preventDefault();
        e.stopPropagation();
        open(e.metaKey || e.ctrlKey);
      }
    };
    const render = async () => {
      const current = ++version;
      const text = task.file ? await plugin.readTask(task.file) : task.body || '';
      const range = require('../shared/markdown-document.cjs').frontmatter(text);
      const body = range ? text.slice(range.body) : text;
      if (disposed || current !== version) return;
      if (renderOwner) owner.removeChild(renderOwner);
      const child = (renderOwner = owner.addChild(new Component()));
      const output = document.createElement('div');
      output.className = 'ot-task-notes-render';
      if (!body.trim()) output.createSpan({ cls: 'ot-task-notes-placeholder', text: 'Notes' });
      else
        await MarkdownRenderer.render(
          plugin.app,
          body,
          output,
          task.file?.path || `${plugin.settings.tasksFolder}/`,
          child,
        );
      if (disposed || current !== version) return;
      for (const checkbox of output.querySelectorAll('input[type="checkbox"]'))
        checkbox.disabled = true;
      preview.replaceChildren(output);
    };
    const refresh = () =>
      render().catch((error) => {
        if (!disposed && preview.isConnected) new Notice(error.message);
      });
    owner.registerEvent(
      plugin.app.vault.on('modify', (file) => {
        if (file.path === task.file?.path) refresh();
      }),
    );
    refresh();
    return preview;
  };
};
