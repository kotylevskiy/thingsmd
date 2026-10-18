import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
const note = 'Native test fixture.md';
let taskPath;
let createdPath;
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  taskPath = await page.evaluate(async (note) => {
    const task = await app.plugins.getPlugin('thingsmd').createTask({ title: 'Native fixture' });
    const file = await app.vault.create(
      note,
      `Ordinary **Markdown**.\n\n![[${task.file.path.slice(0, -3)}]]\n\nMore context.\n\n`,
    );
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.openFile(file);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: note, mode: 'source', source: false },
    });
    return task.file.path;
  }, note);
  // Clicking ordinary prose must place a usable native-editor caret.
  const prose = page
    .locator('.workspace-leaf.mod-active .cm-line')
    .filter({ hasText: 'More context.' });
  await prose.click();
  await page.keyboard.type(' Click editing works.');
  assert.ok(
    await page.evaluate(() =>
      app.workspace.activeLeaf.view.editor.getValue().includes('Click editing works.'),
    ),
  );
  await page.keyboard.press('Meta+z');
  const row = page.locator(
    `.workspace-leaf.mod-active .ot-native[data-task-path="${taskPath}"]:visible .ot-task`,
  );
  await row.waitFor();
  // Enter the reference source: Obsidian may add a second embed at its boundary.
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    const line = e
      .getValue()
      .split('\n')
      .findIndex((l) => l.startsWith('![['));
    e.setCursor({ line, ch: 5 });
    e.focus();
  });
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator('.workspace-leaf.mod-active .internal-embed:visible').count(),
    0,
    'No duplicate native task embed',
  );
  await row.hover();
  await page.waitForTimeout(800);
  assert.equal(
    await page.locator('.tooltip').filter({ hasText: 'Native fixture' }).count(),
    0,
    'No task title tooltip',
  );
  await row.dblclick();
  await page
    .locator('.workspace-leaf.mod-active .ot-native .ot-title-input')
    .fill('Edited native task');
  await page.keyboard.press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => app.workspace.getActiveFile()?.path), note);
  assert.equal(
    await page.evaluate(() => document.activeElement?.classList.contains('ot-task')),
    true,
    'Enter leaves the collapsed task selected',
  );
  await page.keyboard.press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor();
  assert.equal(
    await page.locator('.workspace-leaf.mod-active .ot-title-input').inputValue(),
    'Edited native task',
    'The next Enter reopens the same task',
  );
  await page.locator('.workspace-leaf.mod-active .ot-title-input').press('Tab');
  await waitForAsync(
    page,
    (path) =>
      !app.plugins.getPlugin('thingsmd').taskNotesOpening &&
      app.workspace.activeLeaf?.view.file?.path === path,
    taskPath,
  );
  await page.evaluate(async (note) => {
    const view = app.workspace.activeLeaf.view;
    view.editor.setValue(view.editor.getValue() + 'Details saved independently.');
    await view.save();
    const project = app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.view.file?.path === note);
    await app.workspace.revealLeaf(project);
    app.workspace.setActiveLeaf(project, { focus: true });
  }, note);
  await row.dblclick();
  await page
    .locator('.workspace-leaf.mod-active .ot-task-notes-preview')
    .getByText('Details saved independently.')
    .waitFor();
  const card = page.locator('.workspace-leaf.mod-active .ot-task.is-expanded');
  await card.getByRole('button', { name: 'When', exact: true }).click();
  await card.getByLabel('When date').fill('tomorrow');
  await card.getByLabel('When date').press('Enter');
  await card.getByRole('button', { name: 'Deadline', exact: true }).click();
  const dateInput = card.getByRole('textbox', { name: 'Deadline date', exact: true });
  await dateInput.fill('2027-02-29');
  await dateInput.press('Enter');
  assert.equal(await dateInput.getAttribute('aria-invalid'), 'true');
  await dateInput.fill('29.02.2028');
  await dateInput.press('Enter');
  await card.getByRole('button', { name: 'Deadline', exact: true }).click();
  assert.equal(await card.locator('[data-date="2028-02-29"]').getAttribute('aria-pressed'), 'true');
  await card.getByRole('button', { name: 'Next month', exact: true }).click();
  await page.screenshot({ path: 'artifacts/date-picker.png' });
  await card.locator('[data-date="2028-03-10"]').click();
  await card.getByRole('button', { name: 'Deadline', exact: true }).click();
  await card.getByRole('button', { name: 'Remove deadline', exact: true }).click();
  assert.equal(await card.locator('.ot-chip').filter({ hasText: '2028-03-10' }).count(), 0);
  await card.getByRole('button', { name: 'Deadline', exact: true }).click();
  await card.getByRole('textbox', { name: 'Deadline date', exact: true }).fill('2028-03-09');
  await card.getByRole('textbox', { name: 'Deadline date', exact: true }).press('Enter');
  // Navigate before the picker's deferred positioning callback runs. That
  // callback must not steal focus back from the selected calendar day.
  await card.getByRole('button', { name: 'Deadline', exact: true }).evaluate(async (button) => {
    button.click();
    const input = document.querySelector('.ot-date-picker input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.date), '2028-03-09');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');

  await card.getByRole('button', { name: 'When', exact: true }).click();
  await card.getByRole('textbox', { name: 'When date', exact: true }).press('Escape');
  assert.equal(await card.locator('.ot-date-picker').count(), 0);
  assert.equal(await card.count(), 1, 'Escape closes only the picker');
  await page.locator('.workspace-leaf.mod-active .ot-native .ot-title-input').press('Enter');
  await card.waitFor({ state: 'detached' });
  const dated = await page.evaluate(
    async (path) =>
      (await app.plugins.getPlugin('thingsmd').records()).find((r) => r.file.path === path).meta,
    taskPath,
  );
  assert.equal(dated.deadline, '2028-03-10');
  assert.match(dated.when, /^\d{4}-\d{2}-\d{2}$/);
  const collapsed = page
    .locator('.workspace-leaf.mod-active .ot-task')
    .filter({ hasText: 'Edited native task' });
  assert.equal(
    await collapsed.locator('.ot-note-icon').count(),
    1,
    'Notes indicator is visible when collapsed',
  );
  assert.equal(await collapsed.locator('.ot-row-when time').getAttribute('datetime'), dated.when);
  assert.equal(
    await collapsed.locator('.ot-row-deadline time').getAttribute('datetime'),
    dated.deadline,
  );
  await page.screenshot({ path: 'artifacts/task-row-details.png' });
  // Today replaces the previous schedule without changing the deadline.
  await collapsed.press('Enter');
  await card.getByRole('button', { name: 'When', exact: true }).click();
  await card.getByRole('button', { name: /^Today/ }).click();
  await page.locator('.workspace-leaf.mod-active .ot-title-input').press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor({ state: 'hidden' });
  const scheduled = await page.evaluate(
    async (path) =>
      (await app.plugins.getPlugin('thingsmd').records()).find((r) => r.file.path === path).meta,
    taskPath,
  );
  assert.equal(scheduled.when, 'today');
  assert.equal(scheduled.deadline, dated.deadline);
  assert.equal(await collapsed.locator('.ot-today-marker').count(), 1);
  assert.equal(
    await collapsed.locator('.ot-row-when').count(),
    0,
    'Today is a star, not a dated calendar badge',
  );
  await collapsed.press('Enter');
  await card.getByRole('button', { name: 'When', exact: true }).click();
  await card.getByLabel('When date').fill('tomorrow');
  await card.getByLabel('When date').press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-title-input').press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor({ state: 'hidden' });
  assert.equal(
    await collapsed.locator('.ot-today-marker').count(),
    0,
    'Rescheduling replaces Today',
  );
  assert.equal(await collapsed.locator('.ot-row-when time').getAttribute('datetime'), dated.when);
  assert.equal(
    await collapsed.locator('.ot-row-deadline time').getAttribute('datetime'),
    dated.deadline,
  );

  await waitForAsync(
    page,
    async (path) => (await app.vault.adapter.read(path)).includes('Details saved independently.'),
    taskPath,
  );
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: e.lineCount() - 1, ch: 0 });
    e.focus();
  });
  await page.evaluate((note) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const create = plugin.createTask;
    const retry = (window.nativeCreationTest = { plugin, create, attempts: 0 });
    plugin.createTask = async function (fields, ...args) {
      if (fields.project === note && fields.title === '' && ++retry.attempts === 1)
        throw new Error('Injected inline creation failure');
      return create.call(this, fields, ...args);
    };
  }, note);
  await page.keyboard.type('+ ');
  const newTitle = page.locator('.workspace-leaf.mod-active .ot-native .ot-title-input');
  await newTitle.waitFor();
  assert.equal(await newTitle.evaluate((el) => el === document.activeElement), true);
  assert.equal(await newTitle.inputValue(), '');
  await page.keyboard.type('Created from the note');
  await newTitle.press('Enter');
  await newTitle.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () =>
      app.workspace.activeLeaf.view.editor.getValue().includes('![[ThingsMD/') &&
      !app.workspace.activeLeaf.view.editor.getValue().includes('+ Created'),
  );
  createdPath = await page.evaluate(async () => {
    const records = await app.plugins.getPlugin('thingsmd').records();
    return records.find((r) => r.meta.title === 'Created from the note')?.file.path;
  });
  assert.ok(createdPath);
  assert.equal(await page.evaluate(() => window.nativeCreationTest.attempts), 2);
  assert.match(
    await page.evaluate((path) => app.vault.adapter.read(path), createdPath),
    /Created from the note/,
  );
  await page.evaluate(() => {
    const retry = window.nativeCreationTest;
    retry.plugin.createTask = retry.create;
    delete window.nativeCreationTest;
  });
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: e.lineCount() - 1, ch: 0 });
    e.focus();
  });
  await page.keyboard.type('More native prose.');
  await page.waitForFunction(() =>
    app.workspace.activeLeaf.view.editor.getValue().includes('More native prose.'),
  );
  assert.equal(await page.locator('.workspace-leaf.mod-active .ot-native').count(), 2);
  await page.evaluate(async () => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    const state = leaf.getViewState();
    state.state.source = true;
    await leaf.setViewState(state);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.workspace-leaf.mod-active .ot-native').length === 0,
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'PASS: native task rendering, inline editing, independent autosave, typed creation retry after a failed write without lost text or duplicate tasks, native prose and Source Mode.',
  );
} catch (error) {
  console.error('Native errors:', errors);
  console.error(
    await page.evaluate(() => ({
      focus: document.activeElement?.tagName,
      titleInputs: document.querySelectorAll('.ot-title-input').length,
    })),
  );
  await page.screenshot({ path: 'artifacts/native-failure.png' });
  throw error;
} finally {
  await page.evaluate(
    async ({ note, taskPath, createdPath }) => {
      if (window.nativeCreationTest) {
        const retry = window.nativeCreationTest;
        retry.plugin.createTask = retry.create;
        delete window.nativeCreationTest;
      }
      await app.plugins.getPlugin('thingsmd').openList('inbox');
      // Typed creation may fail before createdPath is assigned. Clean every task
      // belonging to this disposable note so failures do not leave orphan fixtures.
      const plugin = app.plugins.getPlugin('thingsmd');
      const typed = (await plugin.taskRecords())
        .filter((t) => t.meta.project === note)
        .map((t) => t.file.path);
      for (const path of new Set([note, taskPath, createdPath, ...typed])) {
        const f = path && app.vault.getAbstractFileByPath(path);
        if (f) await app.vault.delete(f);
        else if (path?.startsWith('ThingsMD/') && (await app.vault.adapter.exists(path)))
          await app.plugins.getPlugin('thingsmd').deleteTask(path);
      }
    },
    { note, taskPath, createdPath },
  );
  await browser.close();
}
