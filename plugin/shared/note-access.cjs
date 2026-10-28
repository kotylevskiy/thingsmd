// Native CodeMirror views register through Obsidian's public editor extension API.
// This avoids native input filters and automatic caret scrolling for checked,
// programmatic writes, without reaching into private Editor implementation fields.
const editorWriters = new WeakMap();
function registerEditorWriter(editor, write) {
  editorWriters.set(editor, write);
  return () => {
    if (editorWriters.get(editor) === write) editorWriters.delete(editor);
  };
}

// Read the visible editor buffer when present; the on-disk note may lag behind.
// All callers compare the snapshot before replacing text, including rollback.
function noteAccess(app) {
  // Obsidian's save() returns early when another save is running and queues a
  // follow-up. Await that host-owned work before reading/replacing its buffer.
  const settled = async (view) => {
    const until = Date.now() + 10000;
    while (view.saving === true) {
      if (Date.now() >= until) throw new Error('This note is still saving. Please try again.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const viewsFor = (file) =>
    app.workspace
      .getLeavesOfType('markdown')
      .filter(({ view }) => view.file?.path === file.path)
      .map(({ view }) => view);
  const ready = async (file) => {
    await Promise.all(viewsFor(file).map(settled));
    // A view may have changed notes or modes while its save was finishing.
    const editors = viewsFor(file).filter((view) => view.getMode() === 'source');
    const text = editors[0]?.editor.getValue();
    if (editors.some((view) => view.editor.getValue() !== text))
      throw new Error(
        'This note has different drafts in open tabs. Resolve them before editing task controls.',
      );
    return editors[0];
  };
  return {
    read: async (file) => {
      const view = await ready(file);
      if (!view) return app.vault.read(file);
      return view.editor.getValue();
    },
    async write(file, expected, next, { save = false } = {}) {
      if (expected === next) return;
      const view = await ready(file);
      if (view) {
        if (view.editor.getValue() !== expected)
          throw new Error('This note changed. Please try again.');
        // Replace only the changed range. Replacing the whole document maps
        // the description cursor into the edit and can move the viewport when
        // a task control changes a single hidden frontmatter value.
        let from = 0;
        while (from < expected.length && from < next.length && expected[from] === next[from])
          from++;
        let to = expected.length,
          nextTo = next.length;
        while (to > from && nextTo > from && expected[to - 1] === next[nextTo - 1]) {
          to--;
          nextTo--;
        }
        const nativeWrite = editorWriters.get(view.editor);
        if (nativeWrite) nativeWrite({ from, to, insert: next.slice(from, nextTo) });
        else
          view.editor.replaceRange(
            next.slice(from, nextTo),
            view.editor.offsetToPos(from),
            view.editor.offsetToPos(to),
          );
        if (view.editor.getValue() !== next)
          throw new Error('The editor did not accept this update. Your draft has been kept.');
        if (save) {
          await view.save();
          await settled(view);
        }
      } else
        await app.vault.process(file, (current) => {
          if (current !== expected) throw new Error('This note changed. Please try again.');
          return next;
        });
    },
  };
}
module.exports = { noteAccess, registerEditorWriter };
