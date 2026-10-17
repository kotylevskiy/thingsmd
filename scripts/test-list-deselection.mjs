import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
let task;
try {
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('thingsmd');
    await app.plugins.enablePlugin('thingsmd');
  });
  task = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = await p.createTask({
      title: 'Deselection regression',
      when: '2099-05-01',
      deadline: '2099-05-03',
    });
    await p.openList('upcoming');
    return task;
  });
  const active = page.locator('.workspace-leaf.mod-active');
  const rows = active.locator(`.ot-task[data-task-id="${task.meta.id}"]`);
  await rows.first().waitFor();
  for (const method of ['background', 'Escape', 'touch']) {
    await rows.first().locator('.ot-task-title').click();
    assert.equal(await rows.first().getAttribute('aria-selected'), 'true');
    if (method === 'Escape') await page.keyboard.press('Escape');
    else if (method === 'touch')
      await active
        .locator('h1')
        .dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
    else await active.locator('h1').click();
    assert.equal(await active.locator('.ot-task.is-selected').count(), 0);
    assert.equal(await rows.first().getAttribute('aria-selected'), 'false');
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf().view.render());
    assert.equal(await active.locator('.ot-task.is-selected').count(), 0);
  }
  await rows.first().dblclick();
  const editor = rows.first().getByLabel('Task title', { exact: true });
  await editor.waitFor();
  await editor.fill('Deselection persisted edit');
  await active.locator('h1').click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal(await active.locator('.ot-task.is-selected').count(), 0);
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
          .title,
      task.meta.id,
    ),
    'Deselection persisted edit',
  );
  console.log(
    'PASS: mouse, touch pointer and Escape clear Upcoming selection across rerenders; outside editor click saves and clears selection.',
  );
} finally {
  try {
    if (task)
      await page.evaluate(async (id) => {
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.id === id);
        if (task) await p.deleteTask(task.file);
      }, task.meta.id);
  } finally {
    await browser.close();
  }
}
