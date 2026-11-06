import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
const { browser, page } = await browserFixture({ browserType: webkit });
try {
  await page.addStyleTag({
    content: `:root {
    --text-warning:#ae6500;--text-normal:#222;--text-muted:#666;
    --background-primary:#fff;--font-ui-small:13px;--size-4-5:20px;
    --font-ui-smaller:12px;--radius-m:8px;--font-semibold:600;
  } body {font-family:system-ui;padding:16px}`,
  });
  await page.evaluate(() => {
    const task = {
      file: { path: 'ThingsMD/task-id.md' },
      meta: { id: 'task-id', title: 'Review the launch plan' },
      conflicts: [
        {
          file: {
            path: 'ThingsMD/task-id (conflicted copy from another device with a long name 2026-11-06).md',
          },
          meta: { id: 'task-id' },
        },
      ],
    };
    const root = document.body.createDiv('ot-root');
    window.loadPluginModule('./lists/task-conflict-notice.cjs')(root, [task], {
      app: {
        vault: { getAbstractFileByPath: (path) => ({ path }) },
        workspace: {
          getLeaf: () => ({
            openFile: async (file) => {
              window.openedCopy = file.path;
            },
          }),
          revealLeaf: async () => {},
        },
      },
    });
  });
  for (const width of [720, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const summary = page.locator('summary');
    await summary.focus();
    await summary.press('Enter');
    assert.equal(await page.locator('details').getAttribute('open'), '');
    assert.ok(
      await page
        .locator('.ot-task-conflict-notice')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    await page.locator('.ot-task-conflict-file a').last().click();
    assert.match(await page.evaluate(() => window.openedCopy), /another device/);
    await summary.focus();
    await summary.press('Enter');
    assert.equal(await page.locator('details').getAttribute('open'), null);
  }
  console.log(
    'PASS WebKit fixture: notice at 720/390/320 px, keyboard disclosure, long filenames and review links.',
  );
} finally {
  await browser.close();
}
