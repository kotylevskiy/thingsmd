import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
let path, original;
const title = `Settings ${Date.now()}`;
try {
  await page.evaluate(() => app.setting.close());
  ({ path, original } = await page.evaluate(async (title) => {
    const p = app.plugins.getPlugin('thingsmd');
    const original = { ...p.settings };
    const t = await p.createTask({ title, when: 'today', status: 'done' });
    app.setting.open();
    app.setting.openTabById(p.manifest.id);
    return { path: t.file.path, original };
  }, title));
  const settingsPage = await findSettingsPage(page);
  assert.equal(
    await settingsPage
      .locator('.vertical-tab-content .setting-item-name')
      .evaluateAll(
        (els) =>
          els.filter((el) => !el.closest('.ot-calendar-settings-section')).at(-1)?.textContent,
      ),
    'Vault time zone',
  );
  assert.equal(
    await settingsPage.getByLabel('Vault time zone', { exact: true }).inputValue(),
    original.timeZone,
  );
  await settingsPage.getByLabel('Vault time zone', { exact: true }).selectOption('UTC');
  await waitForAsync(
    page,
    async () => (await app.plugins.getPlugin('thingsmd').loadData())?.timeZone === 'UTC',
  );
  assert.equal(
    await settingsPage.getByLabel('Trash retention', { exact: true }).inputValue(),
    'never',
  );
  assert.deepEqual(
    await settingsPage
      .getByLabel('Trash retention', { exact: true })
      .locator('option')
      .allTextContents(),
    [
      'Never delete',
      '5 years',
      '3 years',
      '1 year',
      '3 months',
      '1 month',
      '1 week',
      'Delete permanently',
    ],
  );
  await settingsPage.getByLabel('Logbook frequency', { exact: true }).selectOption('manually');
  await waitForAsync(
    page,
    async () => (await app.plugins.getPlugin('thingsmd').loadData())?.logbook === 'manually',
  );
  await settingsPage.screenshot({ path: 'artifacts/archive-settings.png' });
  await page.evaluate(async () => {
    app.setting.close();
    const id = 'thingsmd';
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
    await app.plugins.getPlugin(id).openList('today');
  });
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.logbook),
    'manually',
  );
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.timeZone),
    'UTC',
  );
  const row = page.locator('.workspace-leaf.mod-active .ot-task').filter({ hasText: title });
  await row.waitFor();
  await row.click({ button: 'right' });
  await page.locator('.menu').getByText('Move to Logbook', { exact: true }).click();
  await row.waitFor({ state: 'hidden' });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('logbook'));
  await row.waitFor();
  await row.getByRole('button', { name: 'Restore', exact: true }).click();
  await row.waitFor({ state: 'hidden' });
  const meta = await page.evaluate(
    async (path) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.file.path === path)
        .meta,
    path,
  );
  assert.equal(meta.status, 'todo');
  assert.equal(meta.loggedAt, null);
  // Check hidden navigation synchronously without enabling real-vault cleanup.
  assert.equal(
    await page.evaluate(() => {
      const p = app.plugins.getPlugin('thingsmd'),
        old = p.settings.trashRetention;
      try {
        p.settings.trashRetention = 'immediately';
        p.mountListLinks();
        return getComputedStyle(document.querySelector('.ot-list-link[data-list="trash"]')).display;
      } finally {
        p.settings.trashRetention = old;
        p.mountListLinks();
      }
    }),
    'none',
  );
  console.log(
    'PASS: settings controls, saved frequency across reload, manual Move to Logbook, Restore resets logging, and hidden Trash navigation.',
  );
} finally {
  await page.evaluate(
    async ({ path, original }) => {
      app.setting.close();
      const p = app.plugins.getPlugin('thingsmd');
      if (path) await p.deleteTask(path);
      if (original) await p.updateSettings(original);
      await p.openList('inbox');
    },
    { path, original },
  );
  await browser.close();
}
