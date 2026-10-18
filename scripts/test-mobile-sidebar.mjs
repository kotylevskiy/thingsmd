import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';

const { browser, page } = await connectTestVault({ settings: { enableWaiting: true } });
page.setDefaultTimeout(10000);
const folder = `Sidebar reveal ${Date.now()}`;
const wasMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd')?.mountListLinks,
    undefined,
    { timeout: 20000 },
  );
const reveal = async () => {
  await page.evaluate(() => app.workspace.leftSplit.collapse());
  await page.waitForFunction(
    () => getComputedStyle(app.workspace.leftSplit.containerEl).display === 'none',
  );
  await page.evaluate(() => app.workspace.leftSplit.expand());
  await page.waitForFunction(() => {
    const nav = document.querySelector('.ot-list-links');
    const box = nav?.getBoundingClientRect();
    return box?.width > 100 && box.height > 100 && box.left >= -0.1;
  });
};
try {
  await page.setViewportSize({ width: 390, height: 844 });
  if (!wasMobile) {
    await page.evaluate(() => app.emulateMobile(true));
  } else await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => app.workspace.leftSplit.type), 'mobile-drawer');
  await reveal();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.ot-list-links')).transform !== 'none',
  );
  await page.evaluate(async (folder) => {
    await app.vault.createFolder(folder);
    for (let i = 0; i < 40; i++)
      await app.vault.create(`${folder}/Note ${String(i).padStart(2, '0')}.md`, 'Sidebar fixture');
  }, folder);
  await page.locator(`.nav-folder-title[data-path="${folder}"]`).click();
  await page.locator(`.nav-file-title[data-path="${folder}/Note 00.md"]`).waitFor();
  await page.evaluate(() => {
    const files = app.workspace
      .getLeavesOfType('file-explorer')[0]
      .view.containerEl.querySelector('.nav-files-container');
    files.scrollTop = 300;
  });
  for (let cycle = 0; cycle < 12; cycle++) {
    await reveal();
    const state = await page.evaluate((folder) => {
      const nav = document.querySelector('.ot-list-links');
      const rows = [...nav.querySelectorAll('button')].filter((el) => !el.hidden);
      const files = nav.parentElement.querySelector('.nav-files-container');
      const native = files.querySelector(`.nav-folder-title[data-path="${folder}"]`);
      const arrow = native.querySelector('.tree-item-icon').getBoundingClientRect();
      const label = native.querySelector('.nav-folder-title-content').getBoundingClientRect();
      return {
        alignment: rows.map((row) => {
          const icon = row.querySelector('.ot-list-link-icon').getBoundingClientRect();
          return {
            icon: icon.x + icon.width / 2 - arrow.x - arrow.width / 2,
            label: row.querySelector('.tree-item-inner').getBoundingClientRect().x - label.x,
          };
        }),
        count: document.querySelectorAll('.ot-list-links').length,
        rows: rows.length,
        hit: rows.every((row) => {
          const box = row.getBoundingClientRect();
          return (
            document
              .elementFromPoint(box.x + 40, box.y + box.height / 2)
              ?.closest('.ot-list-link') === row
          );
        }),
        scroll: files.scrollTop,
        layer: getComputedStyle(nav).transform,
      };
    }, folder);
    for (const row of state.alignment) {
      assert.ok(
        Math.abs(row.icon) < 1,
        `Mobile list icons align with folder arrows: ${JSON.stringify(row)}`,
      );
      assert.ok(
        Math.abs(row.label) < 1,
        `Mobile list labels align with folder names: ${JSON.stringify(row)}`,
      );
    }
    assert.equal(state.count, 1);
    assert.equal(state.rows, 8);
    assert.equal(
      state.hit,
      true,
      'All shortcuts are visible and hit-testable immediately after reveal',
    );
    assert.equal(state.scroll, 300, 'Revealing the drawer does not scroll the notes');
    assert.notEqual(state.layer, 'none');
  }
  await page.screenshot({ path: 'artifacts/sidebar-real-mobile-open.png' });
  await page.locator('.ot-list-link[data-list="today"]').click();
  await page.locator('.workspace-leaf.mod-active h1').getByText('Today', { exact: true }).waitFor();
  // The real drawer also guards the old fixture's observer-loop regression.
  await page.evaluate(() => {
    const plugin = app.plugins.getPlugin('thingsmd');
    window.sidebarMountProbe = { plugin, original: plugin.mountListLinks, calls: 0 };
    plugin.mountListLinks = function (...args) {
      window.sidebarMountProbe.calls++;
      return window.sidebarMountProbe.original.apply(this, args);
    };
  });
  await reveal();
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.sidebarMountProbe.calls);
  assert.ok(calls > 0, 'Drawer reveal exercises the repaint observer');
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => window.sidebarMountProbe.calls),
    calls,
    'Drawer repaint settles without an observer loop',
  );
  await page.evaluate(() => {
    const probe = window.sidebarMountProbe;
    probe.plugin.mountListLinks = probe.original;
    delete window.sidebarMountProbe;
  });
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('thingsmd');
    await app.plugins.enablePlugin('thingsmd');
  });
  await reveal();
  assert.equal(await page.locator('.ot-list-links').count(), 1);
  await page.locator('.ot-list-link[data-list="inbox"]').click();
  console.log(
    'PASS: actual Obsidian mobile drawer opens 12 times without scrolling; all lists are hit-testable, note position is retained, navigation and plugin reload work.',
  );
} finally {
  try {
    await page.evaluate(() => {
      const probe = window.sidebarMountProbe;
      if (probe) probe.plugin.mountListLinks = probe.original;
      delete window.sidebarMountProbe;
    });
    await page.evaluate(async (folder) => {
      const file = app.vault.getAbstractFileByPath(folder);
      if (file) await app.vault.delete(file, true);
    }, folder);
    if (!wasMobile) {
      await page.evaluate(() => app.emulateMobile(false));
      await ready();
    }
  } finally {
    await browser.close();
  }
}
