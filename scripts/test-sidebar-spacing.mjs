import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
const note = `Sidebar spacing ${Date.now()}.md`;
const folder = note.slice(0, -3);
let state;
try {
  await page.evaluate(async (note) => {
    await app.vault.create(note, '# Spacing fixture\n');
  }, note);
  await page.evaluate(async (folder) => {
    await app.vault.createFolder(folder);
    await app.vault.create(`${folder}/Child.md`, 'Alignment fixture');
  }, folder);
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
    const metrics = await page.evaluate(
      ({ note, folder }) => {
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
        const nav = document.querySelector('.ot-list-links');
        const nativeFolder = document.querySelector(`.nav-folder-title[data-path="${folder}"]`);
        const arrow = nativeFolder.querySelector('.tree-item-icon').getBoundingClientRect();
        const label = nativeFolder
          .querySelector('.nav-folder-title-content')
          .getBoundingClientRect();
        const alignment = [...nav.querySelectorAll('.ot-list-link')]
          .filter((row) => !row.hidden)
          .map((row) => {
            const icon = row.querySelector('.ot-list-link-icon').getBoundingClientRect();
            return {
              iconOffset: icon.x + icon.width / 2 - arrow.x - arrow.width / 2,
              labelOffset:
                row.querySelector('.tree-item-inner').getBoundingClientRect().x - label.x,
            };
          });
        return {
          alignment,
          list: get('.ot-list-link'),
          note: get(`.nav-file-title[data-path="${note}"]`),
        };
      },
      { note, folder },
    );
    assert.deepEqual(metrics.list, metrics.note);
    for (const row of metrics.alignment) {
      assert.ok(Math.abs(row.iconOffset) < 1, 'List icons align with native folder arrows');
      assert.ok(Math.abs(row.labelOffset) < 1, 'List names align with native folder names');
    }
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
  await page.evaluate(async (folder) => {
    const entry = app.vault.getAbstractFileByPath(folder);
    if (entry) await app.vault.delete(entry, true);
  }, folder);
  await browser.close();
}
