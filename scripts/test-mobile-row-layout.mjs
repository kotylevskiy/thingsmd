import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const css = await readFile(new URL('../plugin/styles.css', import.meta.url), 'utf8');
const browser = await chromium.launch({
  executablePath:
    process.env.THINGSMD_CHROME_PATH ||
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
    ${[
      '',
      '<span class="ot-today-marker">★</span>',
      '<span class="ot-waiting-marker">➜</span><span class="ot-repeat-indicator">↻</span>',
    ]
      .map(
        (icons) => `
    <div class="ot-task is-selected"><div class="ot-task-line">
    <input type="checkbox">${icons}<span class="ot-task-title">${title}</span>
    <span class="ot-task-details"><span class="ot-note-icon">▤</span></span>
    <span class="ot-row-indicators"><span class="ot-row-date">⚑ Oct 20</span></span>
    </div></div>`,
      )
      .join('')}
    </div></main></div></div>`;
  for (const width of [320, 390, 430, 520]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(fixture);
    for (const row of await page.locator('.ot-task-line').all()) {
      const box = async (selector) => row.locator(selector).boundingBox();
      const check = await box('input'),
        text = await box('.ot-task-title'),
        details = await box('.ot-task-details'),
        dates = await box('.ot-row-indicators');
      assert.ok(check.x + check.width <= text.x, `Checkbox beside title at ${width}px`);
      assert.ok(
        check.y >= text.y && check.y + check.height <= text.y + text.height + 1,
        `Checkbox shares title line at ${width}px`,
      );
      assert.ok(
        Math.abs(details.y + details.height / 2 - (text.y + text.height / 2)) < 2,
        `Notes stay beside title at ${width}px`,
      );
      assert.ok(dates.y >= text.y + text.height, `Dates below title at ${width}px`);
      assert.ok(
        Math.abs(dates.x - (check.x + check.width + 6)) < 1,
        `Dates align with title column at ${width}px`,
      );
    }
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
    await page.screenshot({ path: `artifacts/mobile-row-${width}.png` });
  }
  // Confirm this fixture catches the original intrinsic-width flex regression.
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addStyleTag({
    content: '.ot-task:not(.is-expanded) > .ot-task-line > .ot-task-title { flex: 0 1 auto; }',
  });
  const originalCheck = await page.locator('.ot-task-line').first().locator('input').boundingBox();
  const originalTitle = await page.locator('.ot-task-title').first().boundingBox();
  assert.ok(
    originalTitle.y > originalCheck.y + originalCheck.height,
    'The previous CSS reproduces the detached checkbox from the iPhone screenshot',
  );
  console.log(
    'PASS: phone row geometry at 320, 390, 430 and 520px with long titles, notes and markers.',
  );
} finally {
  await browser.close();
}
