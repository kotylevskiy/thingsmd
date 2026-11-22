import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
for (const [locale, firstDay] of [
  ['en-US', 0],
  ['ru-RU', 1],
  ['ar-EG', 6],
]) {
  const { browser, page } = await browserFixture({
    browserType: webkit,
    pageOptions: { locale, viewport: { width: 390, height: 844 }, hasTouch: true },
  });
  try {
    const result = await page.evaluate(
      (firstDay) => {
        document.body.classList.add('is-mobile');
        let pop = document.body.createDiv();
        const { datePicker } = window.loadPluginModule('./shared/date-picker.cjs');
        const options = {
          kind: 'deadline',
          value: '2026-10-19',
          onSelect() {},
          onClose() {},
          setIcon() {},
        };
        datePicker(pop, options);
        const dates = [...pop.querySelectorAll('[data-date]')].map((el) => el.dataset.date);
        const heading = pop.querySelector('.ot-calendar-weekdays').firstElementChild.textContent;
        pop.close(false);
        pop = document.body.createDiv();
        datePicker(pop, { ...options, weekStartsOn: firstDay });
        return {
          locale: new Intl.DateTimeFormat().resolvedOptions().locale,
          dates,
          heading,
          override: pop.querySelector('[data-date]').dataset.date,
          weekdays: Array.from({ length: 7 }, (_, day) =>
            new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(
              new Date(2024, 0, 7 + day, 12),
            ),
          ),
        };
      },
      (firstDay + 1) % 7,
    );
    assert.equal(
      new Intl.Locale(result.locale).maximize().region,
      new Intl.Locale(locale).maximize().region,
    );
    assert.ok(result.dates.length >= 7);
    assert.equal(
      result.heading.toLocaleLowerCase(locale),
      result.weekdays[firstDay].toLocaleLowerCase(locale),
    );
    assert.equal(new Date(result.dates[0] + 'T12:00:00').getDay(), firstDay);
    assert.equal(new Date(result.override + 'T12:00:00').getDay(), (firstDay + 1) % 7);
    console.log('PASS WebKit calendar regional week start', locale, firstDay);
  } finally {
    await browser.close();
  }
}
