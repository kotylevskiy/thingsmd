import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
let state;
const active = page.locator('.workspace-leaf.mod-active');
try {
  state = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd'),
      settings = { ...p.settings };
    const tasks = [];
    for (const fields of [
      { title: 'Approval from Alex', when: 'today', is_waiting: true },
      { title: 'Package delivery', is_waiting: true },
      { title: 'Read the proposal', when: 'today' },
      { title: 'Review tomorrow’s plan', when: 'evening' },
    ])
      tasks.push(await p.createTask(fields));
    const path = 'Waiting test ' + Date.now() + '.md';
    await app.vault.create(path, tasks.map((t) => '![[' + t.file.path + ']]').join('\n'));
    await p.updateSettings({ showWaitingInToday: true });
    await p.openList('today');
    return {
      tasks,
      path,
      settings,
      w: innerWidth,
      h: innerHeight,
      collapsed: app.workspace.leftSplit.collapsed,
    };
  });
  const row = (i) => active.locator(`.ot-task[data-task-id="${state.tasks[i].meta.id}"]`);
  await active.locator('.ot-waiting-section').waitFor();
  assert.equal(await active.locator('.ot-waiting-section').locator('.ot-task').count(), 1);
  assert.ok(await row(0).locator('input[type=checkbox] + .ot-waiting-marker').count());
  assert.ok(
    await active
      .locator('.ot-waiting-section')
      .evaluate((el) => el.previousElementSibling.classList.contains('ot-evening-section')),
  );
  for (const mobile of [false, true]) {
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 900 });
    await page.evaluate(
      (m) => (m ? app.workspace.leftSplit.collapse() : app.workspace.leftSplit.expand()),
      mobile,
    );
    await page.waitForTimeout(250);
    await page.screenshot({ path: `artifacts/waiting-today-${mobile ? 'mobile' : 'desktop'}.png` });
  }
  await page.evaluate(() =>
    app.plugins.getPlugin('thingsmd').updateSettings({ showWaitingInToday: false }),
  );
  await active.locator('.ot-waiting-section').waitFor({ state: 'detached' });
  await row(0).waitFor();
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('waiting'));
  await row(1).waitFor();
  await page.screenshot({ path: 'artifacts/waiting-list-mobile.png' });
  await row(1).click({ button: 'right' });
  await page.locator('.menu').getByText('Stop Waiting', { exact: true }).click();
  await row(1).waitFor({ state: 'detached' });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
  await row(1).waitFor();
  await row(1).click({ button: 'right' });
  await page.locator('.menu').getByText('Mark as Waiting', { exact: true }).click();
  await row(1).waitFor({ state: 'detached' });
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.transferTask({ id, list: 'waiting' });
    await p.openList('waiting');
  }, state.tasks[2].meta.id);
  await row(2).waitFor();
  const meta = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta,
    state.tasks[2].meta.id,
  );
  assert.equal(meta.when, 'today');
  assert.equal(meta.is_waiting, true);
  for (const mode of ['source', 'preview']) {
    await page.evaluate(
      async ({ path, mode }) => {
        const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
        await leaf.openFile(app.vault.getAbstractFileByPath(path));
        await leaf.setViewState({
          type: 'markdown',
          state: { file: path, mode, source: false },
          active: true,
        });
      },
      { path: state.path, mode },
    );
    await row(0)
      .filter({ visible: true })
      .locator('input[type=checkbox] + .ot-waiting-marker')
      .waitFor();
    await page.screenshot({ path: `artifacts/waiting-${mode}.png` });
  }
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('waiting'));
  await active.getByRole('button', { name: '+ New task', exact: true }).first().click();
  const capture = page.locator('.ot-capture-modal');
  assert.equal(await capture.locator('.ot-waiting-marker').count(), 0);
  assert.equal(
    await capture
      .getByRole('button', { name: 'Waiting For', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await capture.getByRole('textbox', { name: 'Task title' }).fill('Waiting capture fixture');
  await capture.getByRole('textbox', { name: 'Task title' }).press('Enter');
  await capture.waitFor({ state: 'hidden' });
  const created = await page.evaluate(async () =>
    (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
      (t) => t.meta.title === 'Waiting capture fixture',
    ),
  );
  state.tasks.push(created);
  assert.equal(created.meta.is_waiting, true);
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const settingsPage = await findSettingsPage(page);
  await settingsPage.getByLabel('Group waiting tasks in Today', { exact: true }).click();
  await page.waitForFunction(
    () => app.plugins.getPlugin('thingsmd').settings.showWaitingInToday === true,
  );
  await settingsPage.screenshot({ path: 'artifacts/waiting-settings.png' });
  await page.evaluate(async () => {
    app.setting.close();
    const id = 'thingsmd';
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
    await app.plugins.getPlugin(id).openList('waiting');
  });
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.showWaitingInToday),
    true,
  );
  await active.getByText('Waiting capture fixture', { exact: true }).waitFor();
  console.log(
    'PASS waiting: Today grouping/order and setting off, dedicated list, context toggle, transfer preserves date, airplane follows checkbox in lists and both note modes.',
  );
} finally {
  await page.evaluate(async (s) => {
    app.setting.close();
    const p = app.plugins.getPlugin('thingsmd');
    if (s) {
      const f = app.vault.getAbstractFileByPath(s.path);
      if (f) await app.vault.delete(f);
      for (const t of s.tasks) await p.deleteTask(t.file.path);
      await p.updateSettings(s.settings);
      if (!s.collapsed) app.workspace.leftSplit.expand();
    }
    await p.openList('today');
  }, state);
  if (state) await page.setViewportSize({ width: state.w, height: state.h });
  await browser.close();
}
