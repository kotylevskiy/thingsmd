import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = 'QuickFind ' + Date.now();
let state;
const modal = () => page.locator('.ot-search-modal');
const input = () => modal().getByRole('combobox');
const result = (text) => modal().getByRole('option').filter({ hasText: text });
try {
  state = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const tasks = [];
    for (const fields of [
      { title: prefix + ' Tickets' },
      { title: prefix + ' Inbox' },
      { title: prefix + ' Logged', status: 'done', loggedAt: '2020-01-01' },
      { title: prefix + ' Deleted', deleted: true },
    ])
      tasks.push(await p.createTask(fields));
    await p.patchTask(
      tasks[0],
      { checklist: [{ text: prefix + ' checklist', done: false }] },
      prefix + ' secret',
    );
    const path = prefix + '.md';
    await app.vault.create(path, '# Trip\n![[' + tasks[0].file.path + ']]');
    await p.openList('today');
    return {
      tasks,
      path,
      width: innerWidth,
      height: innerHeight,
      collapsed: app.workspace.leftSplit.collapsed,
    };
  }, prefix);
  const initialNavigation = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const original = plugin.records;
    let release;
    plugin.records = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    try {
      await plugin.openSearch();
      const modal = plugin.searchModal;
      modal.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      return { count: modal.results.length, selected: modal.index };
    } finally {
      plugin.records = original;
      plugin.searchModal?.close();
      release?.([]);
    }
  });
  assert.ok(initialNavigation.count > 1);
  assert.equal(initialNavigation.selected, 1, 'Arrow navigation works while the index is loading');
  await page.locator('[aria-label="Quick Find tasks"]').click();
  await input().fill(prefix);
  await result(prefix + ' Tickets').waitFor();
  assert.equal(await result(prefix + ' Logged').count(), 0);
  assert.equal(await result(prefix + ' Deleted').count(), 0);
  await result(prefix + ' Tickets')
    .filter({ hasText: prefix + '.md'.replace('.md', '') + ' · Anytime' })
    .waitFor();
  await page.screenshot({ path: 'artifacts/search-desktop.png' });
  await input().fill(prefix + ' secret');
  await modal().getByRole('button', { name: 'Continue Search' }).click();
  await modal().locator('.ot-search-more').waitFor({ state: 'hidden' });
  await result(prefix + ' Tickets').waitFor();
  assert.equal(await modal().locator('.ot-search-status').textContent(), '1 result');
  await result(prefix + ' Tickets').click();
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor();
  assert.equal(
    await page.locator('.workspace-leaf.mod-active .ot-title-input').inputValue(),
    prefix + ' Tickets',
  );
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file?.path), state.path);
  await page.locator('.workspace-leaf.mod-active .ot-title-input').press('Enter');
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openSearch());
  await input().fill(prefix + ' Inbox');
  await result(prefix + ' Inbox').waitFor();
  await input().press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor();
  assert.equal(
    await page.locator('.workspace-leaf.mod-active .ot-title-input').inputValue(),
    prefix + ' Inbox',
  );
  await page.locator('.workspace-leaf.mod-active .ot-title-input').press('Enter');
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openSearch());
  await input().fill(prefix + ' Logged');
  await modal().getByRole('button', { name: 'Continue Search' }).click();
  await result(prefix + ' Logged').click();
  await page
    .locator('.workspace-leaf.mod-active .ot-list-heading h1')
    .filter({ hasText: 'Logbook' })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => app.workspace.leftSplit.collapse());
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openSearch());
  await input().fill(prefix);
  await result(prefix + ' Tickets').waitFor();
  await page.screenshot({ path: 'artifacts/search-mobile.png' });
  assert.ok(await modal().evaluate((el) => el.getBoundingClientRect().right <= innerWidth));
  await page.keyboard.press('Escape');
  assert.equal(await modal().count(), 0);
  await page.evaluate(() => {
    const p = app.plugins.getPlugin('thingsmd');
    return p.openList('today');
  });
  await page.locator('.workspace-leaf.mod-active .ot-main').evaluate((el) => {
    el.tabIndex = -1;
    el.focus();
  });
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:quick-find'));
  await input().waitFor();
  await input().fill('Today');
  await input().press('ArrowDown');
  await input().press('ArrowUp');
  await input().press('Enter');
  await modal().waitFor({ state: 'hidden' });
  await page.locator('.workspace-leaf.mod-active .ot-main').evaluate((el) => {
    el.tabIndex = -1;
    el.focus();
  });
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:quick-find'));
  await input().waitFor();
  await input().fill('z');
  await input().fill(prefix + ' Inbox');
  await result(prefix + ' Inbox').waitFor();
  await page.evaluate(
    async ({ task, prefix }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const t = (await p.taskRecords()).find((t) => t.meta.id === task.meta.id);
      await p.patchTask(t, { title: prefix + ' Renamed' });
    },
    { task: state.tasks[1], prefix },
  );
  await result(prefix + ' Inbox').waitFor({ state: 'detached' });
  await input().fill(prefix + ' Renamed');
  await result(prefix + ' Renamed').waitFor();
  const theme = await page.evaluate(() => document.body.className);
  await page.evaluate(() => {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
  });
  await page.screenshot({ path: 'artifacts/search-dark.png' });
  await page.evaluate((theme) => (document.body.className = theme), theme);
  await page.keyboard.press('Escape');
  const reopened = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const reveal = p.revealSearchResult;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    p.revealSearchResult = async (result) => {
      await reveal(result);
      await gate;
    };
    try {
      await p.openSearch();
      const old = p.searchModal;
      const selecting = old.choose({ kind: 'list', page: 'today' });
      const opening = p.openSearch();
      release();
      await selecting;
      await opening;
      const result = p.searchModal !== old && !!p.searchModal;
      p.searchModal?.close();
      return result;
    } finally {
      p.revealSearchResult = reveal;
    }
  });
  assert.equal(reopened, true, 'Reopening during navigation creates a fresh search dialog');
  console.log(
    'PASS search: fast/broad scopes, project task opening, Inbox editing, Logbook navigation, desktop/mobile layout and Escape.',
  );
} finally {
  await page.evaluate(async (state) => {
    const p = app.plugins.getPlugin('thingsmd');
    p.searchModal?.close();
    const v = app.workspace.activeLeaf?.view;
    if (v?.taskDraft) await v.finishTask();
    if (state) {
      const f = app.vault.getAbstractFileByPath(state.path);
      if (f) await app.vault.delete(f);
      for (const t of state.tasks) await p.deleteTask(t.file.path);
    }
    await p.openList('today');
    if (state && !state.collapsed) app.workspace.leftSplit.expand();
  }, state);
  if (state) await page.setViewportSize({ width: state.width, height: state.height });
  await browser.close();
}
