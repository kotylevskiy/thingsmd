import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { connectTestVault } from './obsidian-connection.mjs';
const require = createRequire(import.meta.url);
const { logbookGroups } = require('../plugin/lists/logbook-groups.cjs');
const { addDays } = require('../plugin/shared/local-date.cjs');
const { dayKey } = require('../plugin/shared/vault-time.cjs');
const { browser, page } = await connectTestVault({
  settings: { logbook: 'immediately', timeZone: 'UTC' },
});
const prefix = `Logbook grouping ${Date.now()}`;
const now = new Date();
const today = dayKey(now, 'UTC');
const stamps = [0, 1, 2, 6, 7, 40, 400].map((age) => `${addDays(today, -age)}T12:00:00Z`);
let tasks = [];
try {
  tasks = await page.evaluate(
    async ({ prefix, stamps }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const result = [];
      for (const [i, completed] of stamps.entries()) {
        const t = await p.createTask({
          title: `${prefix} ${i}`,
          status: i === 3 ? 'canceled' : 'done',
          completed,
          loggedAt: new Date().toISOString(),
        });
        result.push({ file: t.file, meta: t.meta });
      }
      await p.openList('logbook');
      return result;
    },
    { prefix, stamps },
  );
  const locale = await page.evaluate(() => require('@electron/remote').app.getSystemLocale());
  const expected = logbookGroups(tasks, { now, timeZone: 'UTC', locale });
  const active = page.locator('.workspace-leaf.mod-active');
  for (const group of expected) {
    const section = active.locator(`.ot-logbook-section[data-period="${group.key}"]`);
    await section.getByRole('heading', { name: group.title, exact: true }).waitFor();
    for (const task of group.tasks)
      await section.getByRole('option', { name: task.meta.title, exact: true }).waitFor();
  }
  await active.getByRole('heading', { name: 'Last Week', exact: true }).waitFor();
  const first = active.getByRole('option', { name: tasks[0].meta.title, exact: true });
  await first.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await active
      .getByRole('option', { name: tasks[1].meta.title, exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  await first.getByRole('button', { name: 'Restore', exact: true }).click();
  await first.waitFor({ state: 'hidden' });
  console.log(
    'PASS Logbook daily/monthly sections, completion-based grouping, canceled tasks, cross-section keyboard navigation and Restore',
  );
} finally {
  await page.evaluate(async (tasks) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.openList('inbox');
    for (const task of tasks) await p.deleteTask(task.file.path);
  }, tasks);
  await browser.close();
}
