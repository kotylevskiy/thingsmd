import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
page.on('pageerror', (error) => console.log('Native refresh page error:', error.message));
const prefix = `Native refresh ${Date.now()}`;
const note = prefix + '.md';
const ids = [];
try {
  await page.evaluate(async (note) => {
    await app.vault.create(note, '');
  }, note);
  for (const mode of ['source', 'preview']) {
    const id = `refresh-${Date.now()}-${mode}`;
    ids.push(id);
    await page.evaluate(
      async ({ note, id, mode }) => {
        const file = app.vault.getAbstractFileByPath(note);
        await app.vault.modify(file, `Prose\n\n![[ThingsMD/${id}]]\n`);
        const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
        await leaf.openFile(file);
        await leaf.setViewState({
          type: 'markdown',
          state: { file: note, mode, source: false },
          active: true,
        });
      },
      { note, id, mode },
    );
    const active = page.locator('.workspace-leaf.mod-active');
    const card = active.locator(`.ot-native[data-task-path="ThingsMD/${id}.md"]:visible`);
    await card.getByText('Task file unavailable', { exact: true }).waitFor();
    await page.evaluate(
      ({ id, prefix }) => app.plugins.getPlugin('thingsmd').createTask({ title: prefix }, id),
      { id, prefix },
    );
    await card.locator(`.ot-task[data-task-id="${id}"]`).waitFor();
    if (mode === 'source') {
      await page.evaluate(() => {
        app.workspace.activeLeaf.view.editor.replaceRange('Extra prose\n', { line: 0, ch: 2 });
      });
      await card.locator(`.ot-task[data-task-id="${id}"]`).waitFor();
      await page.evaluate(
        ({ id }) => {
          app.workspace.activeLeaf.view.editor.setValue(`\`\`\`md\n![[ThingsMD/${id}]]\n\`\`\`\n`);
        },
        { id },
      );
      await card.waitFor({ state: 'hidden' });
      await page.evaluate(
        ({ id }) => {
          app.workspace.activeLeaf.view.editor.setValue(`Prose\n\n![[ThingsMD/${id}]]\n`);
        },
        { id },
      );
      await card.locator(`.ot-task[data-task-id="${id}"]`).waitFor();
    }
    await page.evaluate(
      (id) => app.plugins.getPlugin('thingsmd').deleteTask(`ThingsMD/${id}.md`),
      id,
    );
    await card.getByText('Task file unavailable', { exact: true }).waitFor();
  }
  console.log(
    'PASS: missing task placeholders refresh on file creation/deletion in Live Preview and Reading without reopening the note.',
  );
} finally {
  await page.evaluate(
    async ({ note, ids }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.openList('inbox');
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
      for (const task of await p.taskRecords())
        if (ids.includes(task.meta.id)) await p.deleteTask(task.file);
    },
    { note, ids },
  );
  await browser.close();
}
