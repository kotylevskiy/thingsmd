import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { assertCalendarLayout } from './calendar-layout.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
const { browser, page } = await browserFixture({
  browserType: webkit,
  secureContext: true,
  pageOptions: {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    timezoneId: 'America/Los_Angeles',
  },
});
try {
  assert.deepEqual(
    await page.evaluate(async () => {
      const { CalendarRefreshCoordinator } = window.loadPluginModule(
        './calendar/refresh-coordinator.cjs',
      );
      const calls = [];
      const coordinator = new CalendarRefreshCoordinator(
        {
          reload: async () => calls.push('reload'),
          refreshAll: async () => calls.push('refresh'),
        },
        async () => true,
      );
      await coordinator.poll();
      await new Promise((resolve) => setTimeout(resolve, 20));
      coordinator.dispose();
      return calls;
    }),
    ['reload', 'refresh'],
    'Refresh coordination uses native Window timers safely, including on disposal',
  );
  const result = await page.evaluate(() => {
    const parser = window.loadPluginModule('./calendar/parser.cjs');
    const body = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'NAME:Calendar name fixture',
      'X-WR-CALNAME:Fallback name',
      'COLOR:tomato',
      'BEGIN:VEVENT',
      'UID:dst',
      'DTSTART;TZID=Europe/Berlin:20260328T090000',
      'DURATION:PT1H',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:<img src=x onerror=alert(1)>',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:all',
      'DTSTART;VALUE=DATE:20260329',
      'SUMMARY:All-day',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = parser.parseCalendar(body);
    const events = parser.eventsOnDay(parsed, new Date(2026, 2, 29, 12));
    const container = document.body.createDiv('ot-calendar');
    window.loadPluginModule('./calendar/view.cjs').renderCalendar(container, {
      today: () => ({
        events: events.map((e) => ({ ...e, calendarName: 'Test', color: parsed.color })),
        statuses: [{ id: 'test', name: 'Test', cached: true }],
      }),
      refreshAll: () => {},
    });
    return {
      events,
      calendarName: parsed.name,
      colors: [...container.querySelectorAll('.ot-calendar-time')].map(
        (el) => getComputedStyle(el).color,
      ),
      markerColor: getComputedStyle(container.querySelector('.is-all-day')).backgroundColor,
      images: container.querySelectorAll('img').length,
      overflow: container.scrollWidth > container.clientWidth,
      allDay: container.querySelector('.ot-calendar-time').getAttribute('data-quiet-label'),
      heights: [...container.querySelectorAll('.ot-calendar-event')].map(
        (row) => row.getBoundingClientRect().height,
      ),
      headingCount: container.querySelectorAll('h2').length,
      iconOnly: container.querySelector('.ot-calendar-refresh').textContent === '',
      refreshBackground: getComputedStyle(container.querySelector('.ot-calendar-refresh'))
        .backgroundColor,
      tooltipAttributes: container.querySelectorAll('[title], [aria-label]').length,
    };
  });
  assert.equal(result.events.length, 2);
  assert.equal(result.calendarName, 'Calendar name fixture');
  assert.deepEqual(result.colors, ['rgb(255, 99, 71)', 'rgb(255, 99, 71)']);
  assert.equal(result.markerColor, 'rgb(255, 99, 71)');
  assert.equal(
    new Date(result.events.find((e) => !e.allDay).start).toISOString(),
    '2026-03-29T07:00:00.000Z',
  );
  assert.equal(result.allDay, 'All day');
  assert.equal(result.images, 0);
  assert.equal(result.overflow, false);
  assert.ok(result.heights.every((height) => height <= 24));
  assert.equal(result.headingCount, 0);
  assert.equal(result.iconOnly, true);
  assert.equal(result.refreshBackground, 'rgba(0, 0, 0, 0)');
  assert.equal(result.tooltipAttributes, 0);
  await page.getByRole('button', { name: 'Refresh calendars', exact: true }).tap();
  await page.addStyleTag({
    content:
      'body { font-family: -apple-system, sans-serif; } .inline-title { font-size: 26px; line-height: 1.2; padding-top: 0.5em; }',
  });
  const upcoming = await page.evaluate(() => {
    const { CalendarService } = window.loadPluginModule('./calendar/service.cjs');
    const { parseCalendar } = window.loadPluginModule('./calendar/parser.cjs');
    const { renderUpcomingCalendar } = window.loadPluginModule('./calendar/view.cjs');
    const service = new CalendarService({ now: () => new Date(2026, 2, 27, 12).getTime() });
    service.configure([{ id: 'webkit', name: 'WebKit', enabled: true }]);
    service.state(service.config[0]).snapshot = {
      parsed: parseCalendar(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'COLOR:tomato',
          'BEGIN:VEVENT',
          'UID:dst-week',
          'DTSTART;TZID=Europe/Berlin:20260328T090000',
          'DURATION:PT1H',
          'RRULE:FREQ=DAILY;COUNT=3',
          'SUMMARY:<img src=x> A long calendar appointment that must stay on one line',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:trip',
          'DTSTART;VALUE=DATE:20260328',
          'DTEND;VALUE=DATE:20260330',
          'SUMMARY:Trip',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    };
    const root = document.body.createDiv('ot-paper');
    const title = root.createDiv('ot-list-heading');
    title.createSpan('ot-list-heading-icon').innerHTML = '<svg width=26 height=26></svg>';
    title.createEl('h1', { cls: 'inline-title', text: 'Upcoming' });
    root.createDiv('ot-calendar-errors');
    for (const key of service.upcoming().days.keys()) {
      const section = root.createEl('section', { cls: 'ot-section', attr: { 'data-date': key } });
      const heading = section.createEl('h2', { cls: 'ot-day-heading' });
      heading.createSpan({ cls: 'ot-day-number', text: String(Number(key.slice(-2))) });
      heading.createSpan({ cls: 'ot-day-separator', attr: { 'aria-hidden': 'true' } });
      heading.createSpan({ cls: 'ot-day-name', text: 'Day' });
      section.createDiv({ cls: 'ot-calendar', attr: { 'data-calendar-date': key } });
    }
    renderUpcomingCalendar(root, service);
    const group = root.querySelector('.ot-section').createDiv('ot-group');
    const task = group.createDiv('ot-task has-project-badge').createDiv('ot-task-line');
    task.createEl('input', { attr: { type: 'checkbox' } });
    task.createSpan({ cls: 'ot-task-title', text: 'Task after calendar events' });
    task.parentElement.createDiv({ cls: 'ot-project-badge', text: 'Project label' });
    const days = service.upcoming().days;
    return {
      counts: [...days.values()].map((events) => events.length),
      times: ['2026-03-28', '2026-03-29'].map((day) =>
        new Date(days.get(day).find((e) => !e.allDay).start).toISOString(),
      ),
      noImages: root.querySelectorAll('img').length === 0,
      noRefresh: root.querySelectorAll('button').length === 0,
      layout: [...root.querySelectorAll('.ot-calendar:not(:empty)')].every(
        (el) =>
          getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)' &&
          el.scrollWidth <= el.clientWidth,
      ),
    };
  });
  assert.deepEqual(upcoming.counts, [2, 2, 1, 0, 0, 0, 0]);
  assert.deepEqual(upcoming.times, ['2026-03-28T08:00:00.000Z', '2026-03-29T07:00:00.000Z']);
  assert.equal(upcoming.noImages, true);
  assert.equal(upcoming.noRefresh, true);
  assert.equal(upcoming.layout, true);
  await assertCalendarLayout(page);
  // Real swatch component with fixture storage; native settings are covered in Obsidian.
  await page.addStyleTag({
    content:
      '.setting-item { display: flex; } .setting-item-control { display: flex; } .ot-calendar-configure { padding: 24px; }',
  });
  await page.evaluate(async () => {
    const popup = document.body.createDiv('ot-calendar-configure');
    popup.innerHTML =
      '<div class="ot-calendar-options"><div class="setting-item"><div class="color-fixture"></div></div><div class="setting-item ot-calendar-refresh-setting"><div class="setting-item-control"><span class="slider-value">15 minutes</span><input type="range" aria-label="Fixture interval" min="0" max="10" value="2"></div></div><div class="setting-item ot-calendar-subscription-setting"><div>Subscription URL</div><div class="setting-item-control"><input type="password" aria-label="Subscription URL"><button>Save URL</button></div></div><div role="status"></div></div>';
    const secret = new Map();
    const calendar = {
      id: 'webkit',
      secretName: 'thingsmd-calendar-webkit',
      source: await window
        .loadPluginModule('./calendar/identity.cjs')
        .newSource('https://example.com/feed', 'webkit-calendar'),
    };
    const plugin = {
      app: {
        secretStorage: {
          getSecret: (name) => secret.get(name),
          setSecret: (name, url) => secret.set(name, url),
          deleteSecret: (name) => secret.delete(name),
        },
      },
      settings: { calendars: [calendar] },
      calendar: {
        request: async ({ url }) => ({
          status: 200,
          text: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nUID:${url.endsWith('/other') ? 'other-calendar' : 'webkit-calendar'}\r\nEND:VCALENDAR\r\n`,
        }),
        states: new Map(),
        pending: new Map(),
        refresh: async () => {},
        configure: () => {},
      },
      calendarDialogs: new Set(),
    };
    plugin.persistSettings = async (patch, { prepare } = {}) => {
      const next = { ...plugin.settings, ...patch(plugin.settings) };
      await prepare?.(next);
      plugin.settings = next;
    };
    const host = window.loadPluginModule('obsidian');
    host.ButtonComponent = class {
      constructor(parent) {
        this.buttonEl = parent.createEl('button');
      }
      setButtonText(text) {
        this.buttonEl.textContent = text;
        return this;
      }
      setWarning() {
        this.buttonEl.addClass('mod-warning');
        return this;
      }
      onClick(fn) {
        this.buttonEl.onclick = fn;
        return this;
      }
    };
    host.Setting = class {
      constructor(parent) {
        this.settingEl = parent.createDiv('setting-item');
        this.controlEl = this.settingEl.createDiv('setting-item-control');
      }
      setClass(name) {
        this.settingEl.addClass(name);
        return this;
      }
      addButton(fn) {
        fn(new host.ButtonComponent(this.controlEl));
        return this;
      }
    };
    host.Modal.prototype.setTitle = function (title) {
      this.modalEl.createEl('h2', { text: title });
    };
    window.calendarWarningPlugin = plugin;
    popup.querySelector('.ot-calendar-subscription-setting button').onclick = async () => {
      const { saveSubscription, SubscriptionMismatch } = window.loadPluginModule(
        './calendar/subscription.cjs',
      );
      const url = popup.querySelector('input[type=password]').value;
      popup.querySelector('[role=status]').textContent = '';
      try {
        await saveSubscription(plugin, calendar, url);
        popup.querySelector('[role=status]').textContent = 'URL saved';
      } catch (error) {
        if (!(error instanceof SubscriptionMismatch)) throw error;
        const Warning = window.loadPluginModule('./calendar/source-warning-dialog.cjs');
        const dialog = new Warning(plugin, 'WebKit calendar', error.calendarName);
        dialog.open();
        if (await dialog.result) {
          await saveSubscription(plugin, calendar, url, {
            replace: true,
            expected: error.expected,
          });
          popup.querySelector('[role=status]').textContent = 'Source replaced';
        }
      }
    };
    window.calendarColorState = { override: '', sourceColor: '#123456' };
    window
      .loadPluginModule('./calendar/color-swatches.cjs')
      .colorSwatches(popup.querySelector('.color-fixture'), {
        current: () => window.calendarColorState,
        save: async (color) => {
          if (window.calendarSaveFails) return false;
          window.calendarColorState.override = color;
          return true;
        },
      });
  });
  assert.equal(await page.locator('input[type=color]').count(), 0);
  assert.equal(await page.locator('.ot-calendar-swatch').count(), 12);
  assert.equal(await page.locator('.ot-calendar-swatch.is-selected').count(), 0);
  const blue = page.getByRole('button', { name: 'Blue', exact: true });
  await blue.tap();
  assert.equal(await blue.getAttribute('aria-pressed'), 'true');
  assert.equal(
    await blue
      .locator('.ot-calendar-swatch-check')
      .evaluate((el) => getComputedStyle(el).visibility),
    'visible',
  );
  await page.evaluate(() => {
    window.calendarSaveFails = true;
  });
  await page.getByRole('button', { name: 'Pink', exact: true }).tap();
  assert.equal(await blue.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.ot-calendar-swatch.is-selected').count(), 1);
  await page.evaluate(() => {
    window.calendarSaveFails = false;
  });
  const automatic = page.getByRole('button', { name: 'Default color', exact: true });
  await automatic.tap();
  assert.equal(await automatic.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.ot-calendar-swatch.is-selected').count(), 0);
  assert.equal(
    await page
      .locator('.ot-calendar-source-color')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(18, 52, 86)',
  );
  assert.equal(
    await page
      .locator('.ot-calendar-color-controls [aria-label], .ot-calendar-color-controls [title]')
      .count(),
    0,
  );
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.locator('.ot-calendar-configure').evaluate((el) => {
      const slider = el.querySelector('input[type=range]').getBoundingClientRect();
      const value = el.querySelector('.slider-value').getBoundingClientRect();
      const color = el.querySelector('.ot-calendar-swatch').getBoundingClientRect();
      return {
        below: value.top >= slider.bottom,
        sliderWidth: slider.width,
        colorWidth: color.width,
        colorHeight: color.height,
        overflow: el.scrollWidth > el.clientWidth,
        gridColumns: getComputedStyle(
          el.querySelector('.ot-calendar-color-grid'),
        ).gridTemplateColumns.split(' ').length,
        urlWidth: el.querySelector('input[type=password]').getBoundingClientRect().width,
        urlFits:
          el.querySelector('.ot-calendar-subscription-setting').scrollWidth <= el.clientWidth,
      };
    });
    assert.equal(layout.below, true);
    assert.equal(layout.gridColumns, 6);
    assert.ok(layout.sliderWidth >= 260);
    assert.equal(layout.colorWidth, 32);
    assert.equal(layout.colorHeight, 32);
    assert.equal(layout.overflow, false);
    assert.ok(layout.urlWidth >= 140);
    assert.equal(layout.urlFits, true);
  }
  await page.getByLabel('Subscription URL', { exact: true }).fill('webcal://example.com/feed');
  await page.getByRole('button', { name: 'Save URL', exact: true }).tap();
  await page.getByRole('status').filter({ hasText: 'URL saved' }).waitFor();
  await page.getByLabel('Subscription URL', { exact: true }).fill('https://example.com/other');
  assert.equal(await page.locator('.ot-calendar-source-warning').count(), 0);
  await page.getByRole('button', { name: 'Save URL', exact: true }).tap();
  const warning = page.locator('.ot-calendar-source-warning');
  await warning.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.ot-calendar-configure .ot-calendar-source-warning').count(), 0);
  await warning.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await warning.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Save URL', exact: true }).tap();
  await warning.waitFor({ state: 'visible' });
  assert.equal(await warning.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await warning.getByRole('button', { name: 'Save link', exact: true }).tap();
  await warning.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.ot-calendar-replace-dialog').count(), 0);
  await page.getByRole('status').filter({ hasText: 'Source replaced' }).waitFor();
  await page.evaluate(() => {
    const Warning = window.loadPluginModule('./calendar/source-warning-dialog.cjs');
    const dialog = (window.calendarWarningDialog = new Warning(
      window.calendarWarningPlugin,
      'Original calendar',
      'Different calendar',
    ));
    window.calendarWarningResult = dialog.result;
    dialog.open();
  });
  await page.evaluate(() => window.calendarWarningDialog.close());
  await warning.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.calendarWarningResult), false);
  assert.equal(await page.evaluate(() => window.calendarWarningPlugin.calendarDialogs.size), 0);

  // Exercise the actual settings dialog with a minimal Obsidian host shim.
  // Subscription validation and persistence still use the real plugin modules.
  await page.evaluate(() => {
    document.querySelector('.ot-calendar-configure').remove();
    const host = window.loadPluginModule('obsidian');
    Object.assign(host.ButtonComponent.prototype, {
      setDisabled(value) {
        this.buttonEl.disabled = value;
        return this;
      },
      setCta() {
        return this;
      },
    });
    Object.assign(host.Setting.prototype, {
      setName(value) {
        this.settingEl.createDiv({ text: value });
        return this;
      },
      setDesc(value) {
        this.descEl ||= this.settingEl.createDiv('setting-item-description');
        this.descEl.setText(value);
        return this;
      },
      addText(callback) {
        const inputEl = this.controlEl.createEl('input');
        callback({
          inputEl,
          getValue: () => inputEl.value,
          setValue(value) {
            inputEl.value = value;
            return this;
          },
          setPlaceholder(value) {
            inputEl.placeholder = value;
            return this;
          },
          onChange(fn) {
            inputEl.oninput = () => fn(inputEl.value);
            return this;
          },
        });
        return this;
      },
      addSlider(callback) {
        const sliderEl = this.controlEl.createEl('input', { attr: { type: 'range' } });
        callback({
          sliderEl,
          getValue: () => Number(sliderEl.value),
          setValue(value) {
            sliderEl.value = value;
            return this;
          },
          setLimits(min, max, step) {
            Object.assign(sliderEl, { min, max, step });
            return this;
          },
          onChange(fn) {
            sliderEl.oninput = () => fn(Number(sliderEl.value));
            return this;
          },
        });
        return this;
      },
    });
    const plugin = window.calendarWarningPlugin;
    plugin.calendar.color = () => '#123456';
    Object.assign(plugin.settings.calendars[0], { name: 'Settings fixture', refreshMinutes: 15 });
    window.openCalendarSettings = () => {
      const Dialog = window.loadPluginModule('./calendar/settings-dialog.cjs');
      new Dialog(plugin, plugin.settings.calendars[0], () => {}).open();
    };
  });
  for (const width of [390, 720]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.openCalendarSettings());
    const dialog = page.locator('.ot-calendar-configure');
    const input = dialog.getByLabel('Subscription URL', { exact: true });
    const change = dialog.getByRole('button', { name: 'Change URL', exact: true });
    assert.equal(await input.isVisible(), false);
    await change.click();
    await input.fill('https://example.com/unsaved');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await input.isVisible(), false);
    await change.click();
    assert.equal(await input.inputValue(), '');
    await input.fill('https://example.com/other');
    await input.press('Enter');
    await change.waitFor({ state: 'visible' });
    assert.equal(await input.isVisible(), false);
    assert.equal(
      await dialog.getByRole('button', { name: 'Save URL', exact: true }).isVisible(),
      false,
    );
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
  }

  console.log(
    'PASS WebKit mobile: bundled parser/timezones, DST, local-day filtering, all-day dates, safe text, layout and touch',
  );
} finally {
  await browser.close();
}
