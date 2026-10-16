const { Text } = require('@codemirror/state');
const { Notice } = require('obsidian');
const { mountDrag } = require('./task-drag.cjs');

// Adapt rendered Markdown sections to the same pointer drag interaction used by
// Live Preview. Source boundaries come from Obsidian's rendering context.
module.exports = function readingDrag(plugin) {
  const sections = new WeakMap();
  const previews = new Map();
  const sources = new Map();
  plugin.registerEvent(
    plugin.app.vault.on('modify', (file) => {
      for (const state of previews.values()) if (state.path === file.path) state.valid = false;
    }),
  );
  plugin.register(() => {
    for (const state of previews.values()) state.dispose();
    previews.clear();
  });
  return {
    section(element, info, path) {
      if (!info) return;
      sections.set(element, info);
      sources.set(path, info.text);
    },
    mount(root, path, lineNumber) {
      const preview = root.closest('.markdown-preview-view');
      if (!preview) return () => {};
      root.dataset.sourceLine = String(lineNumber);
      let state = previews.get(preview);
      if (!state) {
        state = { path, count: 0, text: sources.get(path), valid: true };
        state.doc = Text.of(state.text.split('\n'));
        const sectionAt = (element) => {
          while (element && element !== preview) {
            const info = sections.get(element);
            if (info) return { element, info };
            element = element.parentElement;
          }
          return null;
        };
        let lastBlock;
        const adapter = {
          dom: preview,
          contentDOM: preview.querySelector('.markdown-preview-sizer') || preview,
          scrollDOM: preview,
          get state() {
            return { doc: state.valid ? state.doc : Text.of(['']) };
          },
          get documentTop() {
            return preview.getBoundingClientRect().top;
          },
          posAtDOM: (element) => state.doc.line(Number(element.dataset.sourceLine) + 1).from,
          posAtCoords({ x, y }) {
            const section = sectionAt(preview.ownerDocument.elementFromPoint(x, y));
            if (!section) return null;
            const bounds = section.element.getBoundingClientRect();
            const after = y > (bounds.top + bounds.bottom) / 2;
            const number = (after ? section.info.lineEnd : section.info.lineStart) + 1;
            if (number < 1 || number > state.doc.lines) return null;
            lastBlock = {
              top: bounds.top - this.documentTop,
              bottom: bounds.bottom - this.documentTop,
            };
            return state.doc.line(number).from;
          },
          lineBlockAt() {
            return lastBlock;
          },
          dispatch(transaction) {
            if (!state.valid) return;
            let next = state.text;
            for (const change of [...transaction.changes].reverse())
              next =
                next.slice(0, change.from) + change.insert + next.slice(change.to ?? change.from);
            const file = plugin.app.vault.getAbstractFileByPath(path);
            if (!file) return;
            state.valid = false;
            plugin.app.vault
              .process(file, (current) => {
                if (current !== state.text)
                  throw new Error('This note changed during the drag. Please try again.');
                return next;
              })
              .catch((error) => new Notice(error.message));
          },
        };
        state.dispose = mountDrag(
          adapter,
          { scrollIntoView: () => null },
          (taskPath, destination, list) =>
            (list
              ? plugin.dropTaskOnList({ path: taskPath, sourcePath: path }, list)
              : plugin.transferTask({ path: taskPath, destination, sourcePath: path })
            ).catch((error) => new Notice(error.message)),
        );
        previews.set(preview, state);
      } else if (sources.get(path) !== state.text) {
        state.text = sources.get(path);
        state.doc = Text.of(state.text.split('\n'));
        state.valid = true;
      }
      state.count++;
      return () => {
        if (--state.count === 0) {
          state.dispose();
          previews.delete(preview);
        }
      };
    },
  };
};
