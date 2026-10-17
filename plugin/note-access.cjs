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
    return viewsFor(file).find((view) => view.getMode() === 'source');
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
        view.editor.replaceRange(
          next,
          { line: 0, ch: 0 },
          view.editor.offsetToPos(expected.length),
        );
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
module.exports = { noteAccess };
