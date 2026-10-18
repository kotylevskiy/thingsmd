import assert from 'node:assert/strict';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { browserFixture } from './browser-fixture.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const fixture = process.argv.includes('--fixture');
const { browser, page } = fixture
  ? await browserFixture({
      browserType: (await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core'))
        .webkit,
    })
  : await connectTestVault();
let original;
let wasMobile;
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
async function mobile(value) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await ready();
}
try {
  if (fixture) {
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="setting-item ot-dependent-setting"><div class="setting-item-info">Group waiting tasks in Today</div><div class="setting-item-control"><input type="checkbox"></div></div><div class="setting-item">Unrelated setting</div>',
      );
    });
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const row = page.locator('.ot-dependent-setting');
      await row.evaluate((el) => el.classList.add('is-disabled'));
      assert.equal(await row.evaluate((el) => getComputedStyle(el).opacity), '0.5');
      await row.evaluate((el) => el.classList.remove('is-disabled'));
      assert.equal(await row.evaluate((el) => getComputedStyle(el).opacity), '1');
      assert.equal(
        await page
          .locator('.setting-item')
          .last()
          .evaluate((el) => getComputedStyle(el).opacity),
        '1',
      );
    }
    console.log('PASS WebKit CSS fixture: dependent setting dims at desktop/mobile widths.');
  } else {
    original = await page.evaluate(() => ({ ...app.plugins.getPlugin('thingsmd').settings }));
    wasMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
    for (const isMobile of [false, true]) {
      if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== isMobile)
        await mobile(isMobile);
      await page.setViewportSize({ width: isMobile ? 390 : 1100, height: 844 });
      await page.evaluate(async () => {
        await app.plugins.getPlugin('thingsmd').updateSettings({
          enableWaiting: true,
          showWaitingInToday: true,
        });
        app.setting.open();
        app.setting.openTabById('thingsmd');
      });
      const settings = await settingsPage(page);
      const grouping = settings.getByLabel('Group waiting tasks in Today', { exact: true });
      const opacity = () =>
        grouping.evaluate((el) => getComputedStyle(el.closest('.setting-item')).opacity);
      assert.equal(await opacity(), '1');
      for (const enabled of [false, true]) {
        await settings.getByLabel('Enable Waiting For', { exact: true }).click();
        await waitForAsync(
          page,
          async (enabled) =>
            (await app.plugins.getPlugin('thingsmd').loadData()).enableWaiting === enabled,
          enabled,
        );
        await settings.waitForFunction((enabled) => {
          const el = document.querySelector('[aria-label="Group waiting tasks in Today"]');
          return el && el.classList.contains('is-disabled') === !enabled;
        }, enabled);
        assert.equal(await opacity(), enabled ? '1' : '0.5');
        if (!enabled) await grouping.click();
        assert.equal(
          await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.showWaitingInToday),
          true,
        );
      }
      await page.evaluate(() => app.setting.close());
    }
    console.log(
      'PASS real Obsidian desktop/mobile emulation: disabled appearance, interaction blocked, re-enabled preference preserved.',
    );
  }
} finally {
  if (!fixture && original) {
    await page.evaluate(async (original) => {
      app.setting.close();
      await app.plugins.getPlugin('thingsmd').updateSettings(original);
    }, original);
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== wasMobile)
      await mobile(wasMobile);
  }
  await browser.close();
}
