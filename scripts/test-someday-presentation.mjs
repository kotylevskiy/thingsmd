import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const note = `Someday appearance ${Date.now()}.md`;
let task, original;
const row = () =>
  page.locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${task.meta.id}"]:visible`);
const border = () =>
  row()
    .locator('.ot-task-line > input[type=checkbox]')
    .evaluate((el) => getComputedStyle(el).borderTopStyle);
try {
  ({ task, original } = await page.evaluate(async (note) => {
    const p = app.plugins.getPlugin('thingsmd');
    const original = { ...p.settings };
    await p.updateSettings({ logbook: 'manually' });
    const task = await p.createTask(
      {
        title: 'Learn watercolor painting when I have more time',
        when: 'someday',
        project: note,
        checklist: [
          { text: 'Find a class', done: false },
          { text: 'Get supplies', done: true },
        ],
      },
      undefined,
      'An idea to revisit.',
    );
    await app.vault.create(note, `# Ideas\n\n![[${task.file.path}]]\n`);
    await p.openList('someday');
    return { task, original };
  }, note));
  await row().waitFor();
  assert.equal(await border(), 'dashed');
  assert.equal(
    await row().locator('.ot-checklist-indicator').getAttribute('aria-label'),
    '1 of 2 checklist items completed',
  );
  await row().dblclick();
  await row().getByRole('button', { name: 'When', exact: true }).click();
  await page
    .locator('.ot-date-picker')
    .getByRole('button', { name: 'Anytime', exact: true })
    .click();
  assert.notEqual(await border(), 'dashed');
  await row().locator('.ot-title-input').press('Enter');
  await row().waitFor({ state: 'hidden' });
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.patchTask(
      (await p.taskRecords()).find((t) => t.meta.id === id),
      { when: 'someday' },
    );
  }, task.meta.id);
  for (const mode of ['source', 'preview']) {
    await page.evaluate(
      async ({ note, mode }) => {
        const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
        await leaf.openFile(app.vault.getAbstractFileByPath(note));
        await leaf.setViewState({
          type: 'markdown',
          state: { file: note, mode, source: false },
          active: true,
        });
      },
      { note, mode },
    );
    await row().waitFor();
    await page.waitForFunction(
      (id) =>
        [
          ...document.querySelectorAll(
            `.workspace-leaf.mod-active .ot-task[data-task-id="${id}"] input[type=checkbox]`,
          ),
        ].some(
          (el) => el.getClientRects().length && getComputedStyle(el).borderTopStyle === 'dashed',
        ),
      task.meta.id,
    );
    assert.equal(await border(), 'dashed');
    await row().getByRole('checkbox').check();
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`)
          ?.classList.contains('is-done'),
      task.meta.id,
    );
    assert.notEqual(await border(), 'dashed');
    await row().getByRole('checkbox').uncheck();
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`)
          ?.classList.contains('is-someday'),
      task.meta.id,
    );
  }
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('someday'));
  await row().waitFor();
  await page.screenshot({ path: 'artifacts/someday-presentation.png' });
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  const collapsed = await page.evaluate(() => app.workspace.leftSplit.collapsed);
  try {
    await page.evaluate(() => app.workspace.leftSplit.collapse());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    assert.equal(await border(), 'dashed');
    assert.equal(await row().evaluate((el) => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: 'artifacts/someday-presentation-mobile.png' });
    const classes = await page.evaluate(() => document.body.className);
    try {
      await page.evaluate(() => {
        document.body.classList.remove('theme-light');
        document.body.classList.add('theme-dark');
      });
      await page.screenshot({ path: 'artifacts/someday-presentation-dark.png' });
      assert.equal(await border(), 'dashed');
    } finally {
      await page.evaluate((classes) => (document.body.className = classes), classes);
    }
  } finally {
    await page.setViewportSize(viewport);
    if (!collapsed) await page.evaluate(() => app.workspace.leftSplit.expand());
  }
  console.log(
    'PASS: Someday checkbox styling, live schedule changes, completion/restore in Live Preview and Reading view, checklist indicator, phone-width layout and dark theme.',
  );
} finally {
  await page.evaluate(
    async ({ note, task, original }) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
      if (task) await p.deleteTask(task.file.path);
      if (original) await p.updateSettings(original);
      await p.openList('someday');
    },
    { note, task, original },
  );
  await browser.close();
}
