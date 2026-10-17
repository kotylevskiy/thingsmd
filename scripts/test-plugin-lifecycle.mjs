import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
let id;
try {
  id = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = await p.createTask({ title: `Lifecycle ${Date.now()}` });
    await p.showRepeat(task.meta.id);
    await p.openUpcomingMove({ id: task.meta.id });
    return task.meta.id;
  });
  await page.locator('.ot-move-modal').waitFor();
  await page.locator('.ot-repeat-modal').waitFor();
  await page.evaluate(() => app.plugins.disablePlugin('thingsmd'));
  assert.equal(await page.locator('.ot-move-modal, .ot-repeat-modal, .ot-list-links').count(), 0);
  await page.evaluate(async () => {
    await app.plugins.enablePlugin('thingsmd');
    await app.plugins.getPlugin('thingsmd').openList('inbox');
  });
  assert.equal(await page.locator('.ot-list-links').count(), 1);
  const meta = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta,
    id,
  );
  assert.equal(meta.repeat, undefined);
  assert.equal(meta.when, undefined);
  console.log(
    'PASS: plugin unload closes Move/Repeat and removes sidebar links; reload restores exactly one sidebar and preserves the untouched task.',
  );
} finally {
  await page.evaluate(async (id) => {
    if (!app.plugins.getPlugin('thingsmd')) await app.plugins.enablePlugin('thingsmd');
    const p = app.plugins.getPlugin('thingsmd');
    const task = (await p.taskRecords()).find((t) => t.meta.id === id);
    if (task) await p.deleteTask(task.file);
  }, id);
  await browser.close();
}
