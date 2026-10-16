import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
let original;
const key = 'Control+Shift+F8';
try {
  original = await page.evaluate(
    () => app.plugins.getPlugin('thingsmd').settings.globalCaptureHotkey,
  );
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const settings = await findSettingsPage(page);
  await settings
    .getByRole('button', { name: 'Customize global capture shortcut', exact: true })
    .click();
  await settings.keyboard.press('Control+Shift+F8');
  await page.waitForFunction(
    (key) => app.plugins.getPlugin('thingsmd').settings.globalCaptureHotkey === key,
    key,
  );
  await settings.screenshot({ path: 'artifacts/global-capture-settings.png' });
  assert.equal(
    await page.evaluate((key) => require('@electron/remote').globalShortcut.isRegistered(key), key),
    true,
  );
  await settings
    .getByRole('button', { name: 'Customize global capture shortcut', exact: true })
    .click();
  await settings.keyboard.press('a');
  await settings.getByRole('status').filter({ hasText: 'Include Command' }).waitFor();
  await settings.keyboard.press('Escape');
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.globalCaptureHotkey),
    key,
  );
  await page.evaluate(() => app.setting.close());
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openGlobalCapture());
  await page.locator('.ot-capture-modal .ot-title-input').waitFor({ timeout: 5000 });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openGlobalCapture());
  assert.equal(await page.locator('.ot-capture-modal').count(), 1);
  await page.screenshot({ path: 'artifacts/global-capture-fixed.png' });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').captureModal.close());
  if (process.argv.includes('--native')) {
    console.log('READY: send Control+Shift+F8 from another app using native automation.');
    await page.locator('.ot-capture-modal .ot-title-input').waitFor({ timeout: 60000 });
    assert.equal(
      await page.evaluate(() => require('@electron/remote').getCurrentWindow().isFocused()),
      true,
    );
    await page.screenshot({ path: 'artifacts/global-capture-open.png' });
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').captureModal.close());
  }
  await page.evaluate(async () => {
    const id = 'thingsmd';
    await app.plugins.disablePlugin(id);
  });
  assert.equal(
    await page.evaluate((key) => require('@electron/remote').globalShortcut.isRegistered(key), key),
    false,
  );
  await page.evaluate(async () => app.plugins.enablePlugin('thingsmd'));
  assert.equal(
    await page.evaluate((key) => require('@electron/remote').globalShortcut.isRegistered(key), key),
    true,
  );
  console.log(
    'PASS: settings recorder, invalid shortcut retains old binding, main-process activation opens one capture, unload cleanup, reload registration.',
  );
} finally {
  await page.evaluate(async (original) => {
    app.setting.close();
    const p = app.plugins.getPlugin('thingsmd');
    await p.captureModal?.close();
    await p.setGlobalCaptureHotkey(original || '');
  }, original);
  await browser.close();
}
