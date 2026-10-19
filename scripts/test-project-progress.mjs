import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const name = `Progress ${Date.now()}`,
  path = name + '.md',
  empty = name + ' Empty.md';
let state;
const sidebar = () => page.locator(`.nav-file-title[data-path="${path}"] .ot-project-progress`);
const move = () => page.locator('.ot-move-modal');
async function openMove() {
  await page
    .locator('.workspace-leaf.mod-active .ot-task')
    .filter({ hasText: name + ' pending' })
    .click({ button: 'right' });
  await page.locator('.menu').getByText('Move…', { exact: true }).click();
  await move().getByRole('button', { name, exact: true }).waitFor();
}
try {
  state = await page.evaluate(
    async ({ name, path, empty }) => {
      const p = app.plugins.getPlugin('thingsmd'),
        original = { ...p.settings },
        collapsed = app.workspace.leftSplit.collapsed;
      const a = await p.createTask({ title: name + ' pending', when: 'today' }),
        b = await p.createTask({ title: name + ' done', status: 'done', when: 'today' });
      await app.vault.create(path, `![[${a.file.path}]]\n![[${b.file.path}]]\n`);
      await app.vault.create(empty, 'Empty note');
      await p.updateSettings({ showProjectProgress: true });
      app.workspace.leftSplit.expand();
      await p.openList('today');
      return { original, collapsed, paths: [a.file.path, b.file.path] };
    },
    { name, path, empty },
  );
  await sidebar().waitFor();
  assert.equal(await sidebar().getAttribute('data-progress'), '1/2');
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
  assert.equal(
    await page
      .locator('.workspace-leaf.mod-active .ot-project-link')
      .filter({ hasText: name })
      .locator('.ot-project-progress')
      .getAttribute('data-progress'),
    '1/2',
  );
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await openMove();
  assert.equal(
    await move()
      .getByRole('button', { name, exact: true })
      .locator('.ot-project-progress')
      .getAttribute('data-progress'),
    '1/2',
  );
  assert.equal(
    await move()
      .getByRole('button', { name: name + ' Empty', exact: true })
      .locator('.ot-project-progress,.is-project')
      .count(),
    0,
  );
  await page.screenshot({ path: 'artifacts/project-progress.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const settingsPage = await findSettingsPage(page);
  await settingsPage.getByLabel('Show project progress', { exact: true }).click();
  await page.waitForFunction(
    () => app.plugins.getPlugin('thingsmd').settings.showProjectProgress === false,
  );
  await page.evaluate(() => app.setting.close());
  await sidebar().waitFor({ state: 'detached' });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
  assert.equal(await page.locator('.workspace-leaf.mod-active .ot-project-progress').count(), 0);
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await openMove();
  assert.equal(await move().locator('.ot-project-progress').count(), 0);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.updateSettings({ showProjectProgress: true });
  });
  await sidebar().waitFor();
  await page.evaluate(async (taskPath) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.patchTask(
      (await p.taskRecords()).find((t) => t.file.path === taskPath),
      { status: 'done' },
    );
  }, state.paths[0]);
  await page.waitForFunction(
    (path) =>
      document.querySelector(`.nav-file-title[data-path="${path}"] .ot-project-progress`)?.dataset
        .progress === '2/2',
    path,
  );
  for (const [statuses, expected] of [
    [['canceled', 'todo'], '1/2'],
    [['canceled', 'done'], '2/2'],
    [['todo', 'done'], '1/2'],
  ]) {
    await page.evaluate(
      async ({ paths, statuses }) => {
        const p = app.plugins.getPlugin('thingsmd');
        for (let i = 0; i < paths.length; i++) {
          const task = (await p.taskRecords()).find((t) => t.file.path === paths[i]);
          await p.patchTask(task, { status: statuses[i] });
        }
      },
      { paths: state.paths, statuses },
    );
    await page.waitForFunction(
      ({ path, expected }) =>
        document.querySelector(`.nav-file-title[data-path="${path}"] .ot-project-progress`)?.dataset
          .progress === expected,
      { path, expected },
    );
    assert.match(await sidebar().getAttribute('aria-label'), /tasks finished/);
  }
  console.log(
    'PASS: sidebar, grouped headings and Move progress, empty notes have no circle, settings toggle hides all three, live completion updates.',
  );
} finally {
  await page.keyboard.press('Escape');
  await page.evaluate(
    async ({ state, path, empty }) => {
      app.setting.close();
      const p = app.plugins.getPlugin('thingsmd');
      for (const name of [path, empty]) {
        const file = app.vault.getAbstractFileByPath(name);
        if (file) await app.vault.delete(file);
      }
      if (state) {
        for (const path of state.paths) await p.deleteTask(path);
        await p.updateSettings(state.original);
        if (state.collapsed) app.workspace.leftSplit.collapse();
      }
      await p.open();
    },
    { state, path, empty },
  );
  await browser.close();
}
