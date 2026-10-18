const { parseYaml, Notice } = require('obsidian');

async function taskMeta(view, plugin) {
  try {
    const text =
      view.getMode?.() === 'source' ? view.editor.getValue() : await plugin.readTask(view.file);
    return require('./markdown-document.cjs').decode(text, parseYaml).meta;
  } catch {
    return null;
  }
}

module.exports = (plugin) => {
  const entries = new Map();
  // Native headings are recycled on mode changes and navigation. Keep an
  // unresolved title draft independently of that DOM, just like task controls.
  const drafts = (plugin.taskNoteTitleDrafts = new Map());
  const showError = (entry, message) => {
    entry.title.setAttribute('aria-invalid', 'true');
    if (!entry.error) {
      entry.error = entry.title.ownerDocument.createElement('div');
      entry.error.className = 'ot-task-title-error';
      entry.error.setAttribute('role', 'alert');
      entry.native.after(entry.error);
    }
    entry.error.textContent = message;
  };
  const icons = require('./task-note-icons.cjs')();
  const controls = require('./task-note-controls.cjs')(plugin);
  let timer,
    generation = 0,
    disposed = false;
  const schedule = () => {
    if (disposed) return;
    controls.hideStale();
    for (const [native, entry] of entries)
      if (entry.view.file?.path !== entry.path) {
        remove(entry);
        entries.delete(native);
      }
    clearTimeout(timer);
    timer = setTimeout(refresh, 40);
  };
  const remove = (entry) => {
    // Removing a focused heading can synchronously blur and schedule another
    // refresh. Unregister first so that refresh cannot remove it a second time.
    entries.delete(entry.native);
    entry.native.classList.remove('ot-task-note-original-title');
    entry.wrapper.remove();
    entry.error?.remove();
  };
  const refresh = async () => {
    if (disposed) return;
    const current = ++generation;
    const live = new Set();
    const liveTabs = new Set();
    const liveControls = new Set();
    for (const { view } of plugin.app.workspace.getLeavesOfType('markdown')) {
      if (!view.file || !view.containerEl) continue;
      const path = view.file.path;
      const meta = await taskMeta(view, plugin);
      if (disposed || current !== generation) return;
      if (view.file?.path !== path) continue;
      if (meta?.type !== 'thingsmd-task') continue;
      icons.tab(view, meta, liveTabs);
      controls.update(view, meta, liveControls);
      for (const native of view.containerEl.querySelectorAll('.inline-title, .view-header-title')) {
        if (native.classList.contains('ot-task-note-title') || native.closest('.internal-embed'))
          continue;
        live.add(native);
        let entry = entries.get(native);
        if (entry && entry.path !== view.file.path) {
          remove(entry);
          entries.delete(native);
          entry = null;
        }
        if (!entry) {
          const title = native.ownerDocument.createElement('div');
          const inline = native.classList.contains('inline-title');
          title.className = `${inline ? 'inline-title' : 'view-header-title'} ot-task-note-title`;
          title.contentEditable = 'true';
          title.tabIndex = 0;
          title.setAttribute('role', 'textbox');
          title.setAttribute('aria-label', 'Task title');
          title.setAttribute('aria-multiline', 'false');
          title.setAttribute('enterkeyhint', 'done');
          title.dataset.placeholder = 'Untitled task';
          const wrapper = native.ownerDocument.createElement('div');
          wrapper.className = `ot-task-note-heading${inline ? ' is-inline' : ''}`;
          const icon = native.ownerDocument.createElement('span');
          icon.className = 'ot-task-note-heading-icon';
          icon.setAttribute('role', 'checkbox');
          icon.tabIndex = 0;
          if (inline) wrapper.append(icon);
          wrapper.append(title);
          entry = {
            native,
            view,
            title,
            wrapper,
            icon,
            path: view.file.path,
            meta,
            draft:
              drafts.get(view.file.path)?.inline === inline ? drafts.get(view.file.path) : null,
            saving: false,
          };
          entries.set(native, entry);
          if (entry.draft) {
            title.textContent = entry.draft.text;
            if (entry.draft.error) showError(entry, entry.draft.error);
          }
          const toggle = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (
              entry.view.file?.path !== entry.path ||
              entry.toggling ||
              (entry.meta.repeat && !entry.meta.repeat.next)
            )
              return;
            entry.toggling = true;
            icon.setAttribute('aria-disabled', 'true');
            try {
              const saved = await plugin.patchTask(
                { file: { path: entry.path }, meta: { ...entry.meta } },
                { status: entry.meta.status === 'done' ? 'todo' : 'done' },
              );
              for (const other of entries.values())
                if (saved && other.path === entry.path) {
                  other.meta = saved.meta;
                  icons.title(other.icon, saved.meta);
                }
            } catch (error) {
              new Notice(error.message);
            } finally {
              entry.toggling = false;
              icons.title(icon, entry.meta);
              schedule();
            }
          };
          icon.onclick = toggle;
          icon.onkeydown = (event) => {
            if (event.key === ' ' || event.key === 'Enter') void toggle(event);
          };
          const commit = async () => {
            const draft = entry.draft;
            if (!draft || entry.saving) return;
            const value = title.textContent.replace(/[\r\n]+/g, ' ').trim();
            if (value === (draft.meta.title || '')) {
              drafts.delete(entry.path);
              entry.draft = null;
              schedule();
              return;
            }
            entry.saving = true;
            title.contentEditable = 'false';
            try {
              const saved = await plugin.patchTask(
                { file: { path: entry.path }, meta: draft.meta },
                { title: value },
              );
              for (const other of entries.values())
                if (other.path === entry.path) other.meta = saved.meta;
              drafts.delete(entry.path);
              entry.draft = null;
              entry.error?.remove();
              entry.error = null;
              title.removeAttribute('aria-invalid');
            } catch (error) {
              // Keep the user's text and original snapshot for a safe retry.
              draft.error = error.message;
              if (entry.view.file?.path === entry.path) showError(entry, error.message);
              new Notice(error.message);
            } finally {
              entry.saving = false;
              title.contentEditable = 'true';
              schedule();
            }
          };
          title.oninput = () => {
            entry.draft ||= { meta: { ...entry.meta }, inline };
            entry.draft.text = title.textContent;
            drafts.set(entry.path, entry.draft);
            title.dataset.empty = String(!title.textContent.trim());
          };
          title.onfocus = () => {
            entry.draft ||= { meta: { ...entry.meta }, text: title.textContent, inline };
          };
          title.onblur = () => {
            void commit();
          };
          title.onkeydown = (event) => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              title.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              drafts.delete(entry.path);
              entry.draft = null;
              entry.error?.remove();
              entry.error = null;
              title.removeAttribute('aria-invalid');
              title.textContent = typeof entry.meta.title === 'string' ? entry.meta.title : '';
              title.blur();
              schedule();
            }
          };
          title.onpaste = (event) => {
            event.preventDefault();
            const text = event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ');
            const selection = title.ownerDocument.getSelection();
            if (!selection?.rangeCount) return;
            const range = selection.getRangeAt(0);
            if (!title.contains(range.commonAncestorContainer)) return;
            range.deleteContents();
            const node = title.ownerDocument.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            title.oninput();
          };
        }
        entry.meta = meta;
        if (
          entry.draft &&
          !drafts.has(entry.path) &&
          !entry.saving &&
          entry.title.ownerDocument.activeElement !== entry.title
        ) {
          entry.draft = null;
          entry.error?.remove();
          entry.error = null;
          entry.title.removeAttribute('aria-invalid');
        }
        icons.title(entry.icon, meta);
        if (entry.toggling) entry.icon.setAttribute('aria-disabled', 'true');
        if (!entry.draft && !entry.saving) {
          const text = typeof meta.title === 'string' ? meta.title : '';
          if (entry.title.textContent !== text) entry.title.textContent = text;
          entry.title.dataset.empty = String(!text.trim());
        }
        if (entry.title.style.cssText !== native.style.cssText)
          entry.title.style.cssText = native.style.cssText;
        native.classList.add('ot-task-note-original-title');
        entry.wrapper.hidden = native.style.display === 'none';
        if (native.previousElementSibling !== entry.wrapper) native.before(entry.wrapper);
      }
    }
    icons.sweep(liveTabs);
    controls.sweep(liveControls);
    for (const [native, entry] of entries)
      if (!live.has(native)) {
        remove(entry);
        entries.delete(native);
      }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  // Host events and DOM mutations both invalidate recycled Markdown surfaces.
  for (const event of ['layout-change', 'file-open', 'editor-change'])
    plugin.registerEvent(plugin.app.workspace.on(event, schedule));
  plugin.registerEvent(plugin.app.metadataCache.on('changed', schedule));
  plugin.registerEvent(plugin.app.workspace.on('thingsmd-tasks-changed', schedule));
  plugin.registerDomEvent(document, 'focusout', schedule);
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      controls.rename(file, oldPath);
      if (drafts.has(oldPath)) {
        drafts.set(file.path, drafts.get(oldPath));
        drafts.delete(oldPath);
      }
      for (const entry of entries.values()) if (entry.path === oldPath) entry.path = file.path;
      schedule();
    }),
  );
  plugin.register(() => {
    disposed = true;
    clearTimeout(timer);
    observer.disconnect();
    for (const entry of entries.values()) remove(entry);
    entries.clear();
    drafts.clear();
    delete plugin.taskNoteTitleDrafts;
    icons.dispose();
    controls.dispose();
  });
  plugin.app.workspace.onLayoutReady(schedule);
};
