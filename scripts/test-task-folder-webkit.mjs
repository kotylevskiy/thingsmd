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
    `<style>${css}</style><div><div class="folder-fixture">ThingsMD</div><div>Zulu</div><div>Alpha</div></div>`,
  );
  const row = page.locator('.folder-fixture');
  const before = await row.boundingBox();
  await row.evaluate((el) => el.classList.add('ot-task-folder-hidden'));
  assert.equal(await row.isVisible(), false);
  await row.evaluate((el) => el.classList.remove('ot-task-folder-hidden'));
  assert.equal(await row.isVisible(), true);
  assert.deepEqual(await row.boundingBox(), before);
  console.log(
    'WebKit fixture: folder hiding and restored natural ordering passed at mobile width.',
  );
} finally {
  await browser.close();
}
