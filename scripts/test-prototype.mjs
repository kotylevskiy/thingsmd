import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';

const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = `UI ${Date.now()}`;
let path;
const note = `${prefix}.md`;
const active = page.locator('.workspace-leaf.mod-active');
try {
  path = await page.evaluate(async (title) => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = await p.createTask({ title, customMetadata: 'preserve-existing' });
    await p.open();
    return task.file.path;
  }, prefix);
  const row = active.locator(`.ot-task[aria-label="${prefix}"]`);
  await row.click();
  assert.equal(await active.locator('.ot-task-editor').count(), 0);
  await row.press('Enter');
  await active.locator('.ot-title-input').waitFor();
  assert.equal(await active.locator('.is-expanded .ot-task-title').count(), 0);
  await active.locator('.ot-task-notes').fill('Task notes preserved across lists.');
  await active.locator('.is-expanded button[aria-label="Checklist"]').click();
  await active.getByLabel('Checklist text 1', { exact: true }).fill('A small step');
  await active.locator('.is-expanded button[aria-label="When"]').click();
  await active.getByLabel('When date', { exact: true }).fill('today');
  await active.getByLabel('When date', { exact: true }).press('Enter');
  await active.locator('.ot-title-input').press('Enter');
  await page.locator('.ot-list-link[data-list="today"]').click();
  await row.dblclick();
  await active.locator('.ot-task-notes').waitFor();
  assert.equal(
    await active.locator('.ot-task-notes').inputValue(),
    'Task notes preserved across lists.',
  );
  const text = await page.evaluate((path) => app.vault.adapter.read(path), path);
  assert.match(text, /preserve-existing/);
  assert.match(text, /A small step/);
  // An external change must retain both the external text and the local draft.
  await page.evaluate(
    async (path) =>
      app.vault.adapter.write(path, (await app.vault.adapter.read(path)) + '\nExternal edit'),
    path,
  );
  await active.locator('.ot-task-notes').fill('Local draft');
  await active.getByRole('alert').waitFor();
  assert.match(await page.evaluate((path) => app.vault.adapter.read(path), path), /External edit/);
  assert.equal(await active.locator('.ot-task-notes').inputValue(), 'Local draft');
  await active.getByRole('button', { name: 'Reload task', exact: true }).click();
  // Move uses real note references, and list/file navigation shares the leaf.
  await row.click();
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:move-task'));
  await page.evaluate(async (note) => {
    await app.vault.create(note, 'Project context.\n');
  }, note);
  // Reopen after creating the note so the destination list includes it.
  await page.locator('.ot-move-modal').getByLabel('Find destination').press('Escape');
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:move-task'));
  await page.locator('.ot-move-modal').getByLabel('Find destination').fill(prefix);
  await page.locator('.ot-move-modal').getByRole('button', { name: prefix, exact: true }).click();
  await page.waitForFunction(
    async ({ note, path }) => (await app.vault.adapter.read(note)).includes(path.slice(0, -3)),
    { note, path },
  );
  const leafId = await page.evaluate(() => app.workspace.activeLeaf.id);
  await page.locator(`.nav-file-title[data-path="${note}"]`).click();
  await page.waitForFunction((note) => app.workspace.activeLeaf.view.file?.path === note, note);
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.id), leafId);
  await page.locator('.ot-list-link[data-list="inbox"]').click();
  await page.waitForFunction(() => app.workspace.activeLeaf.view.page === 'inbox');
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.id), leafId);
  console.log(
    'PASS: list selection, inline editing, checklist autosave, cross-list persistence, retained custom metadata, conflict protection, Move into a native note, and same-tab navigation.',
  );
} finally {
  await page.evaluate(
    async ({ path, note }) => {
      const p = app.plugins.getPlugin('thingsmd');
      if (path) await p.deleteTask(path);
      await p.open();
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
    },
    { path, note },
  );
  await browser.close();
}
