const TaskEditor = require('./task-editor.cjs');
const { Notice } = require('obsidian');
const { deferTouchRender } = require('./touch-tasks.cjs');

// Share the task form's controls with native Markdown views. Keep failed drafts
// across mode switches/navigation, so reopening the note offers a safe retry.
module.exports = (plugin) => {
  const entries = new Set();
  plugin.taskNoteControllers = new Set();
  // Removing focused DOM can synchronously trigger a host navigation/blur event.
  // Keep detachment reentrant so the second event cannot remove the same node.
  const detach = (entry) => {
    if (entry.detaching) return;
    entry.detaching = true;
    try {
      entry.root.remove();
    } finally {
      entry.detaching = false;
    }
  };
  const remove = (entry) => {
    entries.delete(entry);
    clearTimeout(entry.card.saveTimer);
    entry.card.cancelChecklistDrag?.();
    detach(entry);
    plugin.taskNoteControllers.delete(entry.card);
  };
  const render = (entry, meta) => {
    const { root, card, path } = entry;
    if (deferTouchRender(root)) return;
    const focused = root.contains(root.ownerDocument.activeElement)
      ? root.ownerDocument.activeElement.dataset.quietLabel ||
        root.ownerDocument.activeElement.getAttribute('aria-label')
      : null;
    clearTimeout(card.saveTimer);
    card.cancelChecklistDrag?.();
    root.empty();
    const row = root.createDiv({
      cls: 'ot-task is-expanded',
      attr: { 'data-task-id': meta.id },
    });
    // The native heading owns title/completion; this host uses only the shared
    // form's checklist, badges, popovers and action controls.
    const line = row.createDiv('ot-task-line');
    line.hidden = true;
    card.taskEditor(
      row,
      line,
      { file: { path }, meta, body: '' },
      {
        nativeDescription: true,
        fallbackFocus: {
          focus: () => entry.view.containerEl.querySelector('.ot-task-note-title')?.focus(),
        },
      },
    );
    const footer = root.querySelector('.ot-card-footer');
    footer.prepend(footer.querySelector('.ot-card-icons'));
    card.finishTask = () => card.flushTaskDraft();
    card.openNotes = async () => entry.view.editor?.focus();
    entry.structure = JSON.stringify([meta.repeat ?? null, meta.repeatSource ?? null]);
    if (focused)
      [...root.querySelectorAll('[aria-label], [data-quiet-label]')]
        .find((el) => (el.dataset.quietLabel || el.getAttribute('aria-label')) === focused)
        ?.focus({ preventScroll: true });
  };
  return {
    hideStale() {
      for (const entry of entries) if (entry.view.file?.path !== entry.path) detach(entry);
    },
    update(view, meta, live) {
      let entry = [...entries].find((e) => e.view === view && e.path === view.file.path);
      const parent = view.containerEl.querySelector(
        view.getMode() === 'source'
          ? '.markdown-source-view .cm-sizer'
          : '.markdown-preview-view .markdown-preview-sizer',
      );
      if (!parent) {
        if (entry) live.add(entry);
        return;
      }
      const native = [...parent.querySelectorAll('.inline-title')].find(
        (el) =>
          el.classList.contains('inline-title') && !el.classList.contains('ot-task-note-title'),
      );
      if (!native) {
        if (entry) live.add(entry);
        return;
      }
      if (!entry) {
        entry = [...entries].find((e) => e.path === view.file.path && !e.root.isConnected);
        if (entry) entry.view = view;
      }
      if (!entry) {
        const root = parent.ownerDocument.createElement('div');
        root.className = 'ot-root ot-task-note-controls';
        root.contentEditable = 'false';
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', 'Task controls');
        entry = { root, view, path: view.file.path };
        const card = (entry.card = new TaskEditor(plugin, root, () => {
          plugin.tasksChanged();
        }));
        root._thingsmdCard = card;
        // Guard the interval between a host file switch and its render events.
        for (const type of [
          'pointerdown',
          'mousedown',
          'click',
          'dblclick',
          'keydown',
          'input',
          'change',
        ])
          root.addEventListener(
            type,
            (event) => {
              if (entry.view.file?.path === entry.path) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              detach(entry);
            },
            true,
          );
        for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown'])
          root.addEventListener(type, (event) => event.stopPropagation());
        entries.add(entry);
        plugin.taskNoteControllers.add(card);
        render(entry, meta);
      }
      live.add(entry);
      entry.suspended = false;
      const { root, card } = entry;
      card.refreshSettings();
      const busy =
        card.taskSave ||
        card.taskDraft?.dirty ||
        card.taskDraft?.error ||
        (root.contains(root.ownerDocument.activeElement) &&
          root.ownerDocument.activeElement.matches(
            'input, textarea, select, [contenteditable=true]',
          )) ||
        root.querySelector('.ot-popover');
      if (!card.taskDraft) render(entry, meta);
      else if (!busy) {
        // A command may restore the previous metadata between host refreshes.
        // Compare the live draft, not a cached render signature.
        const draft = card.taskDraft;
        const sameValues = Object.entries(draft.values).every(
          ([key, value]) =>
            JSON.stringify(value) ===
            JSON.stringify(
              meta[key] ?? (key === 'is_waiting' ? false : Array.isArray(value) ? [] : null),
            ),
        );
        const sameStructure =
          entry.structure === JSON.stringify([meta.repeat ?? null, meta.repeatSource ?? null]);
        if (sameValues && sameStructure) {
          // The shared controls already reflect this save. Replacing their DOM
          // would disturb native scroll anchoring and the focused button.
          draft.task.meta = meta;
        } else render(entry, meta);
      }
      if (native.nextElementSibling !== root) native.after(root);
      view.containerEl.classList.add('ot-task-note-view');
    },
    sweep(live) {
      for (const entry of entries) {
        if (live.has(entry)) continue;
        detach(entry);
        if (![...live].some((other) => other.view === entry.view))
          entry.view.containerEl.classList.remove('ot-task-note-view');
        const draft = entry.card.taskDraft;
        if (draft?.dirty || draft?.error || entry.card.taskSave) {
          if (!entry.flushing && !entry.suspended) {
            entry.suspended = true;
            entry.flushing = true;
            entry.card
              .flushTaskDraft()
              .then((ok) => {
                if (!ok)
                  new Notice(
                    'Task controls could not be saved. Reopen the task note to recover your draft.',
                  );
              })
              .finally(() => {
                entry.flushing = false;
              });
          }
        } else remove(entry);
      }
    },
    rename(file, oldPath) {
      for (const entry of entries)
        if (entry.path === oldPath) {
          entry.path = file.path;
          if (entry.card.taskDraft) entry.card.taskDraft.task.file.path = file.path;
        }
    },
    dispose() {
      for (const entry of entries) {
        entry.view.containerEl.classList.remove('ot-task-note-view');
        if (entry.card.taskDraft?.dirty) void entry.card.flushTaskDraft();
        remove(entry);
      }
      delete plugin.taskNoteControllers;
    },
  };
};
