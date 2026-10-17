import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
let state;
const prefix = 'Keyboard ' + Date.now();
const active = page.locator('.workspace-leaf.mod-active');
const command = async (id) =>
  assert.equal(
    await page.evaluate((id) => app.commands.executeCommandById(id), 'thingsmd:' + id),
    true,
    id,
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
  await page.keyboard.press('Escape');
  await command('save-task');
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
  await command('show-today');
  await active.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await row(0).focus();
  await command('task-context-menu');
  await page.locator('.menu').getByText('Mark as Waiting', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.menu').waitFor({ state: 'hidden' });
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
    'PASS commands: custom Obsidian hotkey, waiting toggle, Today/Evening, Enter editing, no hardcoded Save interception, checklist/date/Move commands, contextual capture, list/native reorder and both note modes.',
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
      if (state) {
        const f = app.vault.getAbstractFileByPath(state.path);
        if (f) await app.vault.delete(f);
      }
      await p.openList('today');
    },
    { state, prefix },
  );
  await browser.close();
}
