import assert from 'node:assert/strict';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault({ settings: { logbook: 'manually' } });
page.setDefaultTimeout(10000);
const prefix = `Conversion ${Date.now()}`;
const path = `${prefix}.md`,
  other = `${prefix} shared.md`;
const source =
  '# Conversion review\n\nTasks from both formats, with context preserved.\n\n- [ ] Prepare release 📅 2099-11-20 ⏫\n- [ ] Review dependencies [dependsOn:: dcf64c,0h17ye] [onCompletion:: delete]\n- [ ] Schedule review (scheduled:: 2099-11-18) (due:: 2099-11-21)\n\nKeep this paragraph.\n';
let leafId;
const originalMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
async function mobile(value) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
}
async function open(mode) {
  await page.evaluate(
    async ({ path, leafId, mode }) => {
      const leaf = app.workspace.getLeafById(leafId) || app.workspace.getLeaf('tab');
      await leaf.setViewState({
        type: 'markdown',
        state: { file: path, mode, source: false },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      await app.workspace.revealLeaf(leaf);
    },
    { path, leafId, mode },
  );
}
async function findSelectionCommand() {
  assert.equal(
    await page.evaluate(() => app.commands.executeCommandById('command-palette:open')),
    true,
  );
  const prompt = page.locator('.prompt');
  const input = prompt.locator('.prompt-input');
  await input.fill('Convert selected tasks');
  const result = prompt.locator('.suggestion-item').filter({
    hasText: /ThingsMD\s*Convert selected tasks/,
  });
  await result.waitFor();
  return { result, input };
}
async function convertFromPalette(format, { mouse = false } = {}) {
  const { result, input } = await findSelectionCommand();
  if (mouse) await result.click();
  else await input.press('Enter');
  await page.locator('.menu').getByText(`Convert to ${format}`, { exact: true }).click();
}
try {
  if (process.argv.includes('--mobile') && !originalMobile) await mobile(true);
  await page.setViewportSize(
    process.argv.includes('--mobile') ? { width: 390, height: 844 } : { width: 1200, height: 850 },
  );
  leafId = await page.evaluate(
    async ({ path, source }) => {
      await app.vault.create(path, source);
      return app.workspace.getLeaf('tab').id;
    },
    { path, source },
  );
  await open('preview');
  const active = page.locator('.workspace-leaf.mod-active');
  await active.locator('li.task-list-item').nth(2).waitFor();
  assert.equal(
    await page.evaluate(() =>
      app.commands.commands['thingsmd:convert-selected-tasks'].checkCallback(true),
    ),
    false,
  );
  // A partial text selection must convert exactly the first item.
  const selectFirstTask = () =>
    active
      .locator('li.task-list-item')
      .first()
      .evaluate((el) => {
        const text = [...el.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes('Prepare'),
        );
        const range = document.createRange();
        range.setStart(text, 2);
        range.setEnd(text, 8);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
  await selectFirstTask();
  await findSelectionCommand();
  await page.keyboard.press('Escape');
  await page.locator('.prompt').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => {
      document.getSelection().removeAllRanges();
      return app.commands.commands['thingsmd:convert-selected-tasks'].checkCallback(true);
    }),
    false,
    'Closing the palette releases its Reading view selection',
  );
  await selectFirstTask();
  await convertFromPalette('ThingsMD format');
  await waitForAsync(
    page,
    async (path) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
        (t) => t.meta.conversion?.source === path,
      ).length === 1,
    path,
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.workspace-leaf.mod-active li.task-list-item').length === 2,
  );
  assert.equal(await active.locator('li.task-list-item').count(), 2);
  // Current-note command uses the live buffer and creates the remaining cards.
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:convert-note-to-thingsmd'));
  await waitForAsync(
    page,
    async (path) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
        (t) => t.meta.conversion?.source === path,
      ).length === 3,
    path,
  );
  await active.locator('.ot-native:visible').nth(2).waitFor();
  const tag = process.argv.includes('--mobile') ? '-mobile' : '';
  await page.screenshot({ path: `artifacts/conversion-reading${tag}.png` });
  assert.ok((await active.innerText()).includes('Keep this paragraph.'));
  await open('source');
  await active.locator('.ot-native:visible').nth(2).waitFor();
  await page.screenshot({ path: `artifacts/conversion-live-preview${tag}.png` });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('upcoming'));
  await active.locator('.ot-task').filter({ hasText: 'Schedule review' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `artifacts/conversion-list${tag}.png` });
  await open('preview');
  // Reverse selection: all references are restored without a second confirmation.
  const firstPath = await page.evaluate(
    async ({ path, other }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const t = (await p.taskRecords()).find(
        (t) => t.meta.conversion?.source === path && t.meta.title === 'Prepare release',
      );
      await p.patchTask(
        t,
        { title: 'Prepare reviewed release' },
        'Release notes\n\n- Verify package',
        { notify: false },
      );
      await app.vault.create(other, `# Another note\n\n![[${t.file.path.replace(/\.md$/, '')}]]\n`);
      return t.file.path;
    },
    { path, other },
  );
  await page.waitForTimeout(300);
  await active
    .locator('.ot-native:visible')
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await convertFromPalette('Tasks Emoji / Dataview format', { mouse: true });
  await waitForAsync(
    page,
    async (firstPath) => !(await app.vault.adapter.exists(firstPath)),
    firstPath,
  );
  assert.match(
    await page.evaluate((other) => app.vault.adapter.read(other), other),
    /Prepare reviewed release.*📅 2099-11-20 ⏫\n  Release notes/,
  );
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:convert-note-to-inline'));
  await waitForAsync(
    page,
    async (path) =>
      !(await app.plugins.getPlugin('thingsmd').taskRecords()).some(
        (t) => t.meta.conversion?.source === path,
      ),
    path,
  );
  const restored = await page.evaluate((path) => app.vault.adapter.read(path), path);
  assert.ok(restored.includes('[dependsOn:: dcf64c,0h17ye] [onCompletion:: delete]'));
  assert.ok(restored.includes('(scheduled:: 2099-11-18) (due:: 2099-11-21)'));
  // A backward selection uses Live Preview's editor offsets.
  await open('source');
  await page.evaluate(() => {
    const editor = app.workspace.activeLeaf.view.editor;
    const from = editor.getValue().indexOf('Review dependencies');
    editor.setSelection(editor.offsetToPos(from + 8), editor.offsetToPos(from + 2));
  });
  await convertFromPalette('ThingsMD format', { mouse: true });
  await active.locator('.ot-native:visible .ot-task').waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      app.workspace.activeLeaf.view.editor.listSelections().map(({ anchor, head }) => ({
        collapsed: anchor.line === head.line && anchor.ch === head.ch,
      })),
    ),
    [{ collapsed: true }],
    'Conversion consumes the selection and leaves one caret',
  );
  await active.locator('.ot-native:visible .ot-task').click({ button: 'right' });
  await page
    .locator('.menu')
    .getByText('Convert to Tasks Emoji / Dataview format', { exact: true })
    .click();
  await waitForAsync(
    page,
    async (path) =>
      !(await app.plugins.getPlugin('thingsmd').taskRecords()).some(
        (task) => task.meta.conversion?.source === path,
      ),
    path,
  );
  // Settings end with conversion, and vault-wide conversion requires confirmation.
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const settings = await settingsPage(page);
  assert.equal(
    await settings.locator('.vertical-tab-content .setting-item-name').last().innerText(),
    'Convert vault to Tasks Emoji / Dataview format',
  );
  const button = settings.getByRole('button', {
    name: 'Convert vault to ThingsMD format',
    exact: true,
  });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await settings.getByRole('heading', { name: 'Convert vault to ThingsMD format?' }).waitFor();
  assert.ok(
    (await settings.locator('.modal-content').last().innerText()).includes('selected tasks'),
  );
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await settings
    .getByRole('heading', { name: 'Convert vault to ThingsMD format?' })
    .waitFor({ state: 'hidden' });
  await settings.waitForTimeout(200);
  await settings.screenshot({ path: `artifacts/conversion-settings${tag}.png` });
  console.log(
    'PASS: palette selection in Reading view and Live Preview, note commands, list rendering, shared references, descriptions, exact preserved fields, settings ordering and vault confirmation.',
  );
} catch (error) {
  await page.screenshot({
    path: `artifacts/conversion-failure${process.argv.includes('--mobile') ? '-mobile' : ''}.png`,
  });
  console.error(
    await page.evaluate(
      async (path) => ({
        mode: app.workspace.activeLeaf?.view.getMode?.(),
        file: app.workspace.activeLeaf?.view.file?.path,
        text: await app.vault.adapter.read(path),
        cards: [...document.querySelectorAll('.workspace-leaf.mod-active .ot-native')].map(
          (el) => ({ path: el.dataset.taskPath, visible: !!el.offsetHeight, text: el.textContent }),
        ),
      }),
      path,
    ),
  );
  throw error;
} finally {
  if (await page.locator('.prompt-input').isVisible()) await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const modal of document.querySelectorAll('.modal-content'))
      if (modal.querySelector('h2')?.textContent.startsWith('Convert vault to'))
        [...modal.querySelectorAll('button')]
          .find((button) => button.textContent === 'Cancel')
          ?.click();
  });
  await page.evaluate(
    async ({ path, other, leafId }) => {
      app.setting.close();
      const p = app.plugins.getPlugin('thingsmd');
      app.workspace.getLeafById(leafId)?.detach();
      for (const t of await p.taskRecords())
        if (t.meta.conversion?.source === path) await p.deleteTask(t.file);
      for (const name of [path, other]) {
        const file = app.vault.getAbstractFileByPath(name);
        if (file) await app.vault.delete(file);
      }
      await p.openList('inbox');
    },
    { path, other, leafId },
  );
  if (process.argv.includes('--mobile') && !originalMobile) await mobile(false);
  await browser.close();
}
