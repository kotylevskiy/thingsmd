import { colorMode, themeClass, themeSource } from './capture-config.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connectTestVault } from '../../scripts/obsidian-connection.mjs';
import { testVault } from '../../scripts/test-vault.mjs';
import { waitForAsync } from '../../scripts/wait-for-async.mjs';
import { dayAfter } from '../../plugin/shared/local-date.cjs';
import { addPointer, record } from './recorder.mjs';

const vaultRoot = await testVault();
const { browser, page } = await connectTestVault();
const viewport = { width: 1100, height: 620 };
const area = { ...viewport, x: 0, y: 0 };
const themes = join(vaultRoot, '.obsidian', 'themes');
const themePath = join(themes, 'Things');
const active = page.locator('.workspace-leaf.mod-active');
const sidebar = page.locator('.workspace-split.mod-left-split');
const dragNote = 'Projects/Editorial checklist.md';
const datesNote = 'Projects/Plan the launch.md';
const migration = 'Projects/Launch checklist.md';
const scheduleTitle = 'Set a start date and deadline for this task';
const dragTitle = 'Drag this task to the top';
const datedTasks = [
  { title: 'Review the proposal', when: dayAfter(1), deadline: dayAfter(3), format: 'emoji' },
  { title: 'Book the design review', when: dayAfter(2), deadline: dayAfter(4), format: 'dataview' },
  { title: 'Send the launch brief', when: null, deadline: dayAfter(5), format: 'emoji' },
  { title: 'Confirm print delivery', when: null, deadline: dayAfter(6), format: 'dataview' },
].map((task) => {
  const { title, when, deadline, format } = task;
  const schedule = when ? (format === 'emoji' ? ' ⏳ ' + when : ' [scheduled:: ' + when + ']') : '';
  const due = format === 'emoji' ? ' 📅 ' + deadline : ' [due:: ' + deadline + ']';
  return { ...task, line: '- [ ] ' + title + schedule + due };
});
const noteLines = [
  'Bring launch tasks and their dates into ThingsMD.',
  '',
  '## Convert a selection',
  ...datedTasks.slice(0, 2).map((task) => task.line),
  '',
  '## Convert all tasks in the note',
  ...datedTasks.slice(2).map((task) => task.line),
  '',
];
let previous;
let themesCreated;
let themeCreated;
let frameStyle;

const row = (title) => active.locator('.ot-task:visible').filter({ hasText: title });
async function showNote(path) {
  await page.evaluate(async (path) => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.setViewState({
      type: 'markdown',
      state: { file: path, mode: 'source', source: false },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, path);
}
async function pointAt(locator, offset = 65) {
  const box = await locator.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + Math.min(offset, box.width / 2), box.y + box.height / 2, {
    steps: 10,
  });
}
async function chooseCommand(search, match) {
  assert.ok(await page.evaluate(() => app.commands.executeCommandById('command-palette:open')));
  const prompt = page.locator('.prompt:visible');
  const input = prompt.locator('.prompt-input');
  const words = search.split(' ');
  for (let length = 1; length <= words.length; length++) {
    await input.fill(words.slice(0, length).join(' '));
    await wait(180);
  }
  const item = prompt.locator('.suggestion-item').filter({ hasText: match });
  await item.waitFor();
  await pointAt(item, 130);
  await wait(1550);
  assert.match(await prompt.locator('.suggestion-item.is-selected').innerText(), match);
  await page.evaluate(() => {
    const palette = app.internalPlugins.getPluginById('command-palette').instance.modal;
    palette.selectActiveSuggestion(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
  await prompt.waitFor({ state: 'hidden' });
}
const verifyConvertedCount = (count) =>
  waitForAsync(
    page,
    async ({ path, count }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
        (task) => task.meta.conversion?.source === path,
      ).length === count,
    { path: migration, count },
  );
function verifyConvertedDates(tasks) {
  return waitForAsync(
    page,
    async ({ path, tasks }) => {
      const saved = (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
        (record) => record.meta.conversion?.source === path,
      );
      return tasks.every((original) =>
        saved.some(
          ({ meta }) =>
            meta.title === original.title &&
            meta.deadline === original.deadline &&
            (!original.when || meta.when === original.when) &&
            meta.conversion.format === original.format,
        ),
      );
    },
    { path: migration, tasks },
  );
}

try {
  page.setDefaultTimeout(6500);
  previous = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    if (
      app.vault.getMarkdownFiles().length ||
      (await p.taskRecords()).length ||
      app.vault.getAbstractFileByPath('Projects') ||
      app.vault.getAbstractFileByPath('Reference')
    )
      throw Error('Recordings require the empty disposable vault');
    return {
      settings: { taskNotesTab: p.settings.taskNotesTab },
      colorMode: app.vault.getConfig('theme') || 'system',
      theme: app.customCss.theme,
      leftSize: app.workspace.leftSplit.size,
      leafId: app.workspace.activeLeaf.id,
      viewState: app.workspace.activeLeaf.getViewState(),
    };
  });
  themesCreated = await mkdir(themes, { recursive: true });
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
    async ({ dragNote, datesNote, migration, noteLines, scheduleTitle, dragTitle }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      workspace.leftSplit.expand();
      workspace.leftSplit.setSize(212);
      workspace.rightSplit.collapse();
      await p.updateSettings({ taskNotesTab: 'current' });
      await vault.createFolder('Projects');
      await vault.createFolder('Reference');
      await vault.create(
        dragNote,
        'Prepare the release announcement, screenshots, and final copy.\n\n## Next actions\n\n',
      );
      await vault.create(
        datesNote,
        'Decide when work should show up and when it needs to be done.\n\n',
      );
      await vault.create(migration, noteLines.join('\n'));
      await vault.create('Reference/Brand guidelines.md', 'Use the launch colors consistently.\n');
      await vault.create(
        'Reference/Meeting notes.md',
        'Record decisions from the studio check-in.\n',
      );
      await vault.create('Ideas.md', 'Ideas for future projects.\n');
      for (const [path, titles] of [
        [datesNote, [scheduleTitle]],
        [dragNote, ['Draft the announcement', 'Check the screenshots', dragTitle]],
      ]) {
        const embeds = [];
        for (const title of titles) {
          const task = await p.createTask({ title, project: path });
          embeds.push('![[' + task.file.path.slice(0, -3) + ']]');
        }
        await vault.append(vault.getFileByPath(path), embeds.join('\n') + '\n');
      }
    },
    { dragNote, datesNote, migration, noteLines, scheduleTitle, dragTitle },
  );
  await page.waitForFunction(
    (themeClass) =>
      app.customCss.theme === 'Things' && document.body.classList.contains(themeClass),
    themeClass,
  );
  for (const [folder, name] of [
    ['Projects', 'Plan the launch'],
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

  if (!process.argv.includes('--conversion-only')) {
    await showNote(dragNote);
    const first = row('Draft the announcement');
    const last = row(dragTitle);
    await first.waitFor();
    await last.waitFor();
    await record(
      'drag',
      page,
      area,
      async () => {
        const a = await last.boundingBox();
        const b = await first.boundingBox();
        await pointAt(last, 90);
        await wait(550);
        const source = { x: a.x + 90, y: a.y + a.height / 2 };
        const destination = { x: b.x + 95, y: b.y + 4 };
        await last.locator('.ot-task-title').evaluate((el, { x, y }) => {
          el.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerId: 17,
              pointerType: 'mouse',
              buttons: 1,
              clientX: x,
              clientY: y,
            }),
          );
        }, source);
        await page.evaluate(
          async ({ source, destination }) => {
            const pointer = document.getElementById('demo-pointer');
            for (let frame = 1; frame <= 25; frame++) {
              const clientX = source.x + ((destination.x - source.x) * frame) / 25;
              const clientY = source.y + ((destination.y - source.y) * frame) / 25;
              pointer.style.left = clientX + 'px';
              pointer.style.top = clientY + 'px';
              window.dispatchEvent(
                new PointerEvent('pointermove', {
                  pointerId: 17,
                  pointerType: 'mouse',
                  clientX,
                  clientY,
                  buttons: 1,
                  cancelable: true,
                }),
              );
              await new Promise((resolve) => setTimeout(resolve, 24));
            }
          },
          { source, destination },
        );
        await page.locator('.ot-task-drop-marker:visible').waitFor();
        await wait(550);
        await page.evaluate(
          ({ x, y }) =>
            window.dispatchEvent(
              new PointerEvent('pointerup', {
                pointerId: 17,
                pointerType: 'mouse',
                clientX: x,
                clientY: y,
                cancelable: true,
              }),
            ),
          destination,
        );
        await waitForAsync(
          page,
          (title) =>
            document.querySelector('.workspace-leaf.mod-active .ot-task-title')?.textContent ===
            title,
          dragTitle,
        );
      },
      { lead: 800, tail: 1500 },
    );
  }

  if (!process.argv.includes('--tasks-only')) {
    await showNote(migration);
    await active.locator('.cm-line').filter({ hasText: 'Review the proposal' }).waitFor();
    await record(
      'convert-selection',
      page,
      area,
      async (hint) => {
        const source = active.locator('.cm-line').filter({ hasText: 'Review the proposal' });
        await pointAt(source);
        await page.evaluate(() => {
          const editor = app.workspace.activeLeaf.view.editor;
          const first = editor
            .getValue()
            .split('\n')
            .findIndex((line) => line.includes('Review the proposal'));
          editor.focus();
          editor.setSelection(
            { line: first, ch: 0 },
            { line: first + 1, ch: editor.getLine(first + 1).length },
          );
        });
        assert.match(
          await page.evaluate(() => app.workspace.activeLeaf.view.editor.getSelection()),
          /⏳.*📅.*\n.*\[scheduled::.*\[due::/,
        );
        await wait(1600);
        await chooseCommand('Convert selected tasks', /ThingsMD\s*Convert selected tasks/);
        const convert = page
          .locator('.menu:visible')
          .getByText('Convert to ThingsMD format', { exact: true });
        await convert.waitFor();
        await pointAt(convert);
        await wait(750);
        await convert.evaluate((el) => el.closest('.menu-item').click());
        await verifyConvertedCount(2);
        await verifyConvertedDates(datedTasks.slice(0, 2));
        await row('Review the proposal').waitFor();
        await row('Book the design review').waitFor();
        assert.equal(await row('Send the launch brief').count(), 0);
        hint('Start dates and deadlines carry over');
      },
      { lead: 1950, tail: 2100 },
    );

    await record(
      'convert-note',
      page,
      area,
      async () => {
        await chooseCommand(
          'Convert all tasks to ThingsMD',
          /ThingsMD\s*Convert all tasks to ThingsMD format/,
        );
        await verifyConvertedCount(4);
        await verifyConvertedDates(datedTasks);
        await row('Confirm print delivery').waitFor();
        await row('Send the launch brief').waitFor();
        assert.ok(await active.getByText(noteLines[0]).isVisible());
      },
      { tail: 1850 },
    );

    await record(
      'export-note',
      page,
      area,
      async (hint) => {
        await chooseCommand(
          'Convert all tasks to Tasks Emoji',
          /ThingsMD\s*Convert all tasks to Tasks Emoji\s*\/\s*Dataview format/,
        );
        await verifyConvertedCount(0);
        assert.equal(
          await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
          noteLines.join('\n'),
        );
        hint('The original Markdown fields are restored');
      },
      { tail: 3400 },
    );
  }
} catch (error) {
  await page.screenshot({ path: 'artifacts/screencast/v6-capture-failure.png' });
  throw error;
} finally {
  await page.keyboard.press('Escape').catch(() => {});
  if (previous)
    await page.evaluate(async (before) => {
      const p = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      const leaf = workspace.getLeafById(before.leafId);
      await leaf.setViewState(before.viewState);
      workspace.setActiveLeaf(leaf, { focus: true });
      await p.updateSettings(before.settings);
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
    }, previous);
  if (frameStyle) await frameStyle.evaluate((element) => element.remove());
  if (themeCreated) await rm(themePath, { recursive: true });
  if (themesCreated) await rmdir(themes);
  await browser.close();
}
