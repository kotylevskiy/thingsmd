import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { connectTestVault } from './obsidian-connection.mjs';
const require = createRequire(import.meta.url);
const { logbookGroups } = require('../plugin/lists/logbook-groups.cjs');
const { addDays } = require('../plugin/shared/local-date.cjs');
const { dayKey } = require('../plugin/shared/vault-time.cjs');
const prefix = `Logbook grouping ${Date.now()}`;
const now = new Date();
const today = dayKey(now, 'UTC');
// Keep three days ago in the current week regardless of when the test runs.
const weekStartsOn = (now.getUTCDay() - 3 + 7) % 7;
const { browser, page } = await connectTestVault({
  settings: { logbook: 'immediately', timeZone: 'UTC', weekStartsOn },
});
const stamps = [0, 1, 3, 6, 7, 40, 400].map((age) => `${addDays(today, -age)}T12:00:00Z`);
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
  const locale = await page.evaluate(() => new Intl.DateTimeFormat().resolvedOptions().locale);
  const expected = logbookGroups(tasks, { now, timeZone: 'UTC', locale, weekStartsOn });
  const active = page.locator('.workspace-leaf.mod-active');
  for (const group of expected) {
    const section = active.locator(`.ot-logbook-section[data-period="${group.key}"]`);
    await section
      .getByRole('heading', {
        name: `${group.title} ${group.tasks.length} ${group.tasks.length === 1 ? 'task' : 'tasks'}`,
        exact: true,
      })
      .waitFor();
    for (const task of group.tasks)
      await section.getByRole('option', { name: task.meta.title, exact: true }).waitFor();
  }
  await active.getByRole('heading', { name: 'Yesterday 1 task', exact: true }).waitFor();
  await active.getByRole('heading', { name: '3 Days Ago 1 task', exact: true }).waitFor();
  const lastWeek = active.getByRole('heading', { name: 'Last Week 2 tasks', exact: true });
  assert.deepEqual(
    await lastWeek.evaluate((heading) => {
      const count = heading.querySelector('.ot-logbook-count');
      const date = heading.closest('section').querySelector('.ot-archive-date');
      const countStyle = getComputedStyle(count);
      const dateStyle = getComputedStyle(date);
      return {
        rightAligned:
          Math.abs(count.getBoundingClientRect().right - heading.getBoundingClientRect().right) < 1,
        matchesDateStyle:
          countStyle.color === dateStyle.color && countStyle.fontSize === dateStyle.fontSize,
      };
    }),
    { rightAligned: true, matchesDateStyle: true },
  );
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
  await active
    .getByRole('heading', { name: 'Today 1 task', exact: true })
    .waitFor({ state: 'hidden' });
  const lastWeekTask = active.getByRole('option', { name: tasks[4].meta.title, exact: true });
  await lastWeekTask.getByRole('button', { name: 'Restore', exact: true }).click();
  await active.getByRole('heading', { name: 'Last Week 1 task', exact: true }).waitFor();
  console.log(
    'PASS Logbook section counts, completion-based grouping, canceled tasks, cross-section keyboard navigation and Restore',
  );
} finally {
  await page.evaluate(async (tasks) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.openList('inbox');
    for (const task of tasks) await p.deleteTask(task.file.path);
  }, tasks);
  await browser.close();
}
