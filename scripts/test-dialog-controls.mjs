import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Dialog audit ${Date.now()}`;
const viewport =
  page.viewportSize() || (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
let collapsed;
try {
  collapsed = await page.evaluate(() => app.workspace.leftSplit.collapsed);
  await page.evaluate(() => {
    app.workspace.leftSplit.collapse();
    return app.plugins.getPlugin('thingsmd').openList('inbox');
  });
  for (const size of [
    { width: 390, height: 844 },
    { width: 800, height: 500 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('.workspace-leaf.mod-active button.ot-capture').click();
    const card = page.locator('.ot-capture-modal');
    await card.getByLabel('Task title', { exact: true }).fill(prefix + ' ' + size.width);
    await card.getByRole('button', { name: 'Checklist', exact: true }).click();
    await card.getByLabel('Checklist text 1', { exact: true }).fill('First');
    await card.getByRole('button', { name: 'Checklist', exact: true }).click();
    assert.equal(
      await card
        .getByLabel('Checklist text 2', { exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await card.getByLabel('Checklist text 2', { exact: true }).press('Backspace');
    await card.getByLabel('Checklist item 1', { exact: true }).check();
    await card.getByRole('button', { name: 'When', exact: true }).click();
    const picker = page.locator('.ot-date-picker');
    await picker.waitFor();
    await picker.evaluate(
      (el) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const bounds = await picker.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= size.width &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= size.height,
      JSON.stringify(bounds),
    );
    await page.screenshot({ path: `artifacts/calendar-controls-${size.width}.png` });
    await picker.getByLabel('When date').press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await picker.waitFor({ state: 'detached' });
    await card.getByRole('button', { name: 'Deadline', exact: true }).click();
    await picker.getByLabel('Deadline date').fill('24.10.2099');
    await picker.locator('.ot-date-match').click();
    await page.screenshot({ path: `artifacts/capture-controls-${size.width}.png` });
    await card.getByLabel('Task title', { exact: true }).press('Enter');
    await card.waitFor({ state: 'hidden' });
    console.log('PASS capture and calendar controls:', size);
  }
  await page.setViewportSize(viewport);
  const id = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const t = await p.createTask({ title: prefix + ' repeat' });
    await p.openList('inbox');
    return t.meta.id;
  }, prefix);
  const row = page.locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`);
  await row.dblclick();
  await row.getByRole('button', { name: 'Repeat', exact: true }).click();
  const modal = page.locator('.ot-repeat-modal');
  await modal.getByLabel('Next repeat date', { exact: true }).fill('2099-01-01');
  for (const unit of ['day', 'week', 'month', 'year']) {
    await modal.getByLabel('Repeat unit', { exact: true }).selectOption(unit);
    await modal.getByLabel('Repeat interval', { exact: true }).fill('2');
    if (unit !== 'day') {
      await modal.getByRole('button', { name: '+ Add day', exact: true }).click();
      await modal.getByLabel('Remove repeat day 2', { exact: true }).click();
      if (unit === 'year') await modal.getByLabel('Month 1', { exact: true }).selectOption('2');
      if (unit !== 'week') {
        await modal.getByLabel('Day of month 1', { exact: true }).selectOption('-1');
        await modal.getByLabel('Day pattern 1', { exact: true }).selectOption('ordinal');
        await modal.getByLabel('Week position 1', { exact: true }).selectOption('-1');
      }
      await modal.getByLabel('Weekday 1', { exact: true }).selectOption('5');
    }
    assert.ok((await modal.locator('.ot-repeat-preview').innerText()).includes('2099'));
  }
  await modal.getByRole('button', { name: 'After Completion', exact: true }).click();
  assert.equal(await modal.getByLabel('Repeat ends', { exact: true }).count(), 0);
  await modal.getByRole('button', { name: 'Regularly', exact: true }).click();
  await modal.getByLabel('Repeat ends', { exact: true }).selectOption('date');
  await modal.getByLabel('Repeat end date', { exact: true }).fill('2100-01-01');
  await modal.getByLabel('Repeat ends', { exact: true }).selectOption('never');
  await modal.getByLabel('Add deadlines', { exact: true }).check();
  await modal.getByLabel('Days earlier', { exact: true }).fill('3');
  await modal.getByLabel('Add deadlines', { exact: true }).uncheck();
  await modal.getByLabel('Repeat interval', { exact: true }).fill('0');
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  assert.equal(await modal.locator('[role=alert]').count(), 1);
  await modal.getByLabel('Repeat interval', { exact: true }).fill('2');
  assert.equal(await modal.locator('[role=alert]').count(), 0);
  await page.screenshot({ path: 'artifacts/repeat-controls.png' });
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const rule = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
        .repeat,
    id,
  );
  assert.equal(rule.interval, 2);
  assert.equal(rule.unit, 'year');
  assert.equal(rule.on[0].ordinal, -1);
  assert.equal(rule.on[0].weekday, 5);
  console.log(
    'PASS repeat dialog: all units, patterns, add/remove days, modes, end controls, deadline toggle, validation and save.',
  );
} finally {
  await page.keyboard.press('Escape');
  await page.setViewportSize(viewport);
  await page.evaluate(
    async ({ prefix, collapsed }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.captureModal?.close();
      await p.openList('inbox');
      for (const t of await p.taskRecords())
        if (t.meta.title?.startsWith(prefix)) await p.deleteTask(t.file.path);
      if (!collapsed) app.workspace.leftSplit.expand();
    },
    { prefix, collapsed },
  );
  await browser.close();
}
