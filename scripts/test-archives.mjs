import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const note = `Archive test ${Date.now()}.md`;
let path;
let original;
const active = page.locator('.workspace-leaf.mod-active');
const openNote = async (mode) =>
  page.evaluate(
    async ({ note, mode }) => {
      const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
      await leaf.setViewState({
        type: 'markdown',
        state: { file: note, mode, source: false },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    { note, mode },
  );
const record = () =>
  page.evaluate(
    async (path) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.file.path === path),
    path,
  );
const openList = async (name) => {
  await page.locator(`.ot-list-link[data-list="${name}"]`).click();
  await active
    .locator('h1')
    .getByText(name === 'trash' ? 'Trash' : name === 'logbook' ? 'Logbook' : 'Today', {
      exact: true,
    })
    .waitFor();
};
try {
  ({ path, original } = await page.evaluate(async (note) => {
    const p = app.plugins.getPlugin('thingsmd');
    const t = await p.createTask({
      title: 'Archive verification',
      project: note,
      when: 'today',
      order: 128,
    });
    const original = `Before task.\n\n![[${t.file.path}]]\n\nAfter task.\n`;
    await app.vault.create(note, original);
    return { path: t.file.path, original };
  }, note));
  for (const [mode, key] of [
    ['source', 'Backspace'],
    ['preview', 'Delete'],
  ]) {
    await openNote(mode);
    const row = active.locator('.ot-native:not(.ot-hidden-task) .ot-task:visible');
    await row.waitFor();
    await row.click();
    await row.press(key);
    await row.waitFor({ state: 'hidden' });
    assert.equal((await record()).meta.deleted, true);
    assert.equal((await record()).meta.status, 'todo');
    assert.equal(await page.evaluate((note) => app.vault.adapter.read(note), note), original);
    await openList('today');
    assert.equal(await active.getByText('Archive verification', { exact: true }).count(), 0);
    await openList('trash');
    const trash = active.locator('.ot-task').filter({ hasText: 'Archive verification' });
    await trash.waitFor();
    await trash.getByRole('button', { name: 'Restore', exact: true }).click();
    await trash.waitFor({ state: 'hidden' });
    await openNote(mode);
    await row.waitFor();
    assert.equal((await record()).meta.order, 128);
  }
  // Text deletion edits text, never trashes the task.
  let row = active.locator('.ot-native:not(.ot-hidden-task) .ot-task:visible');
  await row.dblclick();
  const title = active.locator('.ot-title-input:visible');
  await title.fill('Archive verificationX');
  await title.press('Backspace');
  await title.press('Enter');
  assert.ok(!(await record()).meta.deleted);
  await row.locator('input[type=checkbox]').check();
  await row.locator('input[type=checkbox]:checked').waitFor();
  assert.ok((await record()).meta.completed);
  await openList('logbook');
  assert.equal(await active.getByText('Archive verification', { exact: true }).count(), 0);
  await openList('today');
  await active.getByText('Archive verification', { exact: true }).waitFor();
  // Advance the completion timestamp, exercising the next-day transition without waiting overnight.
  await page.evaluate(async (path) => {
    const p = app.plugins.getPlugin('thingsmd');
    const t = (await p.taskRecords()).find((t) => t.file.path === path);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await p.patchTask(t, { completed: yesterday.toISOString() });
  }, path);
  await active.getByText('Archive verification', { exact: true }).waitFor({ state: 'hidden' });
  await openNote('source');
  await active.locator('.ot-hidden-task').waitFor({ state: 'attached' });
  assert.equal(await active.locator('.ot-native .ot-task:visible').count(), 0);
  await openList('logbook');
  const logged = active.locator('.ot-task').filter({ hasText: 'Archive verification' });
  await logged.waitFor();
  await logged.locator('.ot-task-title').click();
  await logged.press('Delete');
  await logged.waitFor({ state: 'hidden' });
  await openList('trash');
  await active
    .locator('.ot-task')
    .filter({ hasText: 'Archive verification' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await openList('logbook');
  await logged.waitFor();
  await logged.getByRole('button', { name: 'Restore' }).click();
  await logged.waitFor({ state: 'hidden' });
  await openNote('preview');
  await active.locator('.ot-native .ot-task:visible').waitFor();
  assert.equal((await record()).meta.status, 'todo');
  assert.equal((await record()).meta.completed, null);
  assert.equal(await page.evaluate((note) => app.vault.adapter.read(note), note), original);
  console.log(
    'PASS: Backspace/Delete in Live Preview, Reading and lists; text-field safety; soft delete/restore with unchanged reference position; same-day completion; next-day logging; completed-trash restore and reopening from Logbook.',
  );
} finally {
  await page.evaluate(
    async ({ note, path }) => {
      for (const l of app.workspace.getLeavesOfType('markdown'))
        if (l.view.file?.path === note) l.detach();
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
      const p = app.plugins.getPlugin('thingsmd');
      if (path) await p.deleteTask(path);
      await p.openList('logbook');
    },
    { note, path },
  );
  await browser.close();
}
