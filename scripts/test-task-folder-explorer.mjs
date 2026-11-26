import assert from 'node:assert/strict';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
let original, taskPath, activeSettings, settingsViewport;
const wasMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
async function emulateMobile(value) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
}
try {
  original = await page.evaluate(
    () => app.plugins.getPlugin('thingsmd').settings.tasksFolderDisplay,
  );
  taskPath = await page.evaluate(async () => {
    const task = await app.plugins
      .getPlugin('thingsmd')
      .createTask({ title: 'Folder visibility fixture' });
    return task.file.path;
  });
  for (const mobile of [false, true]) {
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== mobile)
      await emulateMobile(mobile);
    await page.waitForFunction(
      () =>
        window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd')?.paintTaskFolder,
    );
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1100, height: 800 });
    await page.evaluate(() =>
      app.plugins.getPlugin('thingsmd').updateSettings({ tasksFolderDisplay: 'hidden' }),
    );
    for (const mode of ['normal', 'hidden']) {
      await page.evaluate(() => {
        app.setting.open();
        app.setting.openTabById('thingsmd');
      });
      const settings = (activeSettings = await settingsPage(page));
      settingsViewport = await settings.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      await settings.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1100, height: 800 },
      );
      await settings.bringToFront();
      const hide = settings.getByLabel('Hide ThingsMD folder', { exact: true });
      await hide.scrollIntoViewIfNeeded();
      assert.equal(
        await hide.evaluate((el) => el.classList.contains('is-enabled')),
        mode === 'normal',
      );
      assert.equal(await settings.locator('option').filter({ hasText: 'Show last' }).count(), 0);
      await hide.click();
      await waitForAsync(
        page,
        async (mode) =>
          (await app.plugins.getPlugin('thingsmd').loadData()).tasksFolderDisplay === mode,
        mode,
      );
      assert.equal(
        await hide.evaluate((el) => el.classList.contains('is-enabled')),
        mode === 'hidden',
      );
      if (mode === 'hidden')
        await settings.screenshot({
          path: `artifacts/task-folder-toggle-${mobile ? 'mobile' : 'desktop'}.png`,
        });
      await settings.setViewportSize(settingsViewport);
      activeSettings = undefined;
      // Mobile Settings can unmount the explorer rows until the drawer is opened again.
      await page.evaluate(async () => {
        app.setting.close();
        const workspace = app.workspace;
        const leaf = workspace.getLeavesOfType('file-explorer')[0];
        await leaf.loadIfDeferred?.();
        await workspace.revealLeaf(leaf);
        workspace.leftSplit.expand();
      });
      await page.waitForFunction((hidden) => {
        const p = app.plugins.getPlugin('thingsmd');
        const root = app.workspace.getLeavesOfType('file-explorer')[0].view.containerEl;
        const title = [...root.querySelectorAll('.nav-folder-title')].find(
          (el) => el.dataset.path === p.settings.tasksFolder,
        );
        const row = title?.closest('.nav-folder');
        return (
          root.getBoundingClientRect().height > 0 &&
          row &&
          (getComputedStyle(row).display === 'none') === hidden
        );
      }, mode === 'hidden');
    }
    const result = await page.evaluate(async () => {
      const p = app.plugins.getPlugin('thingsmd');
      const explorer = app.workspace.getLeavesOfType('file-explorer')[0].view;
      const order = explorer.sortOrder;
      const results = [];
      try {
        for (const sort of [
          'alphabetical',
          'alphabeticalReverse',
          'byModifiedTime',
          'byCreatedTime',
        ]) {
          if (typeof explorer.setSortOrder !== 'function')
            throw Error('Test cannot change File Explorer sort');
          explorer.setSortOrder(sort);
          for (const mode of ['hidden', 'normal']) {
            await p.updateSettings({ tasksFolderDisplay: mode });
            await new Promise((resolve) => setTimeout(resolve, 100));
            const title = [...explorer.containerEl.querySelectorAll('.nav-folder-title')].find(
              (el) => el.dataset.path === p.settings.tasksFolder,
            );
            const row = title.closest('.nav-folder');
            if ((getComputedStyle(row).display === 'none') !== (mode === 'hidden'))
              throw Error(`Wrong visibility: ${mode}`);
            if (explorer.sortOrder !== sort || getComputedStyle(row).order !== '0')
              throw Error(`Visibility changed the explorer sort: ${sort}`);
          }
          results.push(sort);
        }
      } finally {
        if (typeof explorer.setSortOrder === 'function') explorer.setSortOrder(order);
      }
      return results;
    });
    assert.equal(result.length, 4);
    await page.screenshot({ path: `artifacts/task-folder-${mobile ? 'mobile' : 'desktop'}.png` });
  }
  console.log(
    'Explorer: hide toggle, persisted visibility and unchanged sorting across four sort modes passed on desktop and Obsidian mobile emulation.',
  );
} finally {
  if (activeSettings && !activeSettings.isClosed())
    await activeSettings.setViewportSize(settingsViewport);
  await page.evaluate(
    async ({ value, taskPath }) => {
      app.setting.close();
      await app.plugins.getPlugin('thingsmd').updateSettings({ tasksFolderDisplay: value });
      const file = taskPath && app.vault.getAbstractFileByPath(taskPath);
      if (file) await app.vault.delete(file);
    },
    { value: original || 'hidden', taskPath },
  );
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== wasMobile) {
    await emulateMobile(wasMobile);
    await page.waitForFunction(
      () =>
        window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd')?.paintTaskFolder,
    );
  }
  await browser.close();
}
