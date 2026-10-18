import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
let original;
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
  for (const mobile of [false, true]) {
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== mobile)
      await emulateMobile(mobile);
    await page.waitForFunction(
      () =>
        window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd')?.paintTaskFolder,
    );
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1100, height: 800 });
    await page.evaluate(async () => {
      const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
      await leaf.loadIfDeferred?.();
      await app.workspace.revealLeaf(leaf);
      app.workspace.leftSplit.expand();
    });
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
          await p.updateSettings({ tasksFolderDisplay: 'last' });
          await new Promise((resolve) => setTimeout(resolve, 100));
          const title = [...explorer.containerEl.querySelectorAll('.nav-folder-title')].find(
            (el) => el.dataset.path === p.settings.tasksFolder,
          );
          const row = title.closest('.nav-folder');
          const siblings = [...row.parentElement.children].filter(
            (el) => el !== row && el.getBoundingClientRect().height > 0,
          );
          const top = row.getBoundingClientRect().top;
          if (siblings.some((el) => el.getBoundingClientRect().top > top + 1))
            throw Error(`Folder is not last for ${sort}`);
          results.push(sort);
        }
        for (const mode of ['hidden', 'normal']) {
          await p.updateSettings({ tasksFolderDisplay: mode });
          const row = explorer.containerEl
            .querySelector('.nav-folder-title[data-path="' + p.settings.tasksFolder + '"]')
            .closest('.nav-folder');
          if ((getComputedStyle(row).display === 'none') !== (mode === 'hidden'))
            throw Error(`Wrong visibility: ${mode}`);
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
    'Explorer: actual last-row geometry across four sort modes, normal/hidden modes, desktop and Obsidian mobile emulation passed.',
  );
} finally {
  await page.evaluate(async (value) => {
    await app.plugins.getPlugin('thingsmd').updateSettings({ tasksFolderDisplay: value });
  }, original || 'hidden');
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== wasMobile) {
    await emulateMobile(wasMobile);
    await page.waitForFunction(
      () =>
        window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd')?.paintTaskFolder,
    );
  }
  await browser.close();
}
