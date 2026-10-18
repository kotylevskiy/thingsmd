const { parseYaml, editorInfoField } = require('obsidian');
const { registerEditorWriter } = require('./note-access.cjs');
const { StateField, EditorState, EditorSelection, Prec } = require('@codemirror/state');
const { EditorView, Decoration, keymap, ViewPlugin } = require('@codemirror/view');

function frontmatter(doc) {
  const range = require('./markdown-document.cjs').frontmatter(doc.toString());
  if (!range) return null;
  try {
    return parseYaml(range.yaml)?.type === 'thingsmd-task' ? range : null;
  } catch {
    return null;
  }
}

module.exports = (plugin) => {
  const build = (state) => {
    const range = frontmatter(state.doc);
    return range
      ? Decoration.set([Decoration.replace({ block: true }).range(0, range.to)])
      : Decoration.none;
  };
  const field = StateField.define({
    create: build,
    update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => view.state.field(f)),
    ],
  });
  plugin.registerEditorExtension([
    ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          this.sync();
        }
        update() {
          this.sync();
        }
        sync() {
          const editor = this.view.state.field(editorInfoField, false)?.editor;
          if (editor === this.editor) return;
          this.unregister?.();
          this.editor = editor;
          if (editor)
            this.unregister = registerEditorWriter(editor, (changes) => {
              // This path is only used after noteAccess compares the full buffer
              // and disk snapshots. Native user-input filters must not discard a
              // trusted metadata update within Obsidian's hidden Properties range.
              this.view.dispatch({ changes, filter: false, scrollIntoView: false });
            });
        }
        destroy() {
          this.unregister?.();
        }
      },
    ),
    Prec.highest(field),
    ViewPlugin.define((view) => {
      // A newly opened native editor can start at document offset zero. Move
      // that initial caret into the description before the first keystroke.
      queueMicrotask(() => {
        if (!view.dom.isConnected) return;
        const range = frontmatter(view.state.doc);
        if (range && view.state.selection.main.from < range.body)
          view.dispatch({ selection: EditorSelection.cursor(range.body) });
      });
      return {};
    }),
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-a',
          run(view) {
            const range = frontmatter(view.state.doc);
            if (!range) return false;
            view.dispatch({ selection: EditorSelection.range(range.body, view.state.doc.length) });
            return true;
          },
        },
      ]),
    ),
    EditorState.transactionFilter.of((tr) => {
      const range = frontmatter(tr.startState.doc);
      if (!range) return tr;
      // Native programmatic metadata updates have no user-event annotation.
      // Typing/deleting at the start of the body must not damage hidden YAML.
      if (tr.docChanged && (tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
        let touches = false;
        tr.changes.iterChangedRanges((from) => {
          if (from < range.body) touches = true;
        });
        if (touches) return [];
      }
      const next = frontmatter(tr.newDoc);
      if (!next || !tr.selection || tr.selection.ranges.every((r) => r.from >= next.body))
        return tr;
      return [
        tr,
        {
          selection: EditorSelection.create(
            tr.selection.ranges.map((r) =>
              EditorSelection.range(Math.max(next.body, r.anchor), Math.max(next.body, r.head)),
            ),
            tr.selection.mainIndex,
          ),
          sequential: true,
        },
      ];
    }),
  ]);
};
