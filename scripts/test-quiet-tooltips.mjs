import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
const prefix = `Quiet tooltips ${Date.now()}`;
const notes = [];
let task;
async function quiet(target) {
  await target.waitFor();
  assert.equal(await target.getAttribute('aria-label'), null);
  assert.equal(await target.getAttribute('title'), null);
  assert.ok(await target.getAttribute('aria-labelledby'));
  await target.hover();
  await page.waitForTimeout(850);
  assert.equal(await page.locator('.tooltip:visible').count(), 0);
}
try {
  task = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const t = await p.createTask(
      {
        title: prefix,
        checklist: [{ text: 'First step', done: false }],
      },
      undefined,
      'Notes for hover verification.',
    );
    await p.openList('inbox');
    return { id: t.meta.id, path: t.file.path };
  }, prefix);
  for (const mode of ['inbox', 'source', 'preview']) {
    if (mode !== 'inbox') {
      const note = `${prefix} ${mode}.md`;
      notes.push(note);
      await page.evaluate(
        async ({ note, mode, task }) => {
          const file = await app.vault.create(note, `# Fixture\n\n![[${task.path}]]\n\nContext.\n`);
          const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
          await leaf.openFile(file);
          await leaf.setViewState({
            type: 'markdown',
            state: { file: note, mode, source: false },
            active: true,
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { note, mode, task },
      );
    }
    const row = page.locator(
      `.workspace-leaf.mod-active .ot-task[data-task-id="${task.id}"]:visible`,
    );
    await row.dblclick();
    await quiet(row.getByLabel('Checklist text 1', { exact: true }));
    await quiet(row.getByRole('group', { name: 'Task notes. Press Enter to edit.', exact: true }));
    await row.getByRole('button', { name: 'When', exact: true }).click();
    const day = page.locator('.ot-date-picker .ot-calendar-day').first();
    await quiet(day);
    assert.ok(await day.getAttribute('data-quiet-label'));
    await day.press('ArrowRight');
    assert.equal(await page.locator('.ot-calendar-day:focus').count(), 1);
    await page.keyboard.press('Escape');
    await row.getByLabel('Task title', { exact: true }).press('Escape');
    console.log(`PASS quiet tooltips: ${mode}`);
  }
} finally {
  await page.keyboard.press('Escape');
  await page.evaluate(
    async ({ notes, task }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.open();
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (notes.includes(leaf.view.file?.path)) leaf.detach();
      for (const note of notes) {
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.delete(file);
      }
      if (task) await p.deleteTask(task.path);
    },
    { notes, task },
  );
  await browser.close();
}
