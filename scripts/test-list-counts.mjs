import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
let state,
  tasks = [];
const note = `Counter test ${Date.now()}.md`;
const badge = (key) => page.locator(`.ot-list-link[data-list="${key}"] .ot-list-count`).first();
const waitCount = async (key, count) => {
  await page.waitForFunction(
    ({ key, count }) => {
      const el = document.querySelector(`.ot-list-link[data-list="${key}"] .ot-list-count`);
      return el && Number(el.textContent) === count && el.hidden === (count === 0);
    },
    { key, count },
  );
};
try {
  state = await page.evaluate(() => ({
    dark: document.body.classList.contains('theme-dark'),
    collapsed: app.workspace.leftSplit.collapsed,
  }));
  await page.evaluate(() => app.workspace.leftSplit.expand());
  await badge('today').waitFor({ state: 'attached' });
  await page.waitForTimeout(400);
  const base = {
    inbox: Number(await badge('inbox').textContent()),
    today: Number(await badge('today').textContent()),
  };
  tasks = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const result = [];
    for (const fields of [
      {},
      { when: 'today' },
      { when: 'evening' },
      { when: 'today', status: 'done' },
    ])
      result.push(await p.createTask({ title: 'Sidebar counter fixture', ...fields }));
    await p.openList('today');
    return result;
  });
  await waitCount('inbox', base.inbox + 1);
  await waitCount('today', base.today + 2);
  assert.equal(await page.locator('.ot-list-count').count(), 2);
  // Completion counts immediately, even if the checked task remains in its list.
  await page.evaluate(async (task) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.patchTask(task, { status: 'done' });
  }, tasks[1]);
  await waitCount('today', base.today + 1);
  // Ordinary note references must remove otherwise-unassigned tasks from Inbox.
  await page.evaluate(
    async ({ note, task }) => {
      await app.vault.create(note, `![[${task.file.path}]]`);
    },
    { note, task: tasks[0] },
  );
  await waitCount('inbox', base.inbox);
  await page.evaluate(
    async (note) => app.vault.delete(app.vault.getAbstractFileByPath(note)),
    note,
  );
  await waitCount('inbox', base.inbox + 1);
  await page.mouse.move(900, 600);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.body.classList.toggle('theme-dark', theme === 'dark');
      document.body.classList.toggle('theme-light', theme === 'light');
    }, theme);
    const nav = page.locator('.ot-list-links').first();
    await nav.screenshot({ path: `artifacts/list-counts-${theme}.png` });
    const metrics = await page.evaluate(() => {
      const a = document.querySelector('.ot-list-link[data-list="today"]'),
        b = document.querySelector('.ot-list-link[data-list="anytime"]');
      const badge = a.querySelector('.ot-list-count');
      return {
        a: a.getBoundingClientRect().height,
        b: b.getBoundingClientRect().height,
        right: badge.getBoundingClientRect().right,
        edge: a.getBoundingClientRect().right,
      };
    });
    assert.equal(metrics.a, metrics.b);
    assert.ok(metrics.right <= metrics.edge);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/list-counts-mobile.png' });
  assert.equal(await badge('today').isVisible(), true);
  console.log(
    'PASS: live counters, completion, note placement/removal, zero hiding, themed badges, unchanged row heights and narrow layout.',
  );
} finally {
  await page.evaluate(
    async ({ tasks, note, state }) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const task of tasks) await p.deleteTask(task.file);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
      document.body.classList.toggle('theme-dark', state.dark);
      document.body.classList.toggle('theme-light', !state.dark);
      if (state.collapsed) app.workspace.leftSplit.collapse();
      else app.workspace.leftSplit.expand();
      await p.openList('inbox');
    },
    { tasks, note, state },
  );
  await browser.close();
}
