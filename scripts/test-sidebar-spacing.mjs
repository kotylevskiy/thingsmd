import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
const note = `Sidebar spacing ${Date.now()}.md`;
let state;
try {
  await page.evaluate(async (note) => {
    await app.vault.create(note, '# Spacing fixture\n');
  }, note);
  await page.locator(`.nav-file-title[data-path="${note}"]`).waitFor();
  state = await page.evaluate(() => ({
    dark: document.body.classList.contains('theme-dark'),
    collapsed: app.workspace.leftSplit.collapsed,
  }));
  await page.evaluate(() => app.workspace.leftSplit.expand());
  for (const mode of ['light', 'dark', 'theme-density']) {
    await page.evaluate((mode) => {
      document.body.classList.toggle('theme-dark', mode === 'dark');
      document.body.classList.toggle('theme-light', mode !== 'dark');
      if (mode === 'theme-density') {
        const style = document.createElement('style');
        style.id = 'ot-spacing-audit';
        style.textContent =
          'body { --nav-item-padding: 8px 8px 8px 24px; --nav-item-size: 15px; --nav-item-margin-bottom: 5px; }';
        document.head.appendChild(style);
      }
    }, mode);
    await page.mouse.move(0, 0);
    // Compare root-level entries; nested notes intentionally add folder indentation.
    const metrics = await page.evaluate((note) => {
      const get = (selector) => {
        const el = document.querySelector(selector),
          s = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          padding: s.padding,
          marginBottom: s.marginBottom,
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
        };
      };
      return {
        list: get('.ot-list-link'),
        note: get(`.nav-file-title[data-path="${note}"]`),
      };
    }, note);
    assert.deepEqual(metrics.list, metrics.note);
    console.log(mode, metrics);
    await page
      .locator('.workspace-leaf-content[data-type="file-explorer"]')
      .screenshot({ path: `artifacts/sidebar-spacing-${mode}.png` });
  }
} finally {
  await page.evaluate((state) => {
    document.getElementById('ot-spacing-audit')?.remove();
    if (state) {
      document.body.classList.toggle('theme-dark', state.dark);
      document.body.classList.toggle('theme-light', !state.dark);
      if (state.collapsed) app.workspace.leftSplit.collapse();
    }
  }, state);
  await page.evaluate(async (note) => {
    const file = app.vault.getAbstractFileByPath(note);
    if (file) await app.vault.delete(file);
  }, note);
  await browser.close();
}
