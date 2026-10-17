import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const browserType =
  process.env.THINGSMD_TEST_BROWSER === 'webkit'
    ? (await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core')).webkit
    : undefined;
const { browser, page } = await browserFixture({ browserType });
try {
  await page.setViewportSize({ width: 390, height: 844 });
  // Preserve the nested containment and sliding layer used by the mobile host.
  await page.addStyleTag({
    content: `
    body { --nav-item-padding: 8px 12px; --nav-item-size:16px; --background-modifier-border:#555;
      --nav-item-color:#eee; --line-height-tight:1.4; background:#202428; color:white; }
    .workspace-drawer { position:fixed; inset:0 auto 0 0; width:330px; display:flex;
      contain:layout style paint; background:#202428; transition:transform 100ms linear; }
    .workspace-drawer-inner { width:100%; display:flex; flex-direction:column; contain:layout style paint; }
    .workspace-leaf { flex:1; min-height:0; display:flex; contain:strict; }
    .workspace-leaf-content { flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
    .nav-files-container { flex:1; min-height:0; overflow:auto; }
    .fixture-note { height:32px; padding:6px 16px; }
  `,
  });
  await page.evaluate(() => {
    document.body.addClass('is-mobile', 'is-phone');
    const drawer = document.body.createDiv('workspace-drawer');
    const container = drawer
      .createDiv('workspace-drawer-inner')
      .createDiv('workspace-leaf')
      .createDiv('workspace-leaf-content');
    container.createDiv('nav-header').textContent = 'Note controls';
    const files = container.createDiv('nav-files-container');
    for (let i = 0; i < 310; i++) files.createDiv({ cls: 'fixture-note', text: `Note ${i}` });
    const callbacks = [];
    const p = {
      settings: {},
      records: async () => [],
      app: {
        workspace: {
          getLeavesOfType: () => [{ view: { containerEl: container } }],
          on: () => ({}),
          onLayoutReady() {},
        },
        vault: { on: () => ({}) },
      },
      openList: (list) => {
        window.sidebar.opened = list;
      },
      register: (callback) => callbacks.push(callback),
      registerEvent() {},
      registerDomEvent: (target, name, callback, options) => {
        target.addEventListener(name, callback, options);
        callbacks.push(() => target.removeEventListener(name, callback, options));
      },
    };
    window.sidebar = { drawer, files, p, callbacks, mounts: 0, scrolls: 0 };
    window.loadPluginModule('./sidebar.cjs')(p);
    const mount = p.mountListLinks;
    p.mountListLinks = () => {
      window.sidebar.mounts++;
      mount();
    };
    p.mountListLinks();
    files.addEventListener('scroll', () => window.sidebar.scrolls++);
    files.scrollTop = 600;
  });
  await page.waitForTimeout(100);
  for (let cycle = 0; cycle < 12; cycle++) {
    await page.evaluate(() => {
      const { drawer } = window.sidebar;
      drawer.style.display = 'none';
      drawer.style.transform = 'translateX(-100%)';
    });
    await page.waitForTimeout(30);
    const before = await page.evaluate(() => {
      const state = window.sidebar;
      state.scrolls = 0;
      const mounts = state.mounts;
      state.drawer.style.display = 'flex';
      void state.drawer.offsetWidth;
      state.drawer.style.transform = 'translateX(0)';
      return mounts;
    });
    await waitForAsync(page, (before) => window.sidebar.mounts > before, before);
    await page.waitForFunction(
      () => document.querySelector('.workspace-drawer').getBoundingClientRect().x >= -0.1,
    );
    const state = await page.evaluate(() => {
      const nav = document.querySelector('.ot-list-links');
      return {
        count: document.querySelectorAll('.ot-list-links').length,
        rows: [...nav.querySelectorAll('button')].filter(
          (el) => el.getBoundingClientRect().height > 0,
        ).length,
        layer: getComputedStyle(nav).transform,
        scroll: window.sidebar.files.scrollTop,
        scrolls: window.sidebar.scrolls,
      };
    });
    assert.equal(state.count, 1);
    assert.equal(state.rows, 8);
    assert.notEqual(state.layer, 'none', 'Shortcuts retain their own layer during drawer reveals');
    assert.equal(state.scroll, 600, 'Opening the drawer preserves the note scroll position');
    assert.equal(state.scrolls, 0, 'No scroll is needed to restore shortcuts');
    if (cycle === 0 || cycle === 11)
      await page.screenshot({
        path: `artifacts/sidebar-reveal-${browserType?.name() || 'chromium'}-${cycle}.png`,
      });
    await page.locator('[data-list="today"]').click();
    assert.equal(await page.evaluate(() => window.sidebar.opened), 'today');
  }
  await page.waitForTimeout(100);
  const settled = await page.evaluate(() => window.sidebar.mounts);
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.sidebar.mounts),
    settled,
    'Repaint does not create an observer loop',
  );
  await page.evaluate(() => window.sidebar.callbacks.forEach((callback) => callback()));
  console.log(
    'PASS: 12 mobile drawer reveals without scrolling; shortcuts stay visible and clickable, note position retained, with 310 notes.',
  );
} finally {
  await browser.close();
}
