import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

if (process.platform !== 'darwin') {
  console.log('SKIP native macOS shortcut test: requires macOS and Accessibility permission.');
  process.exit(0);
}
const run = promisify(execFile);
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(6000);
const key = 'Control+Super+Space';
const title = `Native global capture ${Date.now()}`;
const capture = page.locator('.ot-capture-modal');
let original;
// A native callback regression can stop the renderer answering even cleanup.
const watchdog = setTimeout(() => {
  console.error('FAIL native shortcut left the disposable renderer unresponsive.');
  process.exit(1);
}, 60000);
watchdog.unref();
async function pressFromFinder() {
  await run(
    'osascript',
    [
      '-e',
      'tell application "Finder" to activate',
      '-e',
      'tell application "System Events" to key code 49 using {control down, command down}',
    ],
    { timeout: 10000 },
  );
  await capture.waitFor();
  await waitForAsync(page, async () => {
    const win = require('@electron/remote').getCurrentWindow();
    return win.isFocused() && win.isVisible() && !win.isMinimized();
  });
  assert.equal(await capture.count(), 1);
}
try {
  original = await page.evaluate(() => ({ ...app.plugins.getPlugin('thingsmd').settings }));
  await page.evaluate(() =>
    app.plugins.getPlugin('thingsmd').updateSettings({ captureDestination: 'inbox' }),
  );
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const settings = await settingsPage(page);
  await settings
    .getByRole('button', { name: 'Customize global capture shortcut', exact: true })
    .click();
  await settings.keyboard.press('Control+Meta+Space');
  await waitForAsync(
    page,
    async (key) => (await app.plugins.getPlugin('thingsmd').loadData()).globalCaptureHotkey === key,
    key,
  );
  await page.evaluate(() => app.setting.close());
  for (const state of ['background', 'minimized', 'hidden']) {
    if (state !== 'background')
      await page.evaluate((state) => {
        const win = require('@electron/remote').getCurrentWindow();
        if (state === 'hidden') win.hide();
        else win.minimize();
      }, state);
    await pressFromFinder();
    await capture.getByLabel('Task title', { exact: true }).fill(`${title} ${state}`);
    await capture.getByLabel('Task notes', { exact: true }).fill('Preserve this draft');
    await pressFromFinder();
    assert.equal(
      await capture.getByLabel('Task title', { exact: true }).inputValue(),
      `${title} ${state}`,
    );
    assert.equal(
      await capture.getByLabel('Task notes', { exact: true }).inputValue(),
      'Preserve this draft',
    );
    await capture.getByRole('button', { name: 'Save', exact: true }).click();
    await capture.waitFor({ state: 'detached' });
    await waitForAsync(
      page,
      async (title) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
          (t) => t.meta.title === title,
        ).length === 1,
      `${title} ${state}`,
    );
    console.log(
      `PASS native Control+Command+Space from Finder: ${state}, repeat activation, saved task, responsive window`,
    );
  }
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const openSettings = await settingsPage(page);
  const settingsDismissed = openSettings
    .locator('.vertical-tab-content')
    .waitFor({ state: 'hidden' })
    .catch((error) => {
      // Desktop Obsidian may destroy its separate Settings window on close.
      if (!openSettings.isClosed()) throw error;
    });
  await pressFromFinder();
  await settingsDismissed;
  await capture.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS native shortcut closes settings and focuses capture.');
  await page.reload();
  await page.waitForFunction(() => app.plugins?.getPlugin('thingsmd')?._loaded);
  assert.ok(
    !(await page.evaluate(() => app.plugins.getPlugin('thingsmd').globalCaptureError)),
    'Renderer reload can reclaim its previous shortcut',
  );
  await pressFromFinder();
  await capture.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log(
    'PASS renderer reload releases the old binding and routes native activation to the new capture.',
  );
  await page.evaluate(() => app.plugins.disablePlugin('thingsmd'));
  assert.equal(
    await page.evaluate((key) => require('@electron/remote').globalShortcut.isRegistered(key), key),
    false,
  );
  await page.evaluate(() => app.plugins.enablePlugin('thingsmd'));
  await pressFromFinder();
  await capture.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS native shortcut registration is restored after plugin reload.');
} finally {
  await page.evaluate(
    async ({ original, title }) => {
      app.setting.close();
      const plugin = app.plugins.getPlugin('thingsmd');
      plugin.captureModal?.close();
      for (const task of await plugin.taskRecords())
        if (task.meta.title?.startsWith(title)) await plugin.deleteTask(task.file);
      if (original) {
        await plugin.setGlobalCaptureHotkey(original.globalCaptureHotkey);
        await plugin.updateSettings(original);
      }
    },
    { original, title },
  );
  if (original?.globalCaptureHotkey !== key)
    assert.equal(
      await page.evaluate(
        (key) => require('@electron/remote').globalShortcut.isRegistered(key),
        key,
      ),
      false,
      'Restoring preferences releases the native test shortcut',
    );
  await browser.close();
  clearTimeout(watchdog);
}
