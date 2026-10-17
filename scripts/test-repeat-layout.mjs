import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
let id;
try {
  id = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.captureModal?.close();
    return (await p.createTask({ title: `Repeat layout ${Date.now()}` })).meta.id;
  });
  for (const width of [320, 390, 1100]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((id) => app.plugins.getPlugin('thingsmd').showRepeat(id), id);
    const modal = page.locator('.ot-repeat-modal');
    await modal.waitFor();
    assert.equal(await modal.locator('input[type="date"]').count(), 0);
    for (const unit of ['week', 'month', 'year']) {
      await modal.getByLabel('Repeat unit', { exact: true }).selectOption(unit);
      const bounds = await modal.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      const overflow = await modal.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `${unit} layout fits at ${width}px`);
    }
    await modal.getByLabel('Next repeat date', { exact: true }).click();
    await modal.getByRole('button', { name: 'Next month', exact: true }).click();
    await modal.locator('.ot-calendar-day:not(.is-outside)').nth(14).click();
    await modal.locator('.ot-repeat-calendar').waitFor({ state: 'detached' });
    await modal.getByRole('button', { name: 'After Completion', exact: true }).click();
    assert.equal(await modal.getByLabel('Repeat ends', { exact: true }).count(), 0);
    await page.screenshot({ path: `artifacts/repeat-layout-${width}.png` });
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  console.log(
    'PASS: Repeat fits 320/390/1100px; weekly/monthly/yearly rules, shared calendar selection, and completion mode work.',
  );
} finally {
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = (await p.taskRecords()).find((t) => t.meta.id === id);
    if (task) await p.deleteTask(task.file);
  }, id);
  await browser.close();
}
