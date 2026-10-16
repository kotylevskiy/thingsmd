import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
let original;
try {
  original = await page.evaluate(
    () => app.plugins.getPlugin('thingsmd').settings.globalCaptureHotkey,
  );
  // A fresh vault has no configured shortcut; establish a binding to suspend.
  const baseline = original || 'Control+Shift+F9';
  await page.evaluate(
    (key) => app.plugins.getPlugin('thingsmd').setGlobalCaptureHotkey(key),
    baseline,
  );
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const p = await findSettingsPage(page);
  p.setDefaultTimeout(5000);
  const row = p
    .locator('.setting-item')
    .filter({ has: p.getByText('Global capture shortcut', { exact: true }) });
  const add = row.getByRole('button', { name: 'Customize global capture shortcut', exact: true });
  await add.click();
  await row.getByText('Press hotkey...', { exact: true }).waitFor();
  await p.screenshot({ path: 'artifacts/global-hotkey-recording.png' });
  assert.equal(
    await page.evaluate(
      (key) => require('@electron/remote').globalShortcut.isRegistered(key),
      baseline,
    ),
    false,
  );
  await p.keyboard.press('Escape');
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.globalCaptureHotkey),
    baseline,
  );
  await add.click();
  await p.keyboard.press('Meta+Shift+Y');
  await row.locator('.setting-hotkey:not(.mod-active)').waitFor();
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.globalCaptureHotkey),
    'Super+Shift+Y',
  );
  assert.equal(
    await page.evaluate(() =>
      require('@electron/remote').globalShortcut.isRegistered('Super+Shift+Y'),
    ),
    true,
  );
  assert.equal(await page.evaluate(() => !!app.plugins.getPlugin('thingsmd').captureModal), false);
  await p.screenshot({ path: 'artifacts/global-hotkey-native.png' });
  await row.getByRole('button', { name: 'Delete global capture hotkey', exact: true }).click();
  await row.getByText('Blank', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.globalCaptureHotkey),
    '',
  );
  await add.click();
  await p.keyboard.press('a');
  await row.getByRole('status').filter({ hasText: 'Include Command' }).waitFor();
  await p.keyboard.press('Escape');
  console.log(
    'PASS native-style recording, save without Apply, same-shortcut recording without opening capture, Escape restoration, delete, and invalid key feedback.',
  );
} finally {
  await page.evaluate(async (original) => {
    app.setting.close();
    await app.plugins.getPlugin('thingsmd').setGlobalCaptureHotkey(original);
  }, original);
  await browser.close();
}
