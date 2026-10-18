import { editTaskNotes } from './edit-task-notes.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault({ settings: { enableWaiting: true } });
page.setDefaultTimeout(8000);
const prefix = `Empty title ${Date.now()}`;
const note = prefix + '.md';
let id;
try {
  id = await page.evaluate(
    async ({ prefix, note }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const task = await p.createTask({ title: prefix, when: 'anytime', is_waiting: true });
      await app.vault.create(note, `![[${task.file.path}]]\n`);
      await p.openList('waiting');
      return task.meta.id;
    },
    { prefix, note },
  );
  for (const mode of ['waiting', 'source', 'preview']) {
    await page.evaluate(
      async ({ mode, note }) => {
        const p = app.plugins.getPlugin('thingsmd');
        if (mode === 'waiting') await p.openList('waiting');
        else {
          const leaf = p.mainWorkspaceLeaf();
          await leaf.openFile(app.vault.getAbstractFileByPath(note));
          await leaf.setViewState({
            type: 'markdown',
            state: { file: note, mode, source: false },
            active: true,
          });
        }
      },
      { mode, note },
    );
    const row = page.locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]:visible`);
    await row.dblclick();
    const title = row.getByLabel('Task title', { exact: true });
    if (mode !== 'waiting') assert.equal(await title.inputValue(), '');
    await title.fill('');
    await editTaskNotes(page, 'Notes retained after clearing the title.');
    await page.waitForTimeout(400);
    const editorMarkers = await row.locator('.ot-waiting-marker').count();
    await page.locator('.workspace-leaf.mod-active .view-header-title').click();
    await row.locator('.ot-title-input').waitFor({ state: 'hidden' });
    assert.equal(editorMarkers, 0, 'Editor only shows the bottom waiting control');
    assert.equal(
      await row.locator('.ot-waiting-marker').count(),
      mode === 'waiting' ? 0 : 1,
      'Waiting For supplies its own context; native collapsed tasks retain the badge',
    );
    const saved = await page.evaluate(
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
      id,
    );
    assert.equal(saved.meta.title, '');
    assert.equal(saved.body, 'Notes retained after clearing the title.');
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
    await page
      .locator('.workspace-leaf.mod-active h1')
      .getByText('Today', { exact: true })
      .waitFor();
  }
  console.log(
    'PASS: clearing an existing title then clicking outside closes editors safely in lists, Live Preview and Reading view; empty title saved and notes retained; waiting plane appears only on collapsed rows.',
  );
} finally {
  await page.evaluate(
    async ({ id, note }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const views = app.workspace.getLeavesOfType('thingsmd-project-view');
      for (const { view } of views) {
        if (view.taskDraft) {
          view.taskDraft.values.title = 'Cleanup';
          await view.finishTask();
        }
      }
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      await p.openList('inbox');
      const task = (await p.taskRecords()).find((t) => t.meta.id === id);
      if (task) await p.deleteTask(task.file);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
    },
    { id, note },
  );
  await browser.close();
}
