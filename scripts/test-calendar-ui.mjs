import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
let version = 1,
  status = 200,
  responseDelay = 0;
const requests = [];
const day = new Date();
const date = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
const text = () =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'NAME:Created calendar',
    'X-WR-CALNAME:Fallback name',
    'COLOR:tomato',
    'X-APPLE-CALENDAR-COLOR:#00fdff',
    'PRODID:-//ThingsMD UI tests//EN',
    'BEGIN:VEVENT',
    'UID:all-day',
    `DTSTART;VALUE=DATE:${date}`,
    'SUMMARY:All-day fixture',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:timed',
    `DTSTART:${date}T103000`,
    'DURATION:PT1H',
    `SUMMARY:Timed fixture ${version}`,
    'LOCATION:Test room',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
const server = createServer(async (req, res) => {
  requests.push(req.headers);
  if (req.url === '/not-calendar') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>Not a calendar</html>');
    return;
  }
  if (responseDelay) await new Promise((resolve) => setTimeout(resolve, responseDelay));
  if (status !== 200) {
    res.writeHead(status, { 'Retry-After': '0' });
    res.end();
    return;
  }
  const etag = `"${version}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/calendar', ETag: etag });
  res.end(text());
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
const id = `calendar-ui-${Date.now()}`;
const { browser, page } = await connectTestVault();
let taskPath, previous, created, previousMobile;
const cdp = await page.context().newCDPSession(page);
async function calendarDialog(selector) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    for (const candidate of page.context().pages()) {
      const dialog = candidate.locator(selector);
      if (await dialog.isVisible()) {
        await candidate.bringToFront();
        return dialog;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Calendar dialog did not open: ${selector}`);
}
async function emulateMobile(value) {
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) === value) return;
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && window.app.plugins?.getPlugin('thingsmd')?._loaded,
  );
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && window.app.plugins?.getPlugin('thingsmd')?._loaded,
  );
}

try {
  previousMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
  await emulateMobile(false);
  await page.evaluate(() => app.setting.close());
  await page.setViewportSize({ width: 1200, height: 900 });
  previous = await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.calendars);
  await page.evaluate(
    async ({ id, url }) => {
      app.secretStorage.setSecret(id, url);
      const plugin = app.plugins.getPlugin('thingsmd');
      await plugin.updateSettings({
        calendars: [{ id, name: 'UI calendar', secretName: id, enabled: true, refreshMinutes: 15 }],
      });
      await plugin.calendar.refreshAll(true);
      await plugin.openList('today');
    },
    { id, url },
  );
  await page.locator('.ot-calendar-title').filter({ hasText: 'Timed fixture 1' }).waitFor();
  assert.equal(await page.locator('.ot-calendar-event').count(), 2);
  assert.equal(await page.locator('.ot-calendar input[type=checkbox]').count(), 0);
  assert.equal(
    await page.locator('.ot-calendar-time.is-all-day').getAttribute('data-quiet-label'),
    'All day',
  );
  assert.equal(await page.locator('.ot-calendar h2, .ot-calendar-meta').count(), 0);
  const refresh = page.getByRole('button', { name: 'Refresh calendars', exact: true });
  assert.equal(await refresh.innerText(), '');
  assert.equal(await refresh.locator('svg').count(), 1);
  const compact = await page.locator('.ot-calendar').evaluate((el) => {
    const button = getComputedStyle(el.querySelector('.ot-calendar-refresh'));
    const capture = getComputedStyle(document.querySelector('.ot-capture'));
    return {
      heights: [...el.querySelectorAll('.ot-calendar-event')].map(
        (row) => row.getBoundingClientRect().height,
      ),
      background: button.backgroundColor,
      shadow: button.boxShadow,
      matchingColor: button.color === capture.color,
      tooltipAttributes: el.querySelectorAll('[title], [aria-label]').length,
    };
  });
  assert.ok(compact.heights.every((height) => height <= 24));
  assert.equal(compact.background, 'rgba(0, 0, 0, 0)');
  assert.equal(compact.shadow, 'none');
  assert.equal(compact.matchingColor, true);
  assert.equal(compact.tooltipAttributes, 0);
  for (const target of [
    page.locator('.ot-calendar-event').first(),
    page.locator('.ot-calendar-time').first(),
    refresh,
  ]) {
    await target.hover();
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.tooltip:visible').count(), 0);
  }
  const requestCount = requests.length;
  responseDelay = 1200;
  await refresh.focus();
  await page.keyboard.press('Enter');
  await page.locator('.ot-calendar-refresh.is-refreshing').waitFor();
  assert.equal(await refresh.isDisabled(), true);
  assert.equal(await refresh.getAttribute('aria-busy'), 'true');
  assert.equal(
    await refresh.locator('svg').evaluate((el) => getComputedStyle(el).animationName),
    'ot-calendar-refresh-spin',
  );
  await waitForAsync(page, () => !app.plugins.getPlugin('thingsmd').calendar.pending.size);
  responseDelay = 0;
  assert.equal(await refresh.getAttribute('aria-busy'), 'false');
  assert.equal(
    await refresh.locator('svg').evaluate((el) => getComputedStyle(el).animationName),
    'none',
  );
  assert.ok(requests.length > requestCount, 'Icon refresh remains keyboard operable');
  assert.ok(requests.some((r) => r['if-none-match'] === '"1"'));
  const cached = () =>
    page.evaluate(
      (id) =>
        app.vault.getFiles().filter((f) => f.path.startsWith(`ThingsMD Calendars/${id}/`)).length,
      id,
    );
  assert.equal(await cached(), 1);
  const persisted = await page.evaluate(() => app.plugins.getPlugin('thingsmd').loadData());
  assert.ok(!JSON.stringify(persisted).includes(url));
  // Calendar controls sit at the end, with no editable subscription URL.
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const settings = await settingsPage(page);
  await settings.bringToFront();
  await settings.locator('.ot-calendar-settings-section').waitFor();
  assert.equal(
    await settings
      .locator('.ot-calendar-settings-section')
      .evaluate((el) => el === el.parentElement.lastElementChild),
    true,
  );
  assert.equal(await settings.locator('.ot-calendar-settings-row input[type=password]').count(), 0);
  assert.equal(
    await settings.getByRole('button', { name: 'Add calendar', exact: true }).count(),
    1,
  );
  const addCalendar = settings.getByRole('button', { name: 'Add calendar', exact: true });
  assert.equal(await addCalendar.innerText(), 'Add calendar');
  assert.equal(await addCalendar.locator('svg').count(), 0);
  assert.equal(
    await settings
      .locator('.ot-calendar-settings-header button, .ot-calendar-settings-header [role=button]')
      .count(),
    0,
  );
  assert.equal(
    await settings.locator('.ot-calendar-settings-section').evaluate((el) => {
      const add = el.querySelector('.ot-calendar-add');
      const rows = el.querySelectorAll('.ot-calendar-settings-row');
      return (
        el.lastElementChild === add &&
        !add.classList.contains('setting-item') &&
        getComputedStyle(add).backgroundColor === 'rgba(0, 0, 0, 0)' &&
        Math.abs(
          add.getBoundingClientRect().right -
            add.querySelector('button').getBoundingClientRect().right,
        ) < 1 &&
        add.getBoundingClientRect().top >= rows[rows.length - 1].getBoundingClientRect().bottom
      );
    }),
    true,
  );

  await addCalendar.focus();
  await addCalendar.press('Enter');
  let dialog = await calendarDialog('.ot-calendar-create');
  assert.equal(await dialog.getByLabel('Calendar name', { exact: true }).count(), 0);
  let subscription = dialog.getByLabel('Subscription URL', { exact: true });
  await subscription.fill('not-a-url');
  await dialog.getByRole('button', { name: 'Add calendar', exact: true }).click();
  await dialog
    .getByRole('alert')
    .filter({ hasText: 'Invalid calendar subscription URL' })
    .waitFor();
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.calendars.length),
    1,
  );
  await subscription.fill(url.replace('/calendar.ics', '/not-calendar'));
  await dialog.getByRole('button', { name: 'Add calendar', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Unable to load a valid ICS' }).waitFor();
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.calendars.length),
    1,
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await addCalendar.click();
  dialog = await calendarDialog('.ot-calendar-create');
  subscription = dialog.getByLabel('Subscription URL', { exact: true });
  assert.equal(await dialog.getByLabel('Calendar name', { exact: true }).count(), 0);
  await subscription.fill(url);
  await dialog.getByRole('button', { name: 'Add calendar', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await waitForAsync(page, () =>
    app.plugins.getPlugin('thingsmd').settings.calendars.some((c) => c.name === 'Created calendar'),
  );
  created = await page.evaluate(() =>
    app.plugins.getPlugin('thingsmd').settings.calendars.find((c) => c.name === 'Created calendar'),
  );
  assert.ok(created);
  assert.equal(
    await page.evaluate(
      ({ created, url }) => app.secretStorage.getSecret(created.secretName) === url,
      { created, url },
    ),
    true,
  );
  assert.ok(
    !JSON.stringify(
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').loadData()),
    ).includes(url),
  );
  assert.equal(await settings.locator('.ot-calendar-settings-row input[type=password]').count(), 0);
  await settings
    .locator('.ot-calendar-settings-row')
    .last()
    .getByRole('button', { name: 'Remove calendar', exact: true })
    .click();
  await waitForAsync(page, () => app.plugins.getPlugin('thingsmd').settings.calendars.length === 1);
  await settings.waitForFunction(
    () => document.querySelectorAll('.ot-calendar-settings-row').length === 1,
  );
  const calendarRow = settings.locator('.ot-calendar-settings-row');
  const centered = (el) => {
    const centers = [
      '.setting-item-name',
      '.ot-calendar-color-dot',
      '.checkbox-container',
      '.ot-calendar-row-action',
      '.ot-calendar-remove',
    ].map((selector) => {
      const rect = el.querySelector(selector).getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    return Math.max(...centers) - Math.min(...centers) < 1;
  };
  assert.equal(await calendarRow.evaluate(centered), true, 'Calendar row centers align');
  const visibility = calendarRow.getByLabel('Show in Today', { exact: true });
  const gear = calendarRow.getByRole('button', { name: 'Configure calendar', exact: true });
  const trash = calendarRow.getByRole('button', { name: 'Remove calendar', exact: true });
  await settings.locator('.ot-calendar-settings-header').hover();
  const neutralColor = await gear.evaluate((el) => getComputedStyle(el).color);
  assert.equal(await trash.evaluate((el) => getComputedStyle(el).color), neutralColor);
  assert.equal(
    await trash.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await trash.hover();
  const hoverTheme = await trash.evaluate((el) => {
    const names = ['--background-modifier-error', '--text-on-accent'];
    const before = names.map((name) => [
      name,
      el.style.getPropertyValue(name),
      el.style.getPropertyPriority(name),
    ]);
    el.style.setProperty(names[0], '#d12345');
    el.style.setProperty(names[1], '#fefefe');
    const style = getComputedStyle(el);
    const result = { background: style.backgroundColor, color: style.color };
    for (const [name, value, priority] of before) {
      if (value) el.style.setProperty(name, value, priority);
      else el.style.removeProperty(name);
    }
    return result;
  });
  assert.deepEqual(hoverTheme, { background: 'rgb(209, 35, 69)', color: 'rgb(254, 254, 254)' });
  await settings.locator('.ot-calendar-settings-header').hover();
  assert.equal(await trash.evaluate((el) => getComputedStyle(el).color), neutralColor);
  assert.equal(
    await trash.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );

  for (const button of [gear, trash]) {
    assert.equal(await button.innerText(), '');
    assert.equal(await button.locator('svg').count(), 1);
  }
  const bounds = await Promise.all([visibility, gear, trash].map((el) => el.boundingBox()));
  assert.ok(bounds[0].x + bounds[0].width <= bounds[1].x);
  assert.ok(bounds[1].x + bounds[1].width <= bounds[2].x);
  const iconBounds = await Promise.all([gear, trash].map((el) => el.locator('svg').boundingBox()));
  const toggleGap = iconBounds[0].x - bounds[0].x - bounds[0].width;
  const iconGap = iconBounds[1].x - iconBounds[0].x - iconBounds[0].width;
  assert.ok(Math.abs(toggleGap - iconGap) < 1, 'Visible control gaps match');
  for (const target of [visibility, gear, trash]) {
    await target.hover();
    await settings.waitForTimeout(650);
    assert.equal(await settings.locator('.tooltip:visible').count(), 0);
  }
  await visibility.click();
  await waitForAsync(
    page,
    async () => !(await app.plugins.getPlugin('thingsmd').loadData()).calendars[0].enabled,
  );
  await page.waitForFunction(() => document.querySelectorAll('.ot-calendar-event').length === 0);
  await visibility.click();
  await waitForAsync(
    page,
    async () => (await app.plugins.getPlugin('thingsmd').loadData()).calendars[0].enabled,
  );
  await page.locator('.ot-calendar-event').first().waitFor();
  assert.equal(await settings.locator('input[type=color]').count(), 0);
  await settings.getByRole('button', { name: 'Configure calendar', exact: true }).click();
  const configure = await calendarDialog('.ot-calendar-configure');
  const palette = configure;
  assert.equal(await palette.locator('.ot-calendar-swatch').count(), 12);
  assert.equal(await palette.locator('.ot-calendar-swatch.is-selected').count(), 0);
  assert.equal(
    await palette.getByRole('button', { name: 'Default color' }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await palette
      .locator('.ot-calendar-source-color')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(255, 99, 71)',
  );
  assert.equal(
    await palette.evaluate((el) => {
      const first = el.querySelector('.ot-calendar-swatch').getBoundingClientRect();
      const grid = el.querySelector('.ot-calendar-color-grid').getBoundingClientRect();
      const source = el.querySelector('.ot-calendar-color-auto').getBoundingClientRect();
      const label = el.querySelector('.ot-calendar-default-label').getBoundingClientRect();
      return (
        source.width === first.width &&
        source.height === first.height &&
        Math.abs(source.left - first.left) < 1 &&
        source.top >= grid.bottom &&
        label.left > source.right
      );
    }),
    true,
  );
  const colorInput = palette.getByRole('button', { name: 'Blue', exact: true });
  await colorInput.focus();
  await colorInput.press('Enter');
  await palette.locator('.ot-calendar-swatch.is-selected').waitFor();
  assert.equal(await colorInput.getAttribute('aria-pressed'), 'true');
  assert.equal(
    await colorInput
      .locator('.ot-calendar-swatch-check')
      .evaluate((el) => getComputedStyle(el).visibility),
    'visible',
  );
  await waitForAsync(
    page,
    async () =>
      (await app.plugins.getPlugin('thingsmd').loadData()).calendars[0].color === '#2d73be',
  );
  const slider = configure.getByRole('slider', { name: 'Calendar refresh interval' });
  await slider.focus();
  await slider.press('ArrowRight');
  await waitForAsync(
    page,
    async () =>
      (await app.plugins.getPlugin('thingsmd').loadData()).calendars[0].refreshMinutes === 30,
  );
  assert.equal(await slider.getAttribute('aria-valuetext'), '30 minutes');
  assert.equal(
    await configure.locator('.ot-calendar-options .slider-value').innerText(),
    '30 minutes',
  );
  assert.equal(
    await configure
      .locator('.ot-calendar-options [aria-label], .ot-calendar-options [title]')
      .count(),
    0,
  );
  for (const target of [configure.getByLabel('Calendar name', { exact: true }), slider]) {
    await target.hover();
    await settings.waitForTimeout(650);
    assert.equal(await configure.page().locator('.tooltip:visible').count(), 0);
  }
  const layout = await configure.evaluate((el) => {
    const slider = el.querySelector('input[type=range]').getBoundingClientRect();
    const buttons = el.querySelectorAll('.ot-calendar-configure-actions button');
    const done = buttons[0].getBoundingClientRect();
    const value = el.querySelector('.slider-value').getBoundingClientRect();
    return {
      rightAligned: Math.abs(done.right - slider.right) < 2,
      sliderWidth: slider.width,
      below: value.top >= slider.bottom,
    };
  });
  assert.equal(layout.rightAligned, true);
  assert.ok(layout.sliderWidth >= 300);
  assert.equal(layout.below, true);
  const nameInput = configure.getByLabel('Calendar name', { exact: true });
  await nameInput.fill('Renamed calendar');
  await nameInput.press('Tab');
  await waitForAsync(
    page,
    async () =>
      (await app.plugins.getPlugin('thingsmd').loadData()).calendars[0].name === 'Renamed calendar',
  );
  await configure.page().screenshot({ path: 'artifacts/calendar-popup-desktop.png' });
  await configure.getByRole('button', { name: 'Done', exact: true }).click();
  await configure.waitFor({ state: 'detached' });
  await settings
    .locator('.ot-calendar-settings-row')
    .filter({ hasText: 'Renamed calendar' })
    .waitFor();
  await page.evaluate(() => app.setting.close());
  const colors = () =>
    page.locator('.ot-calendar-time').evaluateAll((els) =>
      els.map((el) => ({
        color: getComputedStyle(el).color,
        background: getComputedStyle(el).backgroundColor,
      })),
    );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.ot-calendar-time')).color === 'rgb(45, 115, 190)',
  );
  assert.ok((await colors()).every((style) => style.color === 'rgb(45, 115, 190)'));
  assert.equal((await colors())[0].background, 'rgb(45, 115, 190)');
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const reopened = await settingsPage(page);
  await reopened.bringToFront();
  await reopened.getByRole('button', { name: 'Configure calendar', exact: true }).click();
  const reopenedDialog = await calendarDialog('.ot-calendar-configure');
  const reopenedColor = reopenedDialog.getByRole('button', { name: 'Blue', exact: true });
  assert.equal(await reopenedColor.getAttribute('aria-pressed'), 'true');
  await reopenedDialog.getByRole('button', { name: 'Default color' }).click();
  await waitForAsync(
    page,
    async () => (await app.plugins.getPlugin('thingsmd').loadData()).calendars[0].color === '',
  );
  await reopenedDialog.locator('.ot-calendar-color-auto[aria-pressed=true]').waitFor();
  assert.equal(await reopenedDialog.locator('.ot-calendar-swatch.is-selected').count(), 0);
  assert.equal(
    await reopenedDialog
      .locator('.ot-calendar-source-color')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(255, 99, 71)',
  );
  await reopenedDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await reopenedDialog.waitFor({ state: 'detached' });
  await page.evaluate(() => app.setting.close());
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.ot-calendar-time')).color === 'rgb(255, 99, 71)',
  );
  assert.equal((await colors())[0].background, 'rgb(255, 99, 71)');
  taskPath = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = await p.createTask({ title: 'Calendar draft fixture', when: 'today' });
    await p.openList('today');
    return task.file.path;
  });
  const row = page.getByRole('option', { name: 'Calendar draft fixture', exact: true });
  await row.dblclick();
  const input = page.locator('.ot-title-input');
  await input.fill('Draft survives calendar refresh');
  version = 2;
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.refreshAll(true));
  await page.locator('.ot-calendar-title').filter({ hasText: 'Timed fixture 2' }).waitFor();
  assert.equal(await input.inputValue(), 'Draft survives calendar refresh');
  assert.equal(await input.evaluate((el) => el === document.activeElement), true);
  assert.equal(await cached(), 2);
  status = 503;
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.refreshAll(true));
  await page.locator('.ot-calendar-status').filter({ hasText: 'HTTP 503' }).waitFor();
  assert.equal(await page.locator('.ot-calendar-event').count(), 2);
  // A synced-device configuration without the secret still displays its cache.
  {
    await page.evaluate(async (id) => {
      app.secretStorage.deleteSecret(id);
      await app.plugins.getPlugin('thingsmd').calendar.refreshAll(true);
    }, id);
  }
  await page.locator('.ot-calendar-status').filter({ hasText: 'URL secret' }).waitFor();
  assert.equal(await page.locator('.ot-calendar-event').count(), 2);
  await input.press('Escape');
  await waitForAsync(
    page,
    async (path) =>
      (await app.vault.read(app.vault.getAbstractFileByPath(path))).includes(
        'Draft survives calendar refresh',
      ),
    taskPath,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await emulateMobile(true);
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await page.locator('.ot-calendar-event').first().waitFor();
  assert.ok(
    await page.locator('.ot-calendar').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  assert.ok((await colors()).every((style) => style.color === 'rgb(255, 99, 71)'));
  await page.screenshot({ path: 'artifacts/calendar-mobile.png' });
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const mobileSettings = await settingsPage(page);
  await mobileSettings.bringToFront();
  const settingsViewport = await mobileSettings.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await mobileSettings.setViewportSize({ width: 390, height: 844 });
  await mobileSettings.locator('.ot-calendar-settings-section').scrollIntoViewIfNeeded();
  assert.equal(
    await mobileSettings.locator('.ot-calendar-settings-section').evaluate((el) => {
      const add = el.querySelector('.ot-calendar-add');
      const rows = el.querySelectorAll('.ot-calendar-settings-row');
      return (
        el.lastElementChild === add &&
        !add.classList.contains('setting-item') &&
        getComputedStyle(add).backgroundColor === 'rgba(0, 0, 0, 0)' &&
        Math.abs(
          add.getBoundingClientRect().right -
            add.querySelector('button').getBoundingClientRect().right,
        ) < 1 &&
        add.getBoundingClientRect().top >= rows[rows.length - 1].getBoundingClientRect().bottom
      );
    }),
    true,
  );

  assert.equal(await mobileSettings.locator('input[type=color]').count(), 0);
  const mobileRow = mobileSettings.locator('.ot-calendar-settings-row');
  assert.equal(await mobileRow.evaluate(centered), true, 'Mobile calendar row centers align');
  const mobileBounds = await Promise.all(
    [
      mobileRow.getByLabel('Show in Today', { exact: true }),
      mobileRow.getByRole('button', { name: 'Configure calendar', exact: true }),
      mobileRow.getByRole('button', { name: 'Remove calendar', exact: true }),
    ].map((el) => el.boundingBox()),
  );
  assert.ok(mobileBounds[0].x + mobileBounds[0].width <= mobileBounds[1].x);
  assert.ok(mobileBounds[1].x + mobileBounds[1].width <= mobileBounds[2].x);
  const mobileIcons = await mobileRow.locator('button svg').evaluateAll((els) =>
    els.map((el) => ({
      x: el.getBoundingClientRect().x,
      width: el.getBoundingClientRect().width,
    })),
  );
  assert.ok(
    Math.abs(
      mobileIcons[0].x -
        mobileBounds[0].x -
        mobileBounds[0].width -
        (mobileIcons[1].x - mobileIcons[0].x - mobileIcons[0].width),
    ) < 1,
    'Mobile visible control gaps match',
  );
  assert.equal(await mobileRow.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
  await mobileSettings.screenshot({ path: 'artifacts/calendar-settings-rows-mobile.png' });
  await mobileSettings.getByRole('button', { name: 'Configure calendar', exact: true }).click();
  assert.equal(await mobileSettings.locator('input[type=color]').count(), 0);
  assert.equal(await mobileSettings.locator('.ot-calendar-swatch').count(), 12);
  assert.ok(
    await mobileSettings
      .getByLabel('Calendar name', { exact: true })
      .evaluate((el) => el.getBoundingClientRect().width >= 120),
  );
  assert.equal(
    await mobileSettings.getByRole('slider', { name: 'Calendar refresh interval' }).count(),
    1,
  );
  assert.equal(
    await mobileSettings
      .locator('.ot-calendar-settings-section')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  assert.equal(
    await mobileSettings.locator('.ot-calendar-configure').evaluate((el) => {
      const slider = el.querySelector('input[type=range]').getBoundingClientRect();
      const value = el.querySelector('.slider-value').getBoundingClientRect();
      return (
        slider.width >= 200 && value.top >= slider.bottom && el.scrollWidth <= el.clientWidth + 1
      );
    }),
    true,
  );
  assert.deepEqual(
    await mobileSettings.locator('.ot-calendar-color-setting').evaluate((el) => {
      const first = el.querySelector('.ot-calendar-swatch').getBoundingClientRect();
      const source = el.querySelector('.ot-calendar-color-auto').getBoundingClientRect();
      const label = el.querySelector('.ot-calendar-default-label');
      const control = el.querySelector('.setting-item-control').getBoundingClientRect();
      const grid = el.querySelector('.ot-calendar-color-grid').getBoundingClientRect();
      return {
        sizes: [...el.querySelectorAll('.ot-calendar-swatch, .ot-calendar-color-auto')].map(
          (button) => {
            const rect = button.getBoundingClientRect();
            return [Number(rect.width.toFixed(2)), Number(rect.height.toFixed(2))];
          },
        ),
        aligned:
          Math.abs(source.left - first.left) < 1 &&
          Math.abs((grid.left + grid.right) / 2 - (control.left + control.right) / 2) < 1,
        labelSingleLine: getComputedStyle(label).whiteSpace === 'nowrap',
      };
    }),
    { sizes: Array.from({ length: 13 }, () => [32, 32]), aligned: true, labelSingleLine: true },
  );
  await mobileSettings.screenshot({ path: 'artifacts/calendar-setup-mobile.png' });
  await mobileSettings.getByRole('button', { name: 'Done', exact: true }).click();
  await mobileSettings.locator('.ot-calendar-configure').waitFor({ state: 'detached' });
  await mobileSettings.setViewportSize(settingsViewport);
  await page.evaluate(() => app.setting.close());
  await emulateMobile(previousMobile);
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.screenshot({ path: 'artifacts/calendar-desktop.png' });
  console.log(
    'PASS real Obsidian: secret settings, Today, ETag/304, snapshots, offline cache, draft preservation; phone viewport/touch emulation',
  );
} finally {
  for (const candidate of page.context().pages())
    await candidate.evaluate(() => {
      for (const button of document.querySelectorAll(
        '.ot-calendar-create button, .ot-calendar-configure button',
      ))
        if (['Cancel', 'Done'].includes(button.textContent)) button.click();
    });
  if (previousMobile !== undefined) await emulateMobile(previousMobile);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
  await page.evaluate(
    async ({ id, previous, taskPath, created }) => {
      document.body.classList.remove('is-mobile');
      app.setting.close();
      const plugin = app.plugins.getPlugin('thingsmd');
      await plugin.updateSettings({ calendars: previous || [] });
      app.secretStorage.deleteSecret(id);
      if (created) app.secretStorage.deleteSecret(created.secretName);
      await plugin.openList('today');
      for (const path of [
        taskPath,
        `ThingsMD Calendars/${id}`,
        created && `ThingsMD Calendars/${created.id}`,
      ]) {
        const file = path && app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file, true);
      }
    },
    { id, previous, taskPath, created },
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
