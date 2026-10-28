import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
const { browser, page } = await browserFixture({
  browserType: webkit,
  pageOptions: {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    timezoneId: 'America/Los_Angeles',
  },
});
try {
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
  // Real swatch component with fixture storage; native settings are covered in Obsidian.
  await page.addStyleTag({
    content:
      '.setting-item { display: flex; } .setting-item-control { display: flex; } .ot-calendar-configure { padding: 24px; }',
  });
  await page.evaluate(() => {
    const popup = document.body.createDiv('ot-calendar-configure');
    popup.innerHTML =
      '<div class="ot-calendar-options"><div class="setting-item"><div class="color-fixture"></div></div><div class="setting-item ot-calendar-refresh-setting"><div class="setting-item-control"><span class="slider-value">15 minutes</span><input type="range" aria-label="Fixture interval" min="0" max="10" value="2"></div></div></div>';
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
      };
    });
    assert.equal(layout.below, true);
    assert.equal(layout.gridColumns, 6);
    assert.ok(layout.sliderWidth >= 260);
    assert.equal(layout.colorWidth, 32);
    assert.equal(layout.colorHeight, 32);
    assert.equal(layout.overflow, false);
  }
  console.log(
    'PASS WebKit mobile: bundled parser/timezones, DST, local-day filtering, all-day dates, safe text, layout and touch',
  );
} finally {
  await browser.close();
}
