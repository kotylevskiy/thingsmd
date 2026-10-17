import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
let id;
try {
  id = await page.evaluate(async () => {
    const task = await app.plugins.getPlugin('thingsmd').createTask({
      title: `Upcoming move ${Date.now()}`,
      when: 'anytime',
    });
    return task.meta.id;
  });
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(
      async ({ id, width }) => {
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.id === id);
        await p.patchTask(task, { when: 'anytime' });
        if (width === 390) {
          await p.openList('anytime');
          await p.app.workspace.activeLeaf.view.dropOnList(id, 'upcoming');
        } else await p.dropTaskOnList({ id }, 'upcoming');
      },
      { id, width },
    );
    const modal = page.locator('.ot-move-modal');
    await modal.getByLabel('When date', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        async (id) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
            .when,
        id,
      ),
      'anytime',
    );
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await page.evaluate(
      (id) => app.plugins.getPlugin('thingsmd').transferTask({ id, list: 'upcoming' }),
      id,
    );
    assert.equal(await modal.locator('input[type="date"]').count(), 0);
    let expected = '2099-06-15';
    if (width === 390) {
      await modal.getByRole('button', { name: 'Show full calendar', exact: true }).click();
      await modal.getByRole('button', { name: 'Next month', exact: true }).click();
      const day = modal.locator('.ot-calendar-day:not(.is-outside)').nth(14);
      expected = await day.getAttribute('data-date');
      await day.click();
    } else {
      await modal.getByLabel('When date', { exact: true }).fill(expected);
      await modal.getByLabel('When date', { exact: true }).press('Enter');
    }
    await modal.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(
        async (id) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
            .when,
        id,
      ),
      expected,
    );
  }
  const original = await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = (await p.taskRecords()).find((t) => t.meta.id === id);
    await p.transferTask({ id, list: 'upcoming', copy: true });
    return task.meta.when;
  }, id);
  const calendar = page.locator('.ot-move-modal');
  await calendar.getByLabel('When date', { exact: true }).fill('2099-07-01');
  await calendar.getByLabel('When date', { exact: true }).press('Enter');
  await calendar.waitFor({ state: 'hidden' });
  const copied = await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const tasks = await p.taskRecords();
    const source = tasks.find((t) => t.meta.id === id);
    const copy = tasks.find((t) => t.meta.id !== id && t.meta.title === source.meta.title);
    if (!copy) throw new Error('Upcoming paste failed to create a copy');
    const result = { original: source.meta.when, copy: copy.meta.when };
    await p.deleteTask(copy.file);
    return result;
  }, id);
  assert.equal(copied.original, original);
  assert.equal(copied.copy, '2099-07-01');
  console.log(
    'PASS: Upcoming asks for a date on desktop and mobile; cancel preserves scheduling; confirmation saves selected date.',
  );
} finally {
  try {
    if (id) {
      const removed = await page.evaluate(async (id) => {
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.id === id);
        // Hidden task files are owned by the task store, not Obsidian's indexed vault.
        if (task) await p.deleteTask(task.file);
        return !(await app.vault.adapter.exists(`.thingsmd-storage/${id}.md`));
      }, id);
      assert.equal(removed, true, 'Upcoming test removes its hidden task fixture');
    }
  } finally {
    await browser.close();
  }
}
