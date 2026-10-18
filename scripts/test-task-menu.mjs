import { editTaskNotes } from './edit-task-notes.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const title = `Menu ${Date.now()}`,
  a = title + ' A.md',
  b = title + ' B.md';
let id;
const active = page.locator('.workspace-leaf.mod-active');
const row = () => active.locator(`.ot-task[data-task-id="${id}"]:visible`);
const modal = () => page.locator('.ot-move-modal');
const menuItem = (name) => page.locator('.menu').getByText(name, { exact: true });
const dateDialog = () => page.locator('.ot-task-date-modal');
async function openDate(kind) {
  await row().click({ button: 'right' });
  await menuItem(`${kind}…`).click();
  await dateDialog().waitFor();
  return dateDialog().getByLabel(`${kind} date`, { exact: true });
}
async function chooseDate(kind, value) {
  const input = await openDate(kind);
  if (!(await input.isVisible())) await dateDialog().getByLabel('Search dates').click();
  await input.fill(value);
  await input.press('Enter');
  await dateDialog().waitFor({ state: 'detached' });
}

const waitMeta = (patch) =>
  waitForAsync(
    page,
    async ({ id, patch }) => {
      const t = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.id === id,
      );
      return Object.entries(patch).every(([k, v]) => t.meta[k] === v);
    },
    { id, patch },
  );
const oldViewport =
  page.viewportSize() || (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
let sidebarCollapsed;
try {
  sidebarCollapsed = await page.evaluate(() => app.workspace.leftSplit.collapsed);
  id = await page.evaluate(
    async ({ title, a, b }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await app.vault.create(a, 'Before A\nAfter A\n');
      await app.vault.create(b, 'Before B\nAfter B\n');
      const t = await p.createTask({ title });
      await p.open();
      return t.meta.id;
    },
    { title, a, b },
  );
  await openDate('When');
  await dateDialog().getByRole('button', { name: 'Cancel date selection', exact: true }).click();
  await dateDialog().waitFor({ state: 'detached' });
  await waitMeta({ title });
  await chooseDate('Deadline', '2099-06-02');
  await waitMeta({ deadline: '2099-06-02' });
  await openDate('Deadline');
  await dateDialog().getByRole('button', { name: 'Remove deadline', exact: true }).click();
  await dateDialog().waitFor({ state: 'detached' });
  await waitMeta({ deadline: null });
  await row().click({ button: 'right' });
  await menuItem('Move…').click();
  await modal().getByRole('button', { name: 'Inbox', exact: true }).waitFor();
  assert.equal(await modal().locator('.ot-move-current').count(), 0);
  await page.screenshot({ path: 'artifacts/task-move-desktop.png' });
  await modal().getByLabel('Find destination').fill(a.slice(0, -3));
  await modal().getByLabel('Find destination').press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitMeta({ project: a });
  await page.evaluate(async (a) => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.setViewState({
      type: 'markdown',
      state: { file: a, mode: 'source', source: false },
      active: true,
    });
    app.workspace.leftSplit.collapse();
  }, a);
  await page.setViewportSize({ width: 390, height: 844 });
  const when = await openDate('When');
  await when.fill('2026-02-31');
  await when.press('Enter');
  assert.equal(await when.getAttribute('aria-invalid'), 'true');
  const bounds = await dateDialog().boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Date dialog fits phone width');
  await when.fill('2099-05-15');
  await when.press('Enter');
  await dateDialog().waitFor({ state: 'detached' });
  await waitMeta({ when: '2099-05-15' });
  await openDate('When');
  await dateDialog().getByRole('button', { name: 'Clear schedule', exact: true }).click();
  await dateDialog().waitFor({ state: 'detached' });
  await waitMeta({ when: 'anytime', project: a });
  await row().dblclick();
  await editTaskNotes(page, 'Keep this draft when moving.');
  await row().getByRole('button', { name: 'Move', exact: true }).click();
  await modal().getByRole('button', { name: 'Inbox', exact: true }).waitFor();
  assert.equal(await modal().locator('.ot-move-current').count(), 1);
  await page.screenshot({ path: 'artifacts/task-move-mobile-list.png' });
  await modal().getByLabel('Find destination').fill(b.slice(0, -3));
  const box = await modal().boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'Move dialog fits phone width');
  await page.screenshot({ path: 'artifacts/task-move-mobile-width.png' });
  await modal()
    .getByRole('button', { name: b.slice(0, -3), exact: true })
    .click();
  await waitMeta({ project: b });
  await modal().waitFor({ state: 'detached' });
  const state = await page.evaluate(
    async ({ id, a, b }) => {
      const p = app.plugins.getPlugin('thingsmd');
      return {
        a: app.workspace.activeLeaf.view.editor.getValue(),
        aDisk: await app.vault.adapter.read(a),
        b: await app.vault.read(app.vault.getAbstractFileByPath(b)),
        task: (await p.taskRecords()).find((t) => t.meta.id === id),
      };
    },
    { id, a, b },
  );
  assert.equal(state.a, 'Before A\nAfter A\n');
  assert.equal(state.aDisk, state.a, 'Source editor and saved file agree after moving');
  assert.ok(state.b.includes(id));
  assert.equal(state.task.body, 'Keep this draft when moving.');
  await page.evaluate(async (b) => {
    await app.workspace.activeLeaf.setViewState({
      type: 'markdown',
      state: { file: b, mode: 'preview' },
      active: true,
    });
  }, b);
  await page.evaluate(() => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const original = plugin.patchTask;
    window.menuDateRetry = { plugin, original, fail: true };
    plugin.patchTask = async function (...args) {
      if (window.menuDateRetry.fail && Object.hasOwn(args[1], 'deadline')) {
        window.menuDateRetry.fail = false;
        throw Error('Simulated scheduling save failure');
      }
      return original.apply(this, args);
    };
  });
  const deadline = await openDate('Deadline');
  await deadline.fill('2099-06-02');
  await deadline.press('Enter');
  await dateDialog().getByRole('alert').getByText('Simulated scheduling save failure').waitFor();
  await deadline.press('Enter');
  await dateDialog().waitFor({ state: 'detached' });
  await waitMeta({ deadline: '2099-06-02' });
  await page.evaluate(() => {
    const retry = window.menuDateRetry;
    retry.plugin.patchTask = retry.original;
    delete window.menuDateRetry;
  });
  const conflict = await openDate('Deadline');
  await page.evaluate(async (id) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const task = (await plugin.taskRecords()).find((task) => task.meta.id === id);
    await plugin.patchTask(task, { deadline: '2099-06-03' });
  }, id);
  await conflict.fill('2099-06-04');
  await conflict.press('Enter');
  await dateDialog().getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
  await waitMeta({ deadline: '2099-06-03' });
  await dateDialog().getByRole('button', { name: 'Cancel date selection', exact: true }).click();
  await dateDialog().waitFor({ state: 'detached' });
  await row().click({ button: 'right' });
  await menuItem('Move…').click();
  await modal().getByRole('button', { name: 'Someday', exact: true }).click();
  await waitMeta({ when: 'someday' });
  await row().click({ button: 'right' });
  await menuItem('Move…').click();
  await modal().getByRole('button', { name: 'Upcoming', exact: true }).click();
  await modal().getByLabel('When date', { exact: true }).fill('2099-05-15');
  await modal().getByLabel('When date', { exact: true }).press('Enter');
  await waitMeta({ when: '2099-05-15' });
  await row().click({ button: 'right' });
  await menuItem('Today').click();
  await waitMeta({ when: 'today' });
  await row().locator('.ot-today-marker').waitFor();
  await row().click({ button: 'right' });
  await menuItem('Move to Trash').click();
  await waitMeta({ deleted: true });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('trash'));
  await row().click({ button: 'right' });
  await menuItem('Restore').click();
  await waitMeta({ deleted: null });
  console.log(
    'PASS: right-click menu, searchable Move, saved drafts, cross-note moves with sidebar hidden at phone width, Reading view menu, Someday/Upcoming/Today, Trash and Restore.',
  );
} finally {
  await page.setViewportSize(oldViewport);
  await page.evaluate(
    async ({ id, a, b, sidebarCollapsed }) => {
      const p = app.plugins.getPlugin('thingsmd');
      if (window.menuDateRetry) {
        const retry = window.menuDateRetry;
        retry.plugin.patchTask = retry.original;
        delete window.menuDateRetry;
      }
      await p.open();
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if ([a, b].includes(leaf.view.file?.path)) leaf.detach();
      for (const path of [a, b]) {
        const f = app.vault.getAbstractFileByPath(path);
        if (f) await app.vault.delete(f);
      }
      if (id) await p.deleteTask('ThingsMD/' + id + '.md');
      if (!sidebarCollapsed) app.workspace.leftSplit.expand();
    },
    { id, a, b, sidebarCollapsed },
  );
  await browser.close();
}
