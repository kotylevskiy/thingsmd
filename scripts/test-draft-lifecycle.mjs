import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = `Draft lifecycle ${Date.now()}`;
const note = `${prefix}.md`;
let copyId;
const active = page.locator('.workspace-leaf.mod-active');
try {
  copyId = await page.evaluate(
    async ({ prefix, note }) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const template = await plugin.createTask({ title: `${prefix} template` });
      await plugin.repeating.configure(template, {
        mode: 'regular',
        unit: 'day',
        interval: 1,
        anchor: '2099-01-01',
        next: '2099-01-01',
        on: [],
        end: null,
        deadline: false,
        leadDays: 0,
      });
      const key = (date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const copy = await plugin.createTask({
        title: `${prefix} copy`,
        when: 'today',
        evening: key(new Date()),
        deadline: key(yesterday),
        repeatSource: template.meta.id,
      });
      await app.vault.create(note, `Before\n\n![[${copy.file.path.slice(0, -3)}]]\n\nAfter\n`);
      return copy.meta.id;
    },
    { prefix, note },
  );
  for (const mode of ['list', 'source', 'preview']) {
    await page.evaluate(
      async ({ mode, note }) => {
        const plugin = app.plugins.getPlugin('thingsmd');
        if (mode === 'list') await plugin.openList('today');
        else {
          const leaf = plugin.mainWorkspaceLeaf();
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
    const row = active.locator(`.ot-task[data-task-id="${copyId}"]:visible`).first();
    await row.dblclick();
    await row.getByRole('button', { name: 'When', exact: true }).click();
    await page
      .locator('.ot-date-picker')
      .getByRole('button', { name: 'Someday', exact: true })
      .click();
    await page.getByText('Reschedule Repeating To-Do', { exact: true }).waitFor();
    await page
      .locator('.modal')
      .filter({ hasText: 'Reschedule Repeating To-Do' })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    // Moving focus to the choice dialog may finish the card on blur. Wait for
    // that host behavior before reopening it for a subsequent ordinary edit.
    await row.evaluate(async (element) => {
      const editor =
        element.closest('.ot-native')?._thingsCard ||
        app.workspace.activeLeaf.view.taskEditorController;
      await editor.taskSave;
      await editor.taskFinish;
    });
    if (!(await row.getByLabel('Task notes', { exact: true }).count())) await row.dblclick();
    const notes = row.getByLabel('Task notes', { exact: true });
    await notes.fill(`Keep notes after cancellation in ${mode}`);
    await row.getByLabel('Task title', { exact: true }).press('Enter');
    await row.locator('.ot-title-input').waitFor({ state: 'detached' });
    const saved = await page.evaluate(
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((task) => task.meta.id === id),
      copyId,
    );
    assert.equal(saved.meta.when, 'today');
    assert.ok(saved.meta.evening);
    assert.equal(saved.meta.deadlineDeferredOn ?? null, null);
    assert.equal(saved.body, `Keep notes after cancellation in ${mode}`);
    console.log(
      `PASS repeat-date cancellation preserves Today, Evening and subsequent notes in ${mode}`,
    );
  }
  await page.evaluate(async () => {
    await app.plugins.getPlugin('thingsmd').openList('today');
    const view = app.workspace.activeLeaf.view;
    window.draftLifecycleAction = view.run(
      () =>
        new Promise((resolve) => {
          window.releaseDraftLifecycleAction = resolve;
        }),
    );
  });
  await page.waitForFunction(() => !!window.releaseDraftLifecycleAction);
  const row = active.locator(`.ot-task[data-task-id="${copyId}"]`);
  await row.dblclick();
  await row
    .getByLabel('Task notes', { exact: true })
    .fill('Keep the draft while another action finishes');
  await page.evaluate(async () => {
    window.releaseDraftLifecycleAction();
    await window.draftLifecycleAction;
    delete window.releaseDraftLifecycleAction;
    delete window.draftLifecycleAction;
  });
  assert.equal(
    await row.getByLabel('Task notes', { exact: true }).inputValue(),
    'Keep the draft while another action finishes',
  );
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.editing), true);
  await row.getByLabel('Task title', { exact: true }).press('Enter');
  await waitForAsync(
    page,
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((task) => task.meta.id === id)
        ?.body === 'Keep the draft while another action finishes',
    copyId,
  );
  console.log(
    'PASS a finishing list action preserves the newly opened editor and its durable draft',
  );
} finally {
  await page.evaluate(
    async ({ prefix, note }) => {
      window.releaseDraftLifecycleAction?.();
      await window.draftLifecycleAction;
      delete window.releaseDraftLifecycleAction;
      delete window.draftLifecycleAction;
      const plugin = app.plugins.getPlugin('thingsmd');
      for (const dialog of document.querySelectorAll('.modal .ot-repeat-actions button'))
        if (dialog.textContent === 'Cancel') dialog.click();
      const view = app.workspace.activeLeaf.view;
      await view.finishTask?.();
      await plugin.openList('inbox');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
      for (const task of await plugin.taskRecords())
        if (task.meta.title.startsWith(prefix)) await plugin.deleteTask(task.file);
    },
    { prefix, note },
  );
  await browser.close();
}
