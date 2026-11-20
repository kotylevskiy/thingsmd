import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault({
  settings: { enableWaiting: true, taskNotesTab: 'current', trashRetention: 'never' },
});
page.setDefaultTimeout(10000);
let state;
const prefix = 'Keyboard ' + Date.now();
const active = page.locator('.workspace-leaf.mod-active');
const execute = (id) =>
  page.evaluate((id) => app.commands.executeCommandById('thingsmd:' + id), id);
const command = async (id) => assert.equal(await execute(id), true, id);
const available = (ids) =>
  page.evaluate(
    (ids) => ids.map((id) => app.commands.commands[`thingsmd:${id}`].checkCallback(true)),
    ids,
  );
const waitForField = (id, field, value) =>
  waitForAsync(
    page,
    async ({ id, field, value }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((task) => task.meta.id === id)
        ?.meta[field] === value,
    { id, field, value },
  );
try {
  state = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const tasks = [];
    for (let i = 0; i < 2; i++)
      tasks.push(await p.createTask({ title: prefix + ' ' + i, when: 'today', order: i * 100 }));
    const path = prefix + '.md';
    await app.vault.create(path, tasks.map((t) => '![[' + t.file.path + ']]').join('\n'));
    await p.openList('today');
    return {
      tasks,
      path,
      hotkey: app.hotkeyManager.getHotkeys('thingsmd:toggle-waiting'),
    };
  }, prefix);
  const row = (i) => active.locator(`.ot-task[data-task-id="${state.tasks[i].meta.id}"]:visible`);
  assert.equal(
    await page.evaluate(() => app.commands.commands['thingsmd:open']),
    undefined,
    'The duplicate list command is retired',
  );
  await row(0).focus();
  await page.evaluate(() => {
    app.hotkeyManager.setHotkeys('thingsmd:toggle-waiting', [
      { modifiers: ['Mod', 'Shift'], key: 'W' },
    ]);
    app.hotkeyManager.bake();
  });
  await page.keyboard.press('Meta+Shift+w');
  await row(0).locator('.ot-waiting-marker').waitFor();
  await page.keyboard.press('Meta+Shift+w');
  await row(0).locator('.ot-waiting-marker').waitFor({ state: 'detached' });
  await row(0).focus();
  await command('task-evening');
  await active
    .locator('.ot-evening-section')
    .locator(`[data-task-id="${state.tasks[0].meta.id}"]`)
    .waitFor();
  await row(0).focus();
  await command('task-today');
  await page.waitForFunction(
    (id) => !document.querySelector(`.ot-evening-section [data-task-id="${id}"]`),
    state.tasks[0].meta.id,
  );
  await row(0).focus();
  assert.deepEqual(
    await available(['remove-deadline', 'task-deadline-later', 'delete-task-permanently']),
    [false, false, false],
  );
  await page.keyboard.press('Enter');
  await row(0).locator('.ot-title-input').waitFor();
  await page.keyboard.press('Meta+s');
  assert.equal(await active.locator('.ot-date-picker').count(), 0);
  await command('add-checklist-item');
  await row(0).getByLabel('Checklist text 1', { exact: true }).fill('A step');
  await command('save-task');
  await row(0).locator('.ot-title-input').waitFor({ state: 'detached' });
  await row(0).focus();
  await command('task-deadline');
  await active.locator('.ot-date-picker').waitFor();
  const deadline = active.getByLabel('Deadline date', { exact: true });
  await deadline.fill('2099-01-01');
  await deadline.press('Enter');
  await command('save-task');
  await row(0).locator('.ot-title-input').waitFor({ state: 'detached' });
  await row(0).focus();
  await command('task-deadline-earlier');
  await waitForField(state.tasks[0].meta.id, 'deadline', '2098-12-31');
  await row(0).focus();
  await command('task-deadline-later');
  await waitForField(state.tasks[0].meta.id, 'deadline', '2099-01-01');
  await row(0).focus();
  await command('remove-deadline');
  await waitForAsync(
    page,
    async (id) =>
      !(await app.plugins.getPlugin('thingsmd').taskRecords()).find((task) => task.meta.id === id)
        .meta.deadline,
    state.tasks[0].meta.id,
  );
  await row(0).focus();
  await command('move-task');
  await page.locator('.ot-move-modal').waitFor();
  await page.keyboard.press('Escape');
  await command('show-anytime');
  await active.getByRole('heading', { name: 'Anytime', exact: true }).waitFor();
  await row(1).waitFor();
  await row(1).focus();
  await command('move-task-up');
  await waitForAsync(
    page,
    async (id) =>
      Number.isFinite(
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
          .listOrder?.anytime,
      ),
    state.tasks[1].meta.id,
  );
  await command('capture');
  const capture = page.locator('.ot-capture-modal');
  await capture.getByLabel('Task title', { exact: true }).fill(prefix + ' New');
  await capture.getByLabel('Task title', { exact: true }).press('Enter');
  await capture.waitFor({ state: 'hidden' });
  const created = await page.evaluate(
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.title === prefix + ' New',
      ),
    prefix,
  );
  state.tasks.push(created);
  assert.equal(created.meta.when, 'anytime');
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
    await row(0).focus();
    await command('edit-task');
    await row(0).locator('.ot-title-input:focus').waitFor();
    await command('save-task');
    await row(0).locator('.ot-title-input').waitFor({ state: 'detached' });
    await row(0).focus();
    await command('toggle-waiting');
    await row(0).locator('.ot-waiting-marker').waitFor();
    await row(0).focus();
    await command('toggle-waiting');
    await row(0).locator('.ot-waiting-marker').waitFor({ state: 'detached' });
    await row(0).focus();
    await command('move-task-down');
    await waitForAsync(
      page,
      async ({ path, id, before }) => {
        const text = await app.vault.read(app.vault.getAbstractFileByPath(path));
        return text.includes(before) && text.indexOf(id) > text.indexOf(before);
      },
      { path: state.path, id: state.tasks[0].meta.id, before: state.tasks[1].meta.id },
    );
    await row(0).focus();
    await command('move-task-up');
    await waitForAsync(
      page,
      async ({ path, first, second }) => {
        const text = await app.vault.read(app.vault.getAbstractFileByPath(path));
        return text.includes(first) && text.indexOf(second) > text.indexOf(first);
      },
      { path: state.path, first: state.tasks[0].meta.id, second: state.tasks[1].meta.id },
    );
  }
  await command('capture');
  await capture.getByLabel('Task title', { exact: true }).fill(prefix + ' Project');
  await capture.getByLabel('Task title', { exact: true }).press('Enter');
  await capture.waitFor({ state: 'hidden' });
  const projectTask = await page.evaluate(
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.title === prefix + ' Project',
      ),
    prefix,
  );
  state.tasks.push(projectTask);
  assert.equal(projectTask.meta.project, state.path);
  state.secondPath = `${prefix} second.md`;
  await page.evaluate(async ({ secondPath, tasks }) => {
    await app.vault.create(secondPath, `Before\n\n![[${tasks[0].file.path}]]\n\nAfter\n`);
  }, state);
  await command('show-today');
  await active.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await row(0).focus();
  assert.equal(
    await page.evaluate(() => app.commands.executeCommandById('command-palette:open')),
    true,
  );
  const prompt = page.locator('.prompt');
  await prompt.locator('.prompt-input').fill('Edit selected task');
  await prompt
    .locator('.suggestion-item')
    .filter({ hasText: /ThingsMD\s*Edit selected task/ })
    .click();
  const title = row(0).locator('.ot-title-input:focus');
  await title.fill(prefix + ' edited');
  await command('open-task-note');
  await page.waitForFunction(
    (path) => app.workspace.activeLeaf.view.file?.path === path,
    state.tasks[0].file.path,
  );
  await waitForAsync(
    page,
    async ({ id, title }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
        (task) => task.meta.id === id && task.meta.title === title,
      ),
    { id: state.tasks[0].meta.id, title: prefix + ' edited' },
  );
  await command('show-today');
  await row(0).focus();
  await command('open-project');
  const projects = page.locator('.menu');
  await projects.getByText(state.path, { exact: true }).waitFor();
  await projects.getByText(state.secondPath, { exact: true }).click();
  await page.waitForFunction(
    (path) => app.workspace.activeLeaf.view.file?.path === path,
    state.secondPath,
  );
  await command('show-today');
  await row(0).focus();
  await command('task-context-menu');
  await page.locator('.menu').getByText('Mark as Waiting', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.menu').waitFor({ state: 'hidden' });
  const [daytime, evening] = await page.evaluate(async (prefix) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    return [
      await plugin.createTask({ title: prefix + ' Daytime', when: 'today' }),
      await plugin.createTask({ title: prefix + ' Evening', when: 'evening' }),
    ];
  }, prefix);
  const daytimeGroup = active.locator('.ot-paper > .ot-group[data-group="today"]');
  const otherRow = active.locator(`.ot-task[data-task-id="${daytime.meta.id}"]`);
  await otherRow.waitFor();
  await row(0).focus();
  await command('move-task-to-bottom');
  const groupRows = daytimeGroup.locator(':scope > .ot-task');
  const targetId = state.tasks[0].meta.id;
  await groupRows.last().and(row(0)).waitFor();
  assert.deepEqual(await available(['move-task-to-bottom']), [false]);
  await command('move-task-to-top');
  await groupRows.first().and(row(0)).waitFor();
  assert.deepEqual(await available(['move-task-to-top']), [false]);
  const eveningRow = active.locator(
    `.ot-evening-section .ot-task[data-task-id="${evening.meta.id}"]`,
  );
  await eveningRow.focus();
  assert.deepEqual(await available(['move-task-to-top', 'move-task-to-bottom']), [false, false]);
  await command('task-when-later');
  const [today, tomorrow] = await page.evaluate(() => {
    const key = (date) =>
      [date.getFullYear(), date.getMonth() + 1, date.getDate()]
        .map((part) => String(part).padStart(2, '0'))
        .join('-');
    const date = new Date();
    const today = key(date);
    date.setDate(date.getDate() + 1);
    return [today, key(date)];
  });
  await waitForField(evening.meta.id, 'when', tomorrow);
  await waitForField(evening.meta.id, 'evening', null);
  await command('show-upcoming');
  await active.locator(`.ot-task[data-task-id="${evening.meta.id}"]`).focus();
  await command('task-when-earlier');
  await waitForField(evening.meta.id, 'when', today);
  const duplicateTitle = prefix + ' edited';
  for (const [index, mode] of ['source', 'preview'].entries()) {
    await page.evaluate(
      async ({ path, mode }) => {
        const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
        await leaf.setViewState({
          type: 'markdown',
          state: { file: path, mode, source: false },
          active: true,
        });
      },
      { path: state.path, mode },
    );
    await row(0).focus();
    assert.deepEqual(await available(['move-task-to-top', 'move-task-to-bottom']), [false, false]);
    await command('duplicate-task');
    await waitForAsync(
      page,
      async ({ title, path, original, count }) => {
        const plugin = app.plugins.getPlugin('thingsmd');
        const copies = (await plugin.taskRecords()).filter(
          (task) => task.meta.id !== original && task.meta.title === title,
        );
        if (copies.length !== count) return false;
        const text = await app.vault.read(app.vault.getAbstractFileByPath(path));
        return copies.every((copy) => text.includes(copy.file.path.slice(0, -3)));
      },
      { title: duplicateTitle, path: state.path, original: targetId, count: index + 1 },
    );
  }
  await command('show-today');
  await active.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await otherRow.focus();
  await command('duplicate-task');
  await waitForAsync(
    page,
    async ({ title, id }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
        ({ meta }) => meta.id !== id && meta.title === title && meta.when === 'today',
      ),
    { title: daytime.meta.title, id: daytime.meta.id },
  );
  const checkTrashCommands = () => available(['trash-task', 'delete-task-permanently']);
  await row(0).focus();
  assert.deepEqual(await checkTrashCommands(), [true, false]);
  await page.evaluate(() =>
    app.plugins.getPlugin('thingsmd').updateSettings({ trashRetention: 'immediately' }),
  );
  await row(0).focus();
  assert.deepEqual(await checkTrashCommands(), [false, true]);
  await command('delete-task-permanently');
  await waitForAsync(
    page,
    async (path) => !(await app.vault.adapter.exists(path)),
    state.tasks[0].file.path,
  );
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('hotkeys');
  });
  const settings = await findSettingsPage(page);
  await settings.getByPlaceholder(/Filter/).fill('ThingsMD');
  await settings.getByText('ThingsMD: Toggle waiting', { exact: true }).waitFor();
  await settings.screenshot({ path: 'artifacts/hotkey-commands.png' });
  await page.evaluate(() => app.setting.close());
  console.log(
    'PASS commands: date nudges, group edge moves, duplication in lists and both note modes, palette editing, draft-safe navigation, project chooser, and custom hotkeys.',
  );
} catch (error) {
  console.log(
    'Command failure diagnostics:',
    await page.evaluate(() => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const view = app.workspace.activeLeaf?.view;
      return {
        mobile: document.body.classList.contains('is-mobile'),
        navigationOverride: plugin.settings.mobileTaskNavigation,
        captureError: plugin.captureModal?.contentEl.querySelector('.ot-save-error')?.textContent,
        captureSaving: !!plugin.captureModal?.saving,
        captureFields: plugin.captureModal?.fields,
        captureTask: plugin.captureModal?.createdTask?.meta,
        viewMode: view?.getMode?.(),
        viewSaving: view?.saving,
        activeFile: view?.file?.path,
      };
    }),
  );
  await page.screenshot({ path: 'artifacts/command-failure.png' });
  throw error;
} finally {
  await page.evaluate(
    async ({ state, prefix }) => {
      app.setting.close();
      const p = app.plugins.getPlugin('thingsmd');
      await p.captureModal?.close();
      if (state?.hotkey) app.hotkeyManager.setHotkeys('thingsmd:toggle-waiting', state.hotkey);
      else app.hotkeyManager.removeHotkeys('thingsmd:toggle-waiting');
      app.hotkeyManager.bake();
      for (const t of await p.taskRecords())
        if (t.meta.title?.startsWith(prefix)) await p.deleteTask(t.file.path);
      for (const path of [state?.path, state?.secondPath].filter(Boolean)) {
        const f = app.vault.getAbstractFileByPath(path);
        if (f) await app.vault.delete(f);
      }
      await p.openList('today');
    },
    { state, prefix },
  );
  await browser.close();
}
