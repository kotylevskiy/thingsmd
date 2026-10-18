const { setIcon } = require('obsidian');
const iconName = (meta) => (meta.status === 'done' ? 'square-check' : 'square');

// Match tabs within their own split by DOM order, without changing the native view.
function tabIcon(view) {
  const leaf = view.containerEl.closest('.workspace-leaf');
  const container = leaf?.parentElement;
  if (!container?.classList.contains('workspace-tab-container')) return null;
  const index = [...container.children]
    .filter((el) => el.classList.contains('workspace-leaf'))
    .indexOf(leaf);
  const headers = container.parentElement?.querySelector(
    ':scope > .workspace-tab-header-container .workspace-tab-header-container-inner',
  );
  return headers?.children[index]?.querySelector('.workspace-tab-header-inner-icon') || null;
}
module.exports = () => {
  const tabs = new Map();
  let nextId = 0;
  const restore = (el, state) => {
    // Do not overwrite a newer icon supplied by Obsidian or another plugin.
    if (el.innerHTML === state.ours) el.innerHTML = state.original;
    el.classList.remove('ot-task-note-tab-icon');
    if (state.title?.textContent === state.caption) state.title.textContent = state.originalTitle;
    if (state.header?.getAttribute('aria-labelledby') === state.labelId) {
      if (state.originalLabelledBy === null) state.header.removeAttribute('aria-labelledby');
      else state.header.setAttribute('aria-labelledby', state.originalLabelledBy);
      if (!state.header.hasAttribute('aria-label') && state.originalLabel !== null)
        state.header.setAttribute('aria-label', state.originalLabel);
    }
    if (state.title?.id === state.labelId && !state.originalId) state.title.removeAttribute('id');
  };
  return {
    title(el, meta) {
      const icon = iconName(meta);
      if (el.dataset.taskIcon !== icon) {
        setIcon(el, icon);
        el.dataset.taskIcon = icon;
      }
      el.setAttribute('aria-checked', String(meta.status === 'done'));
      el.setAttribute('aria-disabled', String(!!meta.repeat && !meta.repeat.next));
      el.setAttribute('aria-label', meta.status === 'done' ? 'Reopen task' : 'Complete task');
    },
    tab(view, meta, live) {
      const el = tabIcon(view);
      if (!el) return;
      live.add(el);
      let state = tabs.get(el);
      if (!state) {
        const header = el.closest('.workspace-tab-header');
        const title = header?.querySelector('.workspace-tab-header-inner-title');
        state = {
          original: el.innerHTML,
          ours: null,
          icon: null,
          header,
          title,
          originalTitle: title?.textContent,
          originalLabel: header?.getAttribute('aria-label'),
          originalLabelledBy: header?.getAttribute('aria-labelledby'),
          originalId: title?.id,
          labelId: title?.id || `ot-task-tab-${Date.now()}-${++nextId}`,
          caption: null,
        };
        tabs.set(el, state);
      } else if (state.ours !== el.innerHTML) state.original = el.innerHTML;
      const icon = iconName(meta);
      if (state.icon !== icon || state.ours !== el.innerHTML) {
        setIcon(el, icon);
        state.icon = icon;
        state.ours = el.innerHTML;
      }
      el.classList.add('ot-task-note-tab-icon');
      if (state.title && state.title.textContent !== state.caption)
        state.originalTitle = state.title.textContent;
      if (state.header?.hasAttribute('aria-label'))
        state.originalLabel = state.header.getAttribute('aria-label');
      state.caption =
        typeof meta.title === 'string' && meta.title.trim() ? meta.title : 'Untitled task';
      if (state.title && state.title.textContent !== state.caption)
        state.title.textContent = state.caption;
      // Obsidian turns aria-label into a hover tooltip. Label the tab through
      // its visible caption instead, preserving its accessible name.
      if (state.title && state.title.id !== state.labelId) state.title.id = state.labelId;
      if (state.header?.getAttribute('aria-labelledby') !== state.labelId)
        state.header?.setAttribute('aria-labelledby', state.labelId);
      state.header?.removeAttribute('aria-label');
    },
    sweep(live) {
      for (const [el, state] of tabs)
        if (!live.has(el)) {
          restore(el, state);
          tabs.delete(el);
        }
    },
    dispose() {
      for (const [el, state] of tabs) restore(el, state);
      tabs.clear();
    },
  };
};
