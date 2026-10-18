import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
await mkdir('artifacts', { recursive: true });
const css = await readFile(new URL('../plugin/styles.css', import.meta.url), 'utf8');
const browserType =
  process.env.THINGSMD_TEST_BROWSER === 'webkit'
    ? (await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core')).webkit
    : chromium;
const browser = await browserType.launch({
  executablePath:
    browserType.name() !== 'chromium'
      ? undefined
      : process.env.THINGSMD_CHROME_PATH ||
        (process.platform === 'darwin'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : undefined),
  headless: true,
});
try {
  const page = await browser.newPage();
  const title = 'Письма в СерДизель должны быть доставлены';
  const fixture = `<!doctype html><meta charset="utf-8"><style>
    :root { --size-4-1:4px; --size-4-2:8px; --size-4-3:12px; --size-4-4:16px;
      --size-2-1:2px; --size-2-3:6px; --line-height-tight:1.3; --file-margins:16px;
      --font-text-size:16px; --file-line-width:700px; --text-normal:#ddd;
      --text-muted:#aaa; --text-faint:#888; --interactive-accent:#538bda; }
    * {box-sizing:border-box} body {margin:0;background:#1d2228;font-family:Arial}
    ${css}
    </style><div class="ot-root"><div class="ot-shell"><main class="ot-main"><div class="ot-paper">
    <div class="ot-list-heading"><h1 class="inline-title">Anytime</h1></div>
    ${['', 'today', 'repeat']
      .map(
        (marker) => `
    <div class="ot-task is-selected"><div class="ot-task-line">
    <input type="checkbox">${marker === 'today' ? '<span class="ot-today-marker">★</span>' : ''}<span class="ot-task-title">${title}</span>${marker === 'repeat' ? '<span class="ot-repeat-indicator">↻</span>' : ''}
    <span class="ot-task-details"><span class="ot-note-icon">▤</span></span>
    <span class="ot-waiting-marker">➜</span><span class="ot-row-indicators"><span class="ot-row-date ot-row-deadline">⚑ Oct 20</span></span>
    </div></div>`,
      )
      .join('')}
    <div class="ot-task"><div class="ot-task-line"><input type="checkbox">
      <span class="ot-task-title">Short task</span><span class="ot-task-details"><span class="ot-note-icon">▤</span></span>

    </div></div>
    <div class="ot-task"><div class="ot-task-line"><input type="checkbox">
      <span class="ot-task-title">${title}</span><span class="ot-row-indicators"><span class="ot-row-date ot-row-deadline">⚑ 3 days left</span></span>
    </div></div>
    </div></main></div></div>`;
  // On desktop the deadline and waiting badge must form one trailing cluster.
  // Two independent auto margins used to divide the free space and center the plane.
  for (const width of [800, 1100]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(fixture);
    for (const row of await page.locator('.ot-task-line:has(> .ot-waiting-marker)').all()) {
      const plane = await row.locator('.ot-waiting-marker').boundingBox();
      const dates = await row.locator('.ot-row-indicators').boundingBox();
      const edge = await row.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right - parseFloat(getComputedStyle(el).paddingRight);
      });
      assert.ok(
        Math.abs(plane.x + plane.width - edge) < 1,
        `Airplane stays at the trailing edge at ${width}px`,
      );
      assert.ok(dates.x + dates.width <= plane.x, 'Deadline precedes the trailing airplane');
    }
  }
  for (const width of [320, 390, 430, 520]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(fixture);
    for (const row of await page.locator('.ot-task-line').all()) {
      const box = async (selector) => row.locator(selector).boundingBox();
      const check = await box('input'),
        text = await box('.ot-task-title');
      assert.ok(check.x + check.width <= text.x, `Checkbox beside title at ${width}px`);
      assert.ok(
        Math.abs(check.y + check.height / 2 - (text.y + text.height / 2)) < 1,
        `Checkbox aligns with a single title line at ${width}px`,
      );
      const metrics = await row.locator('.ot-task-title').evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
        overflow: getComputedStyle(el).textOverflow,
        text: el.textContent,
        clipped: el.scrollWidth > el.clientWidth,
      }));
      assert.ok(metrics.height <= metrics.lineHeight + 1, 'Collapsed title occupies one line');
      assert.equal(metrics.overflow, 'ellipsis');
      if (metrics.text === title && width === 320)
        assert.equal(metrics.clipped, true, 'Long title is truncated rather than wrapped');
      const repeat = (await row.locator('.ot-repeat-indicator').count())
        ? await box('.ot-repeat-indicator')
        : null;
      if (repeat) {
        assert.ok(Math.abs(repeat.x - text.x - text.width - 6) < 1, 'Repeat follows the title');
        assert.ok(Math.abs(repeat.y + repeat.height / 2 - (text.y + text.height / 2)) < 2);
      }
      if (await row.locator('.ot-task-details').count()) {
        const details = await box('.ot-task-details');
        assert.ok(Math.abs(details.y + details.height / 2 - (text.y + text.height / 2)) < 2);
        assert.ok(
          Math.abs(details.x - (repeat || text).x - (repeat || text).width - 6) < 1,
          'Details follow the title and its optional repeat marker',
        );
      }
      for (const selector of ['.ot-row-indicators']) {
        if (!(await row.locator(selector).count())) continue;
        const date = await box(selector);
        assert.ok(date.y >= text.y + text.height, 'Metadata stays below the title');
        assert.ok(
          Math.abs(date.x - text.x) < 1,
          'Metadata aligns with the actual title, including status markers',
        );
      }
    }
    await page.screenshot({ path: `artifacts/mobile-row-${browserType.name()}-${width}.png` });
  }
  for (const width of [1100, 800, 520, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(fixture);
    await page.locator('.ot-paper').evaluate((paper) => {
      paper.innerHTML = [
        'Short',
        'A long archived task title with substantial context. '.repeat(8),
        'No date',
      ]
        .map(
          (title, i) =>
            `<div class="ot-task ot-archive-task"><div class="ot-task-line"><input type="checkbox"><span class="ot-task-title">${title}</span>${i === 1 ? '<span class="ot-waiting-marker">➜</span>' : ''}<div class="ot-archive-actions"><span class="ot-archive-date">${i === 2 ? '' : 'Oct 18, 2026'}</span><button class="ot-restore">Restore</button></div></div></div>`,
        )
        .join('');
    });
    const rows = await page.locator('.ot-task-line').evaluateAll((lines) =>
      lines.map((line) => {
        const box = (selector) => line.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          title: box('.ot-task-title'),
          date: box('.ot-archive-date'),
          restore: box('.ot-restore'),
          line: line.getBoundingClientRect().toJSON(),
        };
      }),
    );
    for (const row of rows) {
      assert.ok(
        Math.abs(row.date.x - rows[0].date.x) < 1,
        `Archive dates share a column at ${width}px: ${JSON.stringify(rows)}`,
      );
      assert.ok(Math.abs(row.restore.x - rows[0].restore.x) < 1, 'Restore actions share a column');
      assert.ok(row.date.width >= 90, 'Dates retain enough space without wrapping');
      assert.ok(row.restore.right <= width, 'Archive controls fit the viewport');
      assert.ok(row.restore.right <= row.line.right + 1, 'Archive controls stay inside their row');
      if (width > 520)
        assert.ok(
          Math.abs(row.restore.y + row.restore.height / 2 - row.title.y - 12) < 1,
          'Archive actions align with the first title line',
        );
      else
        assert.ok(row.date.y >= row.title.bottom, 'Phone archive metadata stays below the title');
    }
  }
  console.log(
    'PASS: archive date/Restore columns, wrapped desktop titles, missing dates and phone action rows.',
  );
  console.log(
    'PASS: trailing airplane/deadline cluster at 800/1100px; compact single-line phone rows at 320/390/430/520px; ellipsis, inline details, marker-aware date alignment and deadline metadata.',
  );
} finally {
  await browser.close();
}
