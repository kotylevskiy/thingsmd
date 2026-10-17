import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
let task;
const title = `Scheduling ${Date.now()}`;
const active = page.locator('.workspace-leaf.mod-active');
const row = () => active.locator(`.ot-task[data-task-id="${task.meta.id}"]`).first();
const open = (list) =>
  page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
const meta = () =>
  page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta,
    task.meta.id,
  );
async function choose(label) {
  await row().dblclick();
  await row().getByRole('button', { name: 'When', exact: true }).click();
  await page.locator('.ot-date-picker').getByRole('button', { name: label, exact: true }).click();
  await row().locator('.ot-title-input').press('Enter');
}
try {
  task = await page.evaluate(async (title) => {
    const p = app.plugins.getPlugin('thingsmd');
    const t = await p.createTask({ title, when: 'today', deadline: '2099-12-31' });
    await p.openList('today');
    return t;
  }, title);
  await choose('This Evening');
  await active.locator('.ot-evening-section').getByText(title, { exact: true }).waitFor();
  assert.equal((await meta()).deadline, '2099-12-31');
  await page.screenshot({ path: 'artifacts/this-evening.png' });
  await choose(/^Tomorrow/);
  await row().waitFor({ state: 'hidden' });
  let current = await meta();
  assert.equal(current.evening, null);
  assert.equal(current.deadline, '2099-12-31');
  await open('anytime');
  assert.equal(await row().count(), 0);
  await open('upcoming');
  await row().waitFor();
  const dates = await active
    .locator('section[data-date]')
    .evaluateAll((els) => els.map((el) => el.dataset.date));
  assert.ok(dates.length >= 7);
  for (const date of dates) {
    const section = active.locator(`section[data-date="${date}"]`);
    await section.getByRole('button', { name: '+ New task', exact: true }).click();
    const modal = page.locator('.ot-capture-modal');
    const input = modal.getByLabel('Task title', { exact: true });
    await input.fill(title + ' capture ' + date);
    await input.press('Enter');
    await modal.waitFor({ state: 'hidden' });
    await section.getByText(title + ' capture ' + date, { exact: true }).waitFor();
    const saved = await page.evaluate(
      async (title) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.title === title),
      title + ' capture ' + date,
    );
    assert.equal(saved.meta.when, date);
    assert.equal(saved.meta.deadline, null);
  }
  await page.screenshot({ path: 'artifacts/upcoming-capture.png' });
  const target = active.locator(`section[data-date="${dates[2]}"] .ot-drop-end`);
  await row().dragTo(target);
  await waitForAsync(
    page,
    async ({ id, when }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
        .when === when,
    { id: task.meta.id, when: dates[2] },
  );
  assert.equal((await meta()).deadline, '2099-12-31');
  await choose('Clear schedule');
  await open('anytime');
  await row().waitFor();
  current = await meta();
  assert.equal(current.when, 'anytime');
  assert.equal(current.deadline, '2099-12-31');
  await open('inbox');
  assert.equal(await row().count(), 0);
  await open('anytime');
  await choose('This Evening');
  await open('today');
  await active.locator('.ot-evening-section').getByText(title, { exact: true }).waitFor();
  await choose(/^Today/);
  await page.waitForFunction((id) => {
    const row = document.querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`);
    return row && !row.closest('.ot-evening-section');
  }, task.meta.id);
  console.log(
    'PASS: Evening section, reschedule Today to future, clear to Anytime, independent deadline preserved, drag to an Upcoming day, and capture with the correct preset date in every displayed day.',
  );
} finally {
  await page.evaluate(
    async ({ task, title }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.captureModal?.close();
      if (task) await p.deleteTask(task.file.path);
      for (const t of await p.taskRecords())
        if (t.meta.title.startsWith(title + ' capture ')) await p.deleteTask(t.file.path);
      await p.openList('upcoming');
    },
    { task, title },
  );
  await browser.close();
}
