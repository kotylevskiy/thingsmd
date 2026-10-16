import { chromium } from 'playwright-core';
import { realpath, mkdir } from 'node:fs/promises';

export async function connectTestVault() {
  if (!process.env.THINGSMD_TEST_VAULT)
    throw new Error('Set THINGSMD_TEST_VAULT to an existing disposable Obsidian vault.');
  const expected = await realpath(process.env.THINGSMD_TEST_VAULT);
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  try {
    const matches = [];
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        if (!page.url().startsWith('app://obsidian.md/')) continue;
        const path = await page.evaluate(() => window.app?.vault?.adapter?.getBasePath?.());
        if (path && (await realpath(path)) === expected) matches.push(page);
      }
    if (matches.length !== 1) throw new Error(`Expected one test vault; found ${matches.length}`);
    const page = matches[0];
    // Test actions start in the main workspace, never in a focused sidebar.
    const sidebarViews = await page.evaluate(() => {
      const workspace = app.workspace;
      const sidebars = [];
      let main;
      workspace.iterateAllLeaves((leaf) => {
        if (leaf.getRoot() === workspace.rootSplit) main ||= leaf;
        else sidebars.push({ id: leaf.id, type: leaf.view.getViewType() });
      });
      if (workspace.activeLeaf?.getRoot() !== workspace.rootSplit && main)
        workspace.setActiveLeaf(main, { focus: true });
      return sidebars;
    });
    const disconnect = browser.close.bind(browser);
    // Tests may emulate a phone or a larger desktop. Restore the real content
    // size before disconnecting so native footer controls remain on screen.
    browser.close = async () => {
      try {
        const size = await page.evaluate(() => {
          const bounds = require('@electron/remote').getCurrentWindow().getContentBounds();
          return { width: bounds.width, height: bounds.height };
        });
        await page.setViewportSize(size);
        const changed = await page.evaluate((before) => {
          const workspace = app.workspace;
          const changed = [];
          workspace.iterateAllLeaves((leaf) => {
            const original = before.find((entry) => entry.id === leaf.id);
            if (original && original.type !== leaf.view.getViewType())
              changed.push(`${original.type} became ${leaf.view.getViewType()}`);
          });
          return changed;
        }, sidebarViews);
        if (changed.length) throw Error(`Test changed a sidebar pane: ${changed.join(', ')}`);
      } finally {
        await disconnect();
      }
    };
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// Obsidian versions host settings either in the vault or in a separate window.
export async function settingsPage(page) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    for (const candidate of page.context().pages()) {
      if (await candidate.locator('.vertical-tab-content').first().isVisible()) return candidate;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('Settings content did not become visible');
}
