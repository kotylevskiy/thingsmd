import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { connectTestVault } from './obsidian-connection.mjs';

const fixture = process.argv.includes('--fixture');
const browserType =
  process.env.THINGSMD_TEST_BROWSER === 'webkit'
    ? (await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core')).webkit
    : undefined;
const { browser, page } = fixture
  ? await browserFixture({ browserType })
  : await connectTestVault();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const prefix = `Date picker ${Date.now()}`;
const wasMobile = !fixture && (await page.evaluate(() => !!localStorage.getItem('EmulateMobile')));
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd'),
    undefined,
    { timeout: 20000 },
  );
const capture = page.locator('.ot-capture-modal');
const picker = page.locator('.ot-date-picker');
async function open(kind) {
  await capture.getByRole('button', { name: kind, exact: true }).click();
  await picker.waitFor();
}
async function input(kind) {
  const field = picker.getByLabel(`${kind} date`, { exact: true });
  if (!(await field.isVisible())) await picker.getByLabel('Search dates', { exact: true }).click();
  return field;
}
async function setDate(kind, text) {
  const field = await input(kind);
  await field.fill(text);
  await field.press('Enter');
  await picker.waitFor({ state: 'detached' });
}
try {
  if (fixture)
    await page.addStyleTag({
      content:
        ':root{--background-primary:#fff;--text-normal:#222;--text-muted:#777;--text-faint:#999;--background-modifier-border:#ddd;--background-modifier-border-hover:#ccc;--background-modifier-hover:#eee;--interactive-accent:#8b68db;--text-on-accent:#fff}body{font-family:system-ui,sans-serif}',
    });
  if (fixture)
    await page.evaluate(() => {
      const Capture = window.loadPluginModule('./task-capture.cjs');
      window.pickerPlugin = {
        app: { workspace: {} },
        captureDestination: async () => null,
        createTask: async (meta, id, body) => ({ meta, body }),
      };
      window.capturePicker = () => {
        const modal = new Capture(window.pickerPlugin, {});
        window.pickerPlugin.captureModal = modal;
        modal.open();
      };
    });
  for (const mobile of [false, true]) {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1100, height: 850 });
    if (fixture)
      await page.evaluate((mobile) => document.body.classList.toggle('is-mobile', mobile), mobile);
    else {
      if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== mobile)
        await page.evaluate((mobile) => app.emulateMobile(mobile), mobile);
      await ready();
    }
    await page.evaluate(
      ({ fixture }) =>
        fixture ? window.capturePicker() : app.plugins.getPlugin('thingsmd').capture({}),
      { fixture },
    );
    await capture.getByLabel('Task title', { exact: true }).fill(prefix);
    await open('When');
    assert.ok(await picker.evaluate((el) => el.classList.contains('is-compact-calendar')));
    for (const label of ['Tomorrow', 'Next week', 'Anytime'])
      assert.equal(await picker.getByRole('button', { name: label, exact: true }).count(), 0);
    assert.equal(await picker.getByLabel('When date').isVisible(), !mobile);
    if (mobile)
      assert.equal(
        await page.evaluate(() => document.activeElement.tagName === 'INPUT'),
        false,
        'Opening calendar does not summon the keyboard',
      );
    if (mobile) {
      await picker
        .locator('.ot-date-header')
        .dispatchEvent('pointerdown', { clientX: 100, clientY: 70, pointerType: 'touch' });
      await picker.dispatchEvent('pointerup', { clientX: 100, clientY: 120, pointerType: 'touch' });
      assert.ok(await picker.getByLabel('When date').isVisible(), 'Pulling down reveals search');
    }
    assert.ok(
      await picker
        .locator(
          '.ot-calendar-day[aria-current="date"] svg, .ot-calendar-day[aria-current="date"][data-icon="star"]',
        )
        .count(),
    );
    await picker.getByLabel('Show full calendar').click();
    assert.equal((await picker.locator('.ot-calendar-boundary').count()) > 4, true);
    const scrolled = await picker.locator('.ot-calendar-scroll').evaluate((el) => {
      el.scrollTop = 200;
      return el.scrollHeight > el.clientHeight && el.scrollTop > 0;
    });
    assert.ok(scrolled, 'Later weeks scroll across months');
    const firstDate = () => picker.locator('[data-date]').first().getAttribute('data-date');
    const before = await firstDate();
    await picker.locator('.ot-calendar-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForFunction(
      (before) => document.querySelector('.ot-date-picker [data-date]').dataset.date < before,
      before,
    );
    const earlier = await firstDate();
    await picker.locator('.ot-calendar-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForFunction(
      (earlier) => document.querySelector('.ot-date-picker [data-date]').dataset.date > earlier,
      earlier,
    );
    assert.equal(
      await picker.locator('[data-date]').count(),
      182,
      'Continuous scrolling keeps a bounded calendar',
    );
    for (let i = 0; i < 3; i++) {
      const before = await firstDate();
      await picker.locator('.ot-calendar-scroll').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForFunction(
        (before) => document.querySelector('.ot-date-picker [data-date]').dataset.date > before,
        before,
      );
      assert.equal(
        await picker.locator('.ot-calendar-day[tabindex="0"]').count(),
        1,
        'Later months retain a keyboard entry point',
      );
    }
    const field = await input('When');
    await field.fill('in3');
    assert.equal(await picker.locator('.ot-date-match').count(), 3);
    assert.equal(await picker.locator('.ot-date-body').isVisible(), false);
    await field.press('ArrowDown');
    assert.equal(
      await picker
        .locator('.ot-date-match')
        .nth(1)
        .evaluate((el) => el.classList.contains('is-active')),
      true,
    );
    await picker.getByLabel('Clear search').click();
    assert.equal(await field.inputValue(), '');
    assert.equal(await picker.locator('.ot-date-body').isVisible(), true);
    await field.fill('2099-06-15');
    await field.press('Enter');
    await open('When');
    assert.equal(
      await picker.locator('[data-date="2099-06-15"]').getAttribute('aria-pressed'),
      'true',
    );
    await (await input('When')).fill('2027-02-29');
    await (await input('When')).press('Enter');
    assert.equal(await picker.getByLabel('When date').getAttribute('aria-invalid'), 'true');
    await picker.getByLabel('Clear search').click();
    assert.equal(
      await picker.locator('[data-date="2099-06-15"]').getAttribute('aria-pressed'),
      'true',
      'Clearing query preserves scheduling',
    );
    if (mobile) await picker.getByLabel('Cancel date selection').click();
    else await page.keyboard.press('Escape');
    assert.ok(await capture.isVisible(), 'Dismissing picker preserves capture draft');
    await open('Deadline');
    assert.equal(await picker.locator('.ot-date-shortcut').count(), 0);
    assert.equal(
      await picker.evaluate((el) => el.classList.contains('is-compact-calendar')),
      false,
    );
    await setDate('Deadline', '2099-06-20');
    await open('Deadline');
    await picker.getByLabel('Remove deadline').click();
    await open('When');
    // A centered mobile picker can cover its toolbar; keyboard activation also
    // checks that toggling the original control closes rather than reopens it.
    if (await page.locator('.ot-date-layer').count()) await page.keyboard.press('Escape');
    else if (mobile)
      await capture.getByRole('button', { name: 'When', exact: true }).press('Space');
    else await capture.getByRole('button', { name: 'When', exact: true }).click();
    await picker.waitFor({ state: 'detached' });
    await open('When');
    if (mobile) {
      // Overlay keyboard: only the visible viewport shrinks, as on iOS.
      await page.evaluate(() => {
        window.pickerViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
        const viewport = new EventTarget();
        Object.assign(viewport, { height: 300, width: innerWidth, offsetTop: 30, offsetLeft: 0 });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        dispatchEvent(new Event('resize'));
      });
      const field = await input('When');
      await field.fill('tomorrow');
      await picker.locator('.ot-date-match').waitFor();
      await picker.evaluate(
        (el) =>
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const bounds = await picker.boundingBox();
      assert.ok(bounds.y >= 30 && bounds.y + bounds.height <= 330, JSON.stringify(bounds));
      await page.screenshot({
        path: `artifacts/date-picker-${fixture ? browserType?.name() || 'chromium' : 'obsidian'}-keyboard.png`,
      });
      await field.press('Enter');
      await page.evaluate(() => {
        if (window.pickerViewport)
          Object.defineProperty(window, 'visualViewport', window.pickerViewport);
        else delete window.visualViewport;
        delete window.pickerViewport;
        dispatchEvent(new Event('resize'));
      });
    } else {
      await setDate('When', 'tomorrow');
    }
    await open('When');
    await picker.getByLabel('Clear schedule').click();
    await open('When');
    await page.screenshot({
      path: `artifacts/date-picker-${fixture ? browserType?.name() || 'chromium' : 'obsidian'}-${mobile ? 'mobile' : 'desktop'}.png`,
    });
    await page.mouse.click(2, 2);
    assert.equal(await picker.count(), 0);
    assert.ok(await capture.isVisible());
    const values = await page.evaluate(
      ({ fixture }) =>
        (fixture ? window.pickerPlugin : app.plugins.getPlugin('thingsmd')).captureModal.card
          .taskDraft.values,
      { fixture },
    );
    assert.equal(values.when, 'anytime');
    assert.equal(values.deadline, null);
    assert.equal(values.title, prefix);
    await capture.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.locator('.ot-date-layer').count(), 0, 'Fallback layer is cleaned up');
    assert.deepEqual(errors, [], 'No date-picker runtime errors');
    console.log(
      `PASS date picker: ${mobile ? 'mobile' : 'desktop'} shortcuts, scrolling calendar, search, selection, clear, cancel, keyboard and outside dismissal`,
    );
  }
} finally {
  await page.evaluate(
    ({ fixture }) => {
      if (window.pickerViewport) {
        Object.defineProperty(window, 'visualViewport', window.pickerViewport);
        delete window.pickerViewport;
      }
      (fixture
        ? window.pickerPlugin
        : window.app?.plugins.getPlugin('thingsmd')
      )?.captureModal?.close();
    },
    { fixture },
  );
  if (!fixture) {
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== wasMobile)
      await page.evaluate((mobile) => app.emulateMobile(mobile), wasMobile);
    await ready();
  }
  await browser.close();
}
