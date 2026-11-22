import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

if (process.argv.includes('--webkit')) {
  const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
  const results = [];
  for (const timezoneId of ['Europe/London', 'Europe/Berlin', 'America/Los_Angeles']) {
    const { browser, page } = await browserFixture({
      browserType: webkit,
      pageOptions: { timezoneId, viewport: { width: 390, height: 844 }, hasTouch: true },
    });
    try {
      results.push(
        await page.evaluate(async () => {
          const { plannedLogAt } = window.loadPluginModule('./tasks/archive-policy.cjs');
          const { startOfDay, dayKey } = window.loadPluginModule('./shared/vault-time.cjs');
          let saved = null;
          const plugin = {
            loadData: async () => saved,
            saveData: async (value) => {
              saved = value;
            },
          };
          const install = window.loadPluginModule('./settings/settings-service.cjs');
          await install(plugin);
          const initial = saved.timeZone;
          await plugin.persistSettings({ timeZone: 'Europe/Berlin' });
          await install(plugin);
          if (initial !== Intl.DateTimeFormat().resolvedOptions().timeZone)
            throw new Error('First setup did not capture the device time zone');
          return {
            timeZone: plugin.settings.timeZone,
            loggedAt: plannedLogAt(
              { completed: '2026-10-19T22:30:00Z' },
              'daily',
              plugin.settings.timeZone,
            ),
            created: startOfDay('2026-10-20', plugin.settings.timeZone),
            day: dayKey(new Date('2026-10-19T22:30:00Z'), plugin.settings.timeZone),
            dst: startOfDay('2026-03-09', 'America/New_York'),
          };
        }),
      );
    } finally {
      await browser.close();
    }
  }
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].loggedAt, '2026-10-20T22:00:00.000Z');
  assert.equal(results[0].created, '2026-10-19T22:00:00.000Z');
  assert.equal(results[0].dst, '2026-03-09T04:00:00.000Z');
  console.log(
    'PASS WebKit mobile fixture: first-setup default, saved zone, and identical planned timestamps across three device time zones.',
  );
} else {
  const { browser, page } = await connectTestVault();
  let original, wasMobile;
  const title = `Vault time ${Date.now()}`;
  const emulate = async (mobile) => {
    const origin = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate((mobile) => app.emulateMobile(mobile), mobile);
    await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
    await page.waitForFunction(
      () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd')?._loaded,
    );
  };
  try {
    original = await page.evaluate(() => ({ ...app.plugins.getPlugin('thingsmd').settings }));
    wasMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
    for (const mobile of [false, true]) {
      const firstDay = mobile ? 6 : 5;
      if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== mobile)
        await emulate(mobile);
      await page.setViewportSize({ width: mobile ? 390 : 1100, height: 844 });
      await page.evaluate(() => {
        app.setting.open();
        app.setting.openTabById('thingsmd');
      });
      const settings = await settingsPage(page);
      const selector = settings.getByLabel('Vault time zone', { exact: true });
      await selector.scrollIntoViewIfNeeded();
      const globalCapture = settings.getByText('Global capture shortcut', { exact: true });
      if (mobile) await globalCapture.waitFor({ state: 'detached' });
      else await globalCapture.waitFor({ state: 'visible' });
      const weekStart = settings.getByLabel('First day of the week', { exact: true });
      assert.deepEqual(
        await weekStart
          .locator('option')
          .evaluateAll((options) => options.map(({ value }) => value)),
        ['auto', '1', '0', '6', '5'],
      );
      assert.equal(
        await selector.evaluate((el) =>
          el
            .closest('.setting-item')
            .previousElementSibling.querySelector('select')
            ?.getAttribute('aria-label'),
        ),
        'First day of the week',
      );
      await weekStart.selectOption(String(firstDay));
      await waitForAsync(
        page,
        async (weekStartsOn) =>
          (await app.plugins.getPlugin('thingsmd').loadData()).weekStartsOn === weekStartsOn,
        firstDay,
      );
      assert.equal(
        await selector.evaluate(
          (el) =>
            el.closest('.setting-item') ===
            [...el.closest('.vertical-tab-content').querySelectorAll('.setting-item')]
              .filter(
                (item) =>
                  !item.closest('.ot-calendar-settings-section,.ot-conversion-settings-section'),
              )
              .at(-1),
        ),
        true,
      );
      for (const timeZone of ['Asia/Tokyo', 'UTC']) {
        await selector.selectOption(timeZone);
        await waitForAsync(
          page,
          async (timeZone) =>
            (await app.plugins.getPlugin('thingsmd').loadData()).timeZone === timeZone,
          timeZone,
        );
      }
      await settings.screenshot({
        path: `artifacts/vault-time-${mobile ? 'mobile' : 'desktop'}.png`,
      });
      await page.evaluate(async () => {
        app.setting.close();
        await app.plugins.disablePlugin('thingsmd');
        await app.plugins.enablePlugin('thingsmd');
      });
      assert.equal(
        await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.timeZone),
        'UTC',
      );
      assert.equal(
        await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.weekStartsOn),
        firstDay,
      );
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture({}));
      await page
        .locator('.ot-capture-modal')
        .getByRole('button', { name: 'When', exact: true })
        .click();
      const heading = page.locator('.ot-date-picker .ot-calendar-weekdays > :first-child');
      const expected = await page.evaluate((day) => {
        return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(
          new Date(2024, 0, 7 + day, 12),
        );
      }, firstDay);
      assert.equal(await heading.textContent(), expected);
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').captureModal?.close());
    }
    // Exercise the actual bundled storage path with a delayed scheduler and archive run.
    const result = await page.evaluate(async (title) => {
      const p = app.plugins.getPlugin('thingsmd');
      const template = await p.createTask({ title });
      await p.update(template.file, (current) => ({
        ...current,
        meta: {
          ...current.meta,
          repeat: {
            mode: 'completion',
            unit: 'day',
            interval: 1,
            anchor: '2099-10-20',
            next: '2099-10-20',
            on: [],
            end: null,
            deadline: false,
            leadDays: 0,
            epoch: 'timezone-test',
            paused: false,
            waitingFor: null,
            lastCopy: null,
          },
        },
      }));
      await p.repeating.tick(new Date('2099-10-20T00:00:45Z'));
      let copy = (await p.taskRecords()).find((t) => t.meta.repeatSource === template.meta.id);
      const created = copy.meta.created;
      await p.patchTask(copy, { status: 'done', completed: '2099-10-20T12:00:00Z' });
      await p.maintainArchives(new Date('2099-10-24T09:30:00Z'));
      copy = (await p.taskRecords()).find((t) => t.meta.id === copy.meta.id);
      return { created, loggedAt: copy.meta.loggedAt };
    }, title);
    assert.deepEqual(result, {
      created: '2099-10-20T00:00:00.000Z',
      loggedAt: '2099-10-21T00:00:00.000Z',
    });
    console.log(
      'PASS real Obsidian desktop/mobile emulation: general settings order, selection, persistence across reload, and planned timestamps through bundled task storage.',
    );
  } finally {
    await page.evaluate(
      async ({ title, original }) => {
        app.setting.close();
        const p = app.plugins.getPlugin('thingsmd');
        p.captureModal?.close();
        for (const task of await p.taskRecords())
          if (task.meta.title === title) await p.deleteTask(task.file);
        if (original) await p.updateSettings(original);
        await p.openList('inbox');
      },
      { title, original },
    );
    if (
      wasMobile !== undefined &&
      (await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== wasMobile
    )
      await emulate(wasMobile);
    await browser.close();
  }
}
