import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const fixture = process.argv.includes('--fixture');
const browserType =
  process.env.THINGSMD_TEST_BROWSER === 'webkit'
    ? (await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core')).webkit
    : undefined;
const { browser, page } = fixture
  ? await browserFixture({ browserType, pageOptions: { hasTouch: true } })
  : await connectTestVault();
page.setDefaultTimeout(10000);
const label = 'Use task actions in mobile navigation';
const prefix = `Mobile navigation ${Date.now()}`;
const nav = page.locator('.mobile-navbar');
const create = nav.locator('.mobile-navbar-action-new-tab');
const search = nav.locator('.mobile-navbar-action-quick-switcher');
const checkSearchIcon = async () => {
  assert.equal(
    await search
      .locator('.clickable-icon')
      .evaluate(
        (element) =>
          element.dataset.icon === 'thingsmd-task-search' ||
          !!element.querySelector('svg.thingsmd-task-search'),
      ),
    true,
    'Search uses the task-search icon',
  );
};
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let original, wasMobile, touch;
const snapshot = () =>
  nav.evaluate((root) =>
    [...root.querySelectorAll('.mobile-navbar-action')].map((action) => {
      const copy = action.cloneNode(true);
      // The host adds transient touch feedback independently of this plugin.
      copy
        .querySelectorAll('.mobile-tap')
        .forEach((element) => element.classList.remove('mobile-tap'));
      return {
        className: copy.className,
        attributes: ['aria-label', 'title', 'role', 'tabindex'].map((name) =>
          copy.getAttribute(name),
        ),
        html: copy.innerHTML,
      };
    }),
  );
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
async function mobile(value) {
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) === value) return;
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await ready();
}
async function toggle(value) {
  await page.evaluate(
    ({ fixture, value }) => {
      if (fixture) {
        window.mobileNavPlugin.settings.mobileTaskNavigation = value;
        window.mobileNavPlugin.refreshMobileNavigation();
      } else
        return app.plugins.getPlugin('thingsmd').updateSettings({ mobileTaskNavigation: value });
    },
    { fixture, value },
  );
}
async function tap(control) {
  if (fixture) return control.tap();
  await page.waitForFunction(
    (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    },
    await control.evaluate((element) => '.' + [...element.classList].join('.')),
  );
  const box = await control.boundingBox();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
try {
  await page.setViewportSize({ width: 390, height: 844 });
  if (fixture) {
    await page.addStyleTag({
      content:
        '.mobile-navbar-actions{display:flex}.mobile-navbar-action{width:50px;height:44px}.mobile-navbar-action .clickable-icon{display:block;width:100%;height:100%}',
    });
    await page.evaluate(() => {
      const host = window.loadPluginModule('obsidian');
      host.Platform.isMobile = true;
      window.mobileNavCalls = { create: 0, search: 0, native: 0, touch: 0 };
      window.buildMobileNav = () => {
        document.querySelector('.mobile-navbar')?.remove();
        const bar = document.body.createDiv('mobile-navbar').createDiv('mobile-navbar-actions');
        for (const name of ['back', 'forward', 'quick-switcher', 'new-tab', 'tabs', 'menu']) {
          const action = bar.createDiv(`mobile-navbar-action mobile-navbar-action-${name}`);
          action.setAttribute('aria-label', `Host ${name}`);
          action.createSpan('clickable-icon').textContent = name;
          action.onclick = () => window.mobileNavCalls.native++;
          action.addEventListener('touchstart', () => window.mobileNavCalls.touch++);
        }
      };
      window.buildMobileNav();
      const callbacks = [];
      window.mobileNavPlugin = {
        settings: { mobileTaskNavigation: false },
        app: { workspace: { onLayoutReady: (callback) => callback() } },
        register: (callback) => callbacks.push(callback),
        capture: () => {
          window.mobileNavCalls.create++;
        },
        openSearch: async () => {
          window.mobileNavCalls.search++;
        },
      };
      window.unloadMobileNav = () => callbacks.splice(0).forEach((callback) => callback());
      window.loadPluginModule('./mobile-navigation.cjs')(window.mobileNavPlugin);
    });
  } else {
    original = await page.evaluate(() => ({ ...app.plugins.getPlugin('thingsmd').settings }));
    wasMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
    await toggle(false);
    await mobile(true);
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('inbox'));
    await page.evaluate(() => app.workspace.leftSplit.collapse());
    touch = await page.context().newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  }
  await nav.waitFor();
  const baseline = await snapshot();
  assert.notEqual(await create.getAttribute('aria-label'), 'New task', 'Disabled by default');
  if (fixture) {
    await tap(create);
    assert.equal(await page.evaluate(() => window.mobileNavCalls.native), 1);
    await page.evaluate(() => {
      window.mobileNavCalls.native = 0;
      window.mobileNavCalls.touch = 0;
    });
    await toggle(true);
  } else {
    await page.evaluate(() => {
      app.setting.open();
      app.setting.openTabById('thingsmd');
    });
    const settings = await settingsPage(page);
    await settings.getByLabel(label, { exact: true }).click();
    await waitForAsync(
      page,
      async () =>
        (await app.plugins.getPlugin('thingsmd').loadData())?.mobileTaskNavigation === true,
    );
    await page.evaluate(() => app.setting.close());
  }
  await page.waitForFunction(
    () =>
      document.querySelector('.mobile-navbar-action-new-tab')?.getAttribute('aria-label') ===
      'New task',
  );
  assert.equal(await search.getAttribute('aria-label'), 'Search Tasks');
  await checkSearchIcon();
  const unchanged = (await snapshot()).filter(
    (action) => !/mobile-navbar-action-(new-tab|quick-switcher)/.test(action.className),
  );
  assert.deepEqual(
    unchanged,
    baseline.filter(
      (action) => !/mobile-navbar-action-(new-tab|quick-switcher)/.test(action.className),
    ),
    'Back, Forward, Tabs and Menu stay unchanged',
  );
  const beforeCapture =
    !fixture &&
    (await page.evaluate(() => ({
      leaves: app.workspace.getLeavesOfType('empty').length,
      notes: app.vault
        .getMarkdownFiles()
        .map((file) => file.path)
        .sort(),
    })));
  await tap(create);
  if (fixture) {
    await page.waitForFunction(() => window.mobileNavCalls.create === 1);
    assert.deepEqual(
      await page.evaluate(() => [window.mobileNavCalls.native, window.mobileNavCalls.touch]),
      [0, 0],
      'Host tap and long-press handlers are suppressed',
    );
    await search.press('Enter');
    await page.waitForFunction(() => window.mobileNavCalls.search === 1);
    await create.press('Space');
    await page.waitForFunction(() => window.mobileNavCalls.create === 2);
    await tap(search);
    await page.waitForFunction(() => window.mobileNavCalls.search === 2);
    await page.evaluate(() => window.buildMobileNav());
    await page.waitForFunction(
      () =>
        document.querySelector('.mobile-navbar-action-new-tab')?.getAttribute('aria-label') ===
        'New task',
    );
    await tap(create);
    await page.waitForFunction(() => window.mobileNavCalls.create === 3);
    await checkSearchIcon();
  } else {
    const capture = page.locator('.ot-capture-modal');
    await capture.waitFor();
    assert.equal(await capture.count(), 1);
    await capture.getByLabel('Task title', { exact: true }).fill(prefix);
    await capture.getByRole('button', { name: 'Save', exact: true }).click();
    await capture.waitFor({ state: 'detached' });
    const after = await page.evaluate(
      async (prefix) => ({
        leaves: app.workspace.getLeavesOfType('empty').length,
        notes: app.vault
          .getMarkdownFiles()
          .map((file) => file.path)
          .sort(),
        tasks: (await app.plugins.getPlugin('thingsmd').taskRecords())
          .filter((task) => task.meta.title === prefix)
          .map((task) => task.file.path),
      }),
      prefix,
    );
    assert.equal(after.tasks.length, 1);
    assert.equal(after.leaves, beforeCapture.leaves, 'No native New tab action');
    assert.deepEqual(
      after.notes,
      [...beforeCapture.notes, ...after.tasks].sort(),
      'Only the task note was created',
    );
    await tap(search);
    const find = page.locator('.ot-search-modal');
    await find.getByLabel('Quick Find', { exact: true }).fill(prefix);
    await find.locator('.ot-search-result').filter({ hasText: prefix }).waitFor();
    await page.keyboard.press('Escape');
    await find.waitFor({ state: 'detached' });
    await create.press('Enter');
    await capture.waitFor();
    await capture.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await ready();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.mobile-navbar-action-quick-switcher')
          ?.getAttribute('aria-label') === 'Search Tasks',
    );
    assert.equal(
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.mobileTaskNavigation),
      true,
    );
    await tap(search);
    await find.waitFor();
    await checkSearchIcon();
    await page.keyboard.press('Escape');
    await find.waitFor({ state: 'detached' });
  }
  await toggle(false);
  const restored = await snapshot();
  assert.deepEqual(
    restored.filter((action) =>
      /mobile-navbar-action-(new-tab|quick-switcher)/.test(action.className),
    ),
    baseline.filter((action) =>
      /mobile-navbar-action-(new-tab|quick-switcher)/.test(action.className),
    ),
    'Disabling restores the original DOM attributes and content',
  );
  await toggle(true);
  await page.evaluate(
    (fixture) => (fixture ? window.unloadMobileNav() : app.plugins.disablePlugin('thingsmd')),
    fixture,
  );
  assert.notEqual(
    await create.getAttribute('aria-label'),
    'New task',
    'Unload restores host actions',
  );
  if (fixture) {
    await tap(create);
    assert.equal(await page.evaluate(() => window.mobileNavCalls.native), 1);
    await tap(search);
    assert.equal(await page.evaluate(() => window.mobileNavCalls.native), 2);
    // Desktop must remain untouched even when the saved preference is enabled.
    await page.evaluate(() => {
      window.loadPluginModule('obsidian').Platform.isMobile = false;
      window.loadPluginModule('./mobile-navigation.cjs')(window.mobileNavPlugin);
    });
    assert.notEqual(await create.getAttribute('aria-label'), 'New task');
  } else {
    await tap(search);
    await page.locator('.prompt-input').waitFor();
    assert.equal(
      await page.locator('.ot-search-modal').count(),
      0,
      'Original Quick switcher restored',
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() => app.plugins.enablePluginAndSave('thingsmd'));
    await ready();
    await page.waitForFunction(
      () =>
        document.querySelector('.mobile-navbar-action-new-tab')?.getAttribute('aria-label') ===
        'New task',
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS mobile navigation ${fixture ? browserType?.name() || 'chromium fixture' : 'real Obsidian mobile emulation'}: default-off, opt-in, touch/keyboard, task capture/search, reload/rebuild, disable/unload restoration, untouched other actions.`,
  );
} catch (error) {
  console.error(error);
  if (!fixture) {
    console.log(
      await page.evaluate(() => ({
        capture: !!app.plugins.getPlugin('thingsmd')?.captureModal,
        labels: [...document.querySelectorAll('.mobile-navbar-action')].map((element) =>
          element.getAttribute('aria-label'),
        ),
        modals: [...document.querySelectorAll('.modal')].map((el) => el.className),
      })),
    );
    await page.screenshot({ path: 'artifacts/mobile-navigation-failure.png' });
  }
  throw error;
} finally {
  if (fixture) await page.evaluate(() => window.unloadMobileNav?.());
  else {
    await page.evaluate(
      async ({ original, prefix }) => {
        app.setting.close();
        if (!app.plugins.getPlugin('thingsmd')) await app.plugins.enablePluginAndSave('thingsmd');
        const plugin = app.plugins.getPlugin('thingsmd');
        plugin.captureModal?.close();
        plugin.searchModal?.close();
        if (original) await plugin.updateSettings(original);
        await plugin.openList('inbox');
        for (const task of await plugin.taskRecords())
          if (task.meta.title.startsWith(prefix)) await plugin.deleteTask(task.file);
      },
      { original, prefix },
    );
    await touch?.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await touch?.detach();
    if (wasMobile !== undefined) await mobile(wasMobile);
  }
  await browser.close();
}
