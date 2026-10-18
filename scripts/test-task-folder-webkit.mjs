import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserFixture } from './browser-fixture.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
const { browser, page } = await browserFixture({
  browserType: webkit,
  pageOptions: { viewport: { width: 390, height: 844 } },
});
try {
  const css = await readFile(new URL('../plugin/styles.css', import.meta.url), 'utf8');
  await page.setContent(
    `<style>${css}</style><div class="ot-task-folder-siblings"><div class="ot-task-folder-last">ThingsMD</div><div>Zulu</div><div>Alpha</div></div>`,
  );
  const row = page.locator('.ot-task-folder-last');
  assert.equal(
    await row.evaluate(
      (el) =>
        el.getBoundingClientRect().top >
        el.parentElement.lastElementChild.getBoundingClientRect().top,
    ),
    true,
  );
  await row.evaluate((el) => el.classList.add('ot-task-folder-hidden'));
  assert.equal(await row.isVisible(), false);
  console.log('WebKit fixture: task-folder ordering and hiding passed at mobile width.');
} finally {
  await browser.close();
}
