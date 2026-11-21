import { colorMode, themeClass, themeSource } from './capture-config.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import { connectTestVault } from '../../scripts/obsidian-connection.mjs';
import { testVault } from '../../scripts/test-vault.mjs';
import { waitForAsync } from '../../scripts/wait-for-async.mjs';
import { dayAfter } from '../../plugin/shared/local-date.cjs';
import { addPointer, record } from './recorder.mjs';

const exec = promisify(execFile);
const vaultRoot = await testVault();
const { browser, page } = await connectTestVault();
const viewport = { width: 1100, height: 620 };
const area = { x: 0, y: 0, ...viewport };
const settingsTheme = join(vaultRoot, '.obsidian', 'themes');
const themePath = join(settingsTheme, 'Things');
const active = page.locator('.workspace-leaf.mod-active');
const sidebar = page.locator('.workspace-split.mod-left-split');
const rescheduleTitle = 'Drag this task to another day to reschedule it';
const capturedTitle = 'Buy some milk';
const shortcut = 'Control+Super+Shift+Space';
let saved;
let themesCreated;
let themeCreated;
let frameStyle;
let shortcutFallback = false;

const row = (title) => active.locator('.ot-task:visible').filter({ hasText: title });
const focus = () =>
  page.evaluate(() => {
    require('@electron/remote').getCurrentWindow().focus();
    window.focus();
  });
const openList = (name) =>
  page.evaluate((name) => app.plugins.getPlugin('thingsmd').openList(name), name);

async function pressGlobalShortcut() {
  await exec(
    'osascript',
    [
      '-e',
      'tell application "Finder" to activate',
      '-e',
      'tell application "System Events"\nrepeat 30 times\nif frontmost of process "Finder" then exit repeat\ndelay 0.05\nend repeat\nif not (frontmost of process "Finder") then error "Finder did not become active"\nkey code 49 using {control down, command down, shift down}\nend tell',
    ],
    { timeout: 3700 },
  );
}

try {
  page.setDefaultTimeout(7500);
  saved = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('thingsmd');
    if (
      app.vault.getMarkdownFiles().length ||
      (await plugin.taskRecords()).length ||
      app.vault.getAbstractFileByPath('Projects') ||
      app.vault.getAbstractFileByPath('Reference')
    ) {
      throw Error('Recordings require the empty disposable vault');
    }
    return {
      settings: {
        captureDestination: plugin.settings.captureDestination,
        enableWaiting: plugin.settings.enableWaiting,
      },
      shortcut: plugin.settings.globalCaptureHotkey || '',
      colorMode: app.vault.getConfig('theme') || 'system',
      theme: app.customCss.theme,
      leftSize: app.workspace.leftSplit.size,
      leafId: app.workspace.activeLeaf.id,
      viewState: app.workspace.activeLeaf.getViewState(),
    };
  });
  themesCreated = await mkdir(settingsTheme, { recursive: true });
  await mkdir(themePath);
  themeCreated = true;
  await cp(themeSource, themePath, { recursive: true });
  await page.setViewportSize(viewport);
  frameStyle = await page.addStyleTag({
    content: '.status-bar, .tooltip, .notice-container { visibility: hidden; }',
  });
  await page.evaluate(async (mode) => {
    await app.customCss.readThemes(false);
    await app.customCss.setTheme('Things');
    app.changeTheme(mode);
  }, colorMode);
  await page.evaluate(
    async ({ dates, rescheduleTitle, shortcut }) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      workspace.leftSplit.expand();
      workspace.leftSplit.setSize(212);
      workspace.rightSplit.collapse();
      await plugin.updateSettings({ captureDestination: 'inbox', enableWaiting: true });
      await plugin.setGlobalCaptureHotkey(shortcut);
      await vault.createFolder('Projects');
      await vault.createFolder('Reference');
      await vault.create('Projects/Studio Launch.md', 'Plan a small studio launch.\n');
      await vault.create('Projects/Editorial checklist.md', 'Prepare the release announcement.\n');
      await vault.create('Reference/Brand guidelines.md', 'Use the launch colors consistently.\n');
      await vault.create(
        'Reference/Meeting notes.md',
        'Record decisions from the studio check-in.\n',
      );
      await vault.create('Ideas.md', 'Ideas for future projects.\n');
      await plugin.createTask({
        title: 'Review the launch brief',
        when: dates.tomorrow,
        order: -300,
      });
      await plugin.createTask({
        title: rescheduleTitle,
        when: dates.tomorrow,
        deadline: dates.deadline,
        order: -299,
      });
      await plugin.createTask({ title: 'File the receipt' });
    },
    { dates: { tomorrow: dayAfter(1), deadline: dayAfter(4) }, rescheduleTitle, shortcut },
  );
  assert.ok(
    await page.evaluate(
      (key) => require('@electron/remote').globalShortcut.isRegistered(key),
      shortcut,
    ),
  );
  await page.waitForFunction(
    (themeClass) =>
      app.customCss.theme === 'Things' && document.body.classList.contains(themeClass),
    themeClass,
  );
  for (const [folder, name] of [
    ['Projects', 'Studio Launch'],
    ['Reference', 'Brand guidelines'],
  ]) {
    const item = sidebar.getByText(name, { exact: true });
    if (!(await item.isVisible()))
      await sidebar
        .locator('.nav-folder-title[data-path="' + folder + '"]')
        .evaluate((el) => el.click());
    await item.waitFor();
  }
  await page.locator('.workspace-drawer-vault-name').evaluate((el) => {
    el.textContent = 'Studio';
  });
  await addPointer(page);

  await openList('upcoming');
  const start = row(rescheduleTitle);
  const destinationDate = dayAfter(2);
  const destination = active.locator('section[data-date="' + destinationDate + '"]');
  const end = destination.locator('.ot-drop-end');
  await start.waitFor();
  await end.waitFor({ state: 'attached' });
  await record(
    'reschedule',
    page,
    area,
    async () => {
      const fromBox = await start.boundingBox();
      const targetBox = await end.boundingBox();
      assert.ok(fromBox && targetBox);
      const from = { x: fromBox.x + 99, y: fromBox.y + fromBox.height / 2 };
      const to = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
      await page.mouse.move(from.x, from.y, { steps: 12 });
      await wait(680);
      const task = await start.elementHandle();
      assert.ok(task);
      try {
        await task.evaluate(
          async (el, { from, to }) => {
            const drag = el._otTouchDrag;
            const pointer = document.getElementById('demo-pointer');
            drag.down({ clientX: from.x, clientY: from.y });
            for (let step = 1; step <= 25; step++) {
              const clientX = from.x + ((to.x - from.x) * step) / 25;
              const clientY = from.y + ((to.y - from.y) * step) / 25;
              pointer.style.left = clientX + 'px';
              pointer.style.top = clientY + 'px';
              drag.move({ clientX, clientY });
              await new Promise((resolve) => setTimeout(resolve, 23));
            }
          },
          { from, to },
        );
        await destination.locator('.ot-drop-end.is-over').waitFor();
        await wait(650);
        await task.evaluate((el) => el._otTouchDrag.up());
      } finally {
        await task.evaluate((el) => el._otTouchDrag.cancel());
        await task.dispose();
      }
      await destination.getByText(rescheduleTitle, { exact: true }).waitFor();
      await waitForAsync(
        page,
        async ({ title, when, deadline }) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
            ({ meta }) => meta.title === title && meta.when === when && meta.deadline === deadline,
          ),
        { title: rescheduleTitle, when: destinationDate, deadline: dayAfter(4) },
      );
    },
    { lead: 720, tail: 1500 },
  );

  await openList('inbox');
  await active.getByRole('heading', { name: 'Inbox', exact: true }).waitFor();
  await sidebar.getByText('Studio Launch', { exact: true }).waitFor();
  await row('File the receipt').waitFor();
  await page.mouse.move(1040, 70, { steps: 12 });
  await record(
    'capture-inbox',
    page,
    area,
    async () => {
      const modal = page.locator('.ot-capture-modal:visible');
      try {
        await pressGlobalShortcut();
        await modal.waitFor({ timeout: 1750 });
        console.log('Opened Quick Capture from Finder with the native global shortcut.');
      } catch (error) {
        shortcutFallback = true;
        console.log('Native shortcut input could not be delivered:', error.message.split('\n')[0]);
        await page.evaluate(() => app.plugins.getPlugin('thingsmd').openGlobalCapture());
        await modal.waitFor();
      }
      await focus();
      const title = modal.getByLabel('Task title', { exact: true });
      await title.focus();
      await wait(360);
      for (const text of ['Buy', 'Buy some', capturedTitle]) {
        await title.fill(text);
        await wait(240);
      }
      assert.equal(await title.inputValue(), capturedTitle);
      const save = modal.getByRole('button', { name: 'Save', exact: true });
      const saveBox = await save.boundingBox();
      assert.ok(saveBox);
      await page.mouse.move(saveBox.x + saveBox.width / 2, saveBox.y + saveBox.height / 2, {
        steps: 12,
      });
      await wait(660);
      await save.evaluate((el) => el.click());
      await modal.waitFor({ state: 'hidden' });
      await row(capturedTitle).waitFor();
      await waitForAsync(
        page,
        async (title) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
            ({ meta }) => meta.title === title,
          ),
        capturedTitle,
      );
    },
    { lead: 950, tail: 1850 },
  );
  if (shortcutFallback)
    console.log('The capture and saved Inbox task were verified using the native capture handler.');
} catch (error) {
  await page.screenshot({ path: 'artifacts/screencast/v7-capture-failure.png' });
  throw error;
} finally {
  if (saved)
    await page.evaluate(async (before) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      await plugin.captureModal?.close();
      const leaf = workspace.getLeafById(before.leafId);
      await leaf.setViewState(before.viewState);
      workspace.setActiveLeaf(leaf, { focus: true });
      await plugin.setGlobalCaptureHotkey(before.shortcut);
      await plugin.updateSettings(before.settings);
      for (const file of vault.getMarkdownFiles()) await vault.delete(file, true);
      for (const path of ['Projects', 'Reference']) {
        const folder = vault.getAbstractFileByPath(path);
        if (folder) await vault.delete(folder, true);
      }
      workspace.leftSplit.setSize(before.leftSize);
      const picker = document.querySelector('.workspace-drawer-vault-name');
      if (picker?.textContent === 'Studio') picker.textContent = vault.getName();
      document.getElementById('demo-pointer')?.remove();
      await app.customCss.setTheme(before.theme);
      app.changeTheme(before.colorMode);
    }, saved);
  if (frameStyle) await frameStyle.evaluate((element) => element.remove());
  if (themeCreated) await rm(themePath, { recursive: true });
  if (themesCreated) await rmdir(settingsTheme);
  await browser.close();
}
