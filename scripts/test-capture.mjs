import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Capture test ${Date.now()}`;
const note = prefix + '.md';
const modal = page.locator('.ot-capture-modal');
try {
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  assert.equal(await page.locator('input.ot-capture').count(), 0);
  await page.locator('.workspace-leaf.mod-active button.ot-capture').click();
  const title = modal.locator('.ot-title-input');
  await title.waitFor();
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  await title.fill(prefix + ' Today');
  await title.press('Tab');
  assert.equal(
    await modal.locator('.ot-task-notes').evaluate((el) => el === document.activeElement),
    true,
  );
  await modal.locator('.ot-task-notes').fill('Captured notes');
  await modal.getByRole('button', { name: 'Deadline', exact: true }).click();
  await modal.getByRole('button', { name: /^Tomorrow/ }).click();
  await title.focus();
  await title.press('Enter');
  await modal.waitFor({ state: 'hidden' });
  const today = await page.evaluate(
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.title === prefix + ' Today',
      ),
    prefix,
  );
  assert.equal(today.meta.when, 'today');
  assert.ok(today.meta.deadline);
  assert.equal(today.body, 'Captured notes');
  await page.evaluate(async (note) => {
    await app.vault.create(note, 'Capture fixture\n');
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.setViewState({
      type: 'markdown',
      state: { file: note, mode: 'source', source: false },
      active: true,
    });
  }, note);
  const before = await page.evaluate(() => app.workspace.activeLeaf.view.file.path);
  await page.locator('.side-dock-ribbon-action[aria-label="New task"]').click();
  await title.fill(prefix + ' Project');
  await title.press('Enter');
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file.path), before);
  const inbox = await page.evaluate(
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.title === prefix + ' Project',
      ),
    prefix,
  );
  assert.equal(inbox.meta.project, note);
  assert.ok(
    (await page.evaluate((note) => app.vault.adapter.read(note), note)).includes(inbox.meta.id),
    'Current-project capture inserts a real note reference',
  );
  assert.ok(!inbox.meta.when);
  const count = await page.evaluate(
    async () => (await app.plugins.getPlugin('thingsmd').taskRecords()).length,
  );
  await page.locator('.side-dock-ribbon-action[aria-label="New task"]').click();
  await title.fill(prefix + ' Discarded');
  await title.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(async () => (await app.plugins.getPlugin('thingsmd').taskRecords()).length),
    count,
  );
  await page.locator('.side-dock-ribbon-action[aria-label="New task"]').click();
  await title.fill(prefix + ' Outside');
  await page.locator('.modal-container .modal-bg').click({ position: { x: 10, y: 10 } });
  assert.equal(await modal.isVisible(), true);
  assert.equal(await title.inputValue(), prefix + ' Outside');
  assert.equal(
    await page.evaluate(async () => (await app.plugins.getPlugin('thingsmd').taskRecords()).length),
    count,
  );
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  console.log(
    'PASS: task-shaped list capture, title focus, Tab to notes, deadline, Enter save, Today destination, ribbon capture into the active project without navigation, Escape discards, and outside-click draft retention.',
  );
} finally {
  await page.evaluate(
    async ({ prefix, note }) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      await plugin.captureModal?.close();
      for (const task of await plugin.taskRecords())
        if (task.meta.title?.startsWith(prefix)) await plugin.deleteTask(task.file);
      await plugin.open();
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
    },
    { prefix, note },
  );
  await browser.close();
}
