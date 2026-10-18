import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Capture test ${Date.now()}`;
const note = prefix + '.md';
const modal = page.locator('.ot-capture-modal');
try {
  assert.equal(
    await page.evaluate(() => {
      const plugin = app.plugins.getPlugin('thingsmd');
      plugin.capture();
      // Check before yielding to queued focus work: the host must not choose the
      // checkbox after onOpen. This previously depended on a later microtask.
      const focused =
        document.activeElement === plugin.captureModal.contentEl.querySelector('.ot-title-input');
      plugin.captureModal.close();
      return focused;
    }),
    true,
    'Capture owns initial title focus before the host can select its checkbox',
  );
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  assert.equal(await page.locator('input.ot-capture').count(), 0);
  await page.locator('.workspace-leaf.mod-active button.ot-capture').first().click();
  const title = modal.locator('.ot-title-input');
  await title.waitFor();
  await modal.getByText('Tab to edit description', { exact: true }).waitFor();
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  const notes = modal.locator('.ot-task-notes-preview');
  await notes.waitFor();
  await modal.getByRole('button', { name: 'Checklist', exact: true }).click();
  assert.equal(await notes.isVisible(), false);
  const checklistText = modal.getByLabel('Checklist text 1', { exact: true });
  await checklistText.press('Backspace');
  await notes.waitFor();
  await title.fill(prefix + ' Today');
  await modal.getByRole('button', { name: 'Deadline', exact: true }).click();
  await modal.getByLabel('Deadline date').fill('tomorrow');
  await modal.getByLabel('Deadline date').press('Enter');
  await title.focus();
  assert.equal(await modal.locator('textarea.ot-task-notes').count(), 0);
  await title.press('Tab');
  await modal.waitFor({ state: 'hidden' });
  await waitForAsync(page, () => {
    const p = app.plugins.getPlugin('thingsmd');
    return !p.taskNotesOpening && app.workspace.activeLeaf.view.getMode?.() === 'source';
  });
  await page.keyboard.type('Typed after Tab.');
  await waitForAsync(page, () =>
    app.workspace.activeLeaf.view.editor.getValue().includes('Typed after Tab.'),
  );
  await page.evaluate(() => {
    const view = app.workspace.activeLeaf.view;
    view.editor.setValue(view.editor.getValue() + '\n**Captured notes**');
  });
  await waitForAsync(
    page,
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords())
        .find((t) => t.meta.title === prefix + ' Today')
        ?.body.includes('**Captured notes**'),
    prefix,
  );

  const today = await page.evaluate(
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.title === prefix + ' Today',
      ),
    prefix,
  );
  assert.equal(today.meta.when, 'today');
  assert.ok(today.meta.deadline);
  assert.ok(today.body.includes('**Captured notes**'));
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
  // A failed creation keeps the same form and draft available for retry.
  await page.evaluate(() => {
    const p = app.plugins.getPlugin('thingsmd');
    p.capture({ when: 'today' });
    const create = p.createTask;
    p.createTask = async () => {
      p.createTask = create;
      throw new Error('Capture write regression');
    };
  });
  await title.fill(prefix + ' Retry notes');
  await modal.locator('.ot-task-notes-preview').click();
  await modal.getByRole('alert').waitFor();
  assert.equal(await title.inputValue(), prefix + ' Retry notes');
  await modal.locator('.ot-task-notes-preview').click();
  await modal.waitFor({ state: 'hidden' });
  await waitForAsync(
    page,
    async (prefix) => {
      const p = app.plugins.getPlugin('thingsmd');
      const tasks = (await p.taskRecords()).filter((t) => t.meta.title === prefix + ' Retry notes');
      return (
        !p.taskNotesOpening &&
        tasks.length === 1 &&
        app.workspace.activeLeaf.view.file?.path === tasks[0].file.path
      );
    },
    prefix,
  );
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
