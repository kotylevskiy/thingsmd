import { testVault } from './test-vault.mjs';
import { chromium } from 'playwright-core';
import { realpath, mkdir } from 'node:fs/promises';
import {
  installRuntimeNoticeAudit,
  runtimeErrorPattern,
  runtimeNoticePrefix,
} from './runtime-notice-audit.mjs';

export async function connectTestVault({ settings = {} } = {}) {
  const expected = await testVault();
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  const browser = await chromium.connectOverCDP(
    process.env.THINGSMD_DEBUG_URL || 'http://127.0.0.1:9222',
  );
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
    const runtimeErrors = [];
    const onPageError = (error) => runtimeErrors.push(error.stack || error.message);
    const onConsole = (message) => {
      if (message.type() === 'error' && message.text().startsWith(runtimeNoticePrefix))
        runtimeErrors.push(message.text().slice(runtimeNoticePrefix.length));
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    const noticeAudit = { pattern: runtimeErrorPattern.source, prefix: runtimeNoticePrefix };
    await page.addInitScript(installRuntimeNoticeAudit, noticeAudit);
    await page.evaluate(installRuntimeNoticeAudit, noticeAudit);
    // Test actions start in the main workspace, never in a focused sidebar.
    const sidebarState = await page.evaluate(() => ({
      left: app.workspace.leftSplit.collapsed,
      right: app.workspace.rightSplit.collapsed,
    }));
    await page.evaluate(() => app.workspace.leftSplit.expand());
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
    let restoreSettings;
    // Tests may emulate a phone or a larger desktop. Restore the real content
    // size before disconnecting so native footer controls remain on screen.
    browser.close = async () => {
      try {
        await restoreSettings?.();
        const size = await page.evaluate(() => {
          const bounds = require('@electron/remote').getCurrentWindow().getContentBounds();
          return { width: bounds.width, height: bounds.height };
        });
        await page.setViewportSize(size);
        await page.evaluate((state) => {
          const workspace = app.workspace;
          if (state.left) workspace.leftSplit.collapse();
          else workspace.leftSplit.expand();
          if (state.right) workspace.rightSplit.collapse();
          else workspace.rightSplit.expand();
        }, sidebarState);
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
        if (runtimeErrors.length)
          throw Error(`Obsidian runtime errors (including Notices):\n${runtimeErrors.join('\n')}`);
      } finally {
        await page.evaluate(() => window.__thingsmdNoticeAudit?.disconnect()).catch(() => {});
        page.off('pageerror', onPageError);
        page.off('console', onConsole);
        await disconnect();
      }
    };
    // Suites opt into features explicitly instead of depending on a previous
    // driver's settings. Restore only these overrides when the driver exits.
    if (Object.keys(settings).length) {
      const previous = await page.evaluate(
        (keys) =>
          Object.fromEntries(
            keys.map((key) => [key, app.plugins.getPlugin('thingsmd').settings[key]]),
          ),
        Object.keys(settings),
      );
      restoreSettings = () =>
        page.evaluate(
          (values) => app.plugins.getPlugin('thingsmd').updateSettings(values),
          previous,
        );
      await page.evaluate(
        (values) => app.plugins.getPlugin('thingsmd').updateSettings(values),
        settings,
      );
    }
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
