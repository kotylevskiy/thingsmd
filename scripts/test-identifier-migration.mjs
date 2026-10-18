import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
const id = `rename-${Date.now()}`;
const project = `${id}.md`;
let taskPath;
try {
  taskPath = await page.evaluate(
    async ({ id, project }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const task = await p.createTask({ title: id }, id, '**Original notes**\n');
      const file = app.vault.getFileByPath(task.file.path);
      // Historical strings intentionally exercise the upgrade path.
      await app.vault.process(file, (text) =>
        text.replace('type: thingsmd-task', 'type: things-task'),
      );
      await app.vault.create(
        project,
        `---\ntype: things-project # retain comment\ncustom: untouched\n---\nBefore\n![[${task.file.path.slice(0, -3)}]]\nAfter\n`,
      );
      const leaf = app.workspace.getLeaf('tab');
      await leaf.setViewState({
        type: 'markdown',
        state: { file: file.path, mode: 'source' },
        active: true,
      });
      leaf.view.editor.setValue(leaf.view.editor.getValue() + '\nUnsaved draft');
      await app.plugins.disablePlugin('thingsmd');
      await app.plugins.enablePlugin('thingsmd');
      return file.path;
    },
    { id, project },
  );
  await waitForAsync(
    page,
    async (path) =>
      (await app.vault.read(app.vault.getFileByPath(path))).includes('type: thingsmd-task'),
    taskPath,
  );
  const text = await page.evaluate(
    (path) => app.vault.read(app.vault.getFileByPath(path)),
    taskPath,
  );
  assert.ok(text.endsWith('Unsaved draft'));
  const projectText = await page.evaluate(
    (path) => app.vault.read(app.vault.getFileByPath(path)),
    project,
  );
  assert.equal(
    projectText,
    `---\ntype: thingsmd-project # retain comment\ncustom: untouched\n---\nBefore\n![[${taskPath.slice(0, -3)}]]\nAfter\n`,
  );
  assert.equal(
    await page.evaluate(async () => {
      const previous = app.workspace.activeLeaf;
      const leaf = app.workspace.getLeaf('tab');
      await leaf.setViewState({
        type: 'things-project-view',
        state: { page: 'today' },
        active: true,
      });
      const type = leaf.getViewState().type;
      leaf.detach();
      // Detaching activates the previous leaf asynchronously. Finish this
      // temporary-tab check before starting the next navigation assertion.
      await app.workspace.revealLeaf(previous);
      app.workspace.setActiveLeaf(previous, { focus: true });
      return type;
    }),
    'thingsmd-project-view',
  );
  for (const mode of ['list', 'source', 'preview']) {
    await page.evaluate(
      async ({ mode, project }) => {
        const p = app.plugins.getPlugin('thingsmd');
        if (mode === 'list') await p.openList('anytime');
        else
          await p.mainWorkspaceLeaf().setViewState({
            type: 'markdown',
            state: { file: project, mode, source: false },
            active: true,
          });
      },
      { mode, project },
    );
    const host =
      mode === 'list' ? '.ot-paper' : mode === 'source' ? '.cm-content' : '.markdown-preview-view';
    await page
      .locator(`.workspace-leaf.mod-active ${host} .ot-task[data-task-id="${id}"]:visible`)
      .first()
      .waitFor();
  }
  await waitForAsync(
    page,
    (path) =>
      app.metadataCache.getFileCache(app.vault.getFileByPath(path))?.frontmatter?.type ===
      'thingsmd-task',
    taskPath,
  );
  console.log(
    'PASS: native properties migrated, unsaved body and surrounding Markdown preserved, legacy tab restores under new ID, task visible in lists/Live Preview/Reading.',
  );
} finally {
  await page.evaluate(
    async ({ id, project, taskPath }) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if ([project, taskPath].includes(leaf.view.file?.path)) leaf.detach();
      for (const task of await p.taskRecords())
        if (task.meta.id === id) await p.deleteTask(task.file);
      const note = app.vault.getFileByPath(project);
      if (note) await app.vault.delete(note);
      await p.open();
    },
    { id, project, taskPath },
  );
  await browser.close();
}
