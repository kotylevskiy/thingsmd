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

const root = await testVault();
const { browser, page } = await connectTestVault();
const viewport = { width: 1100, height: 620 };
const area = { x: 0, y: 0, ...viewport };
const themes = join(root, '.obsidian', 'themes');
const theme = join(themes, 'Things');
const active = page.locator('.workspace-leaf.mod-active');
const sidebar = page.locator('.workspace-split.mod-left-split');
const project = 'Projects/Studio Launch.md';
const datesNote = 'Projects/Plan the launch.md';
const scheduleTitle = 'Set a start date and deadline for this task';
const taskTitle = 'Type + then Space on a blank line to create a task';
const description = [
  'Press Tab from the title to start writing a description.',
  'Each task is stored as a Markdown note. Its card stays in the note where you created it.',
];
let original;
let themesCreated;
let themeCreated;
let frameStyle;

const row = (title) => active.locator('.ot-task:visible').filter({ hasText: title });
async function openNote(path) {
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
async function showPointer(locator, { click = false, offset } = {}) {
  const box = await locator.boundingBox();
  assert.ok(box);
  const x = box.x + (offset ?? box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 9 });
  await page.evaluate(
    ({ x, y, click }) => {
      const pointer = document.getElementById('demo-pointer');
      let layer = document.getElementById('demo-pointer-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'demo-pointer-layer';
        layer.popover = 'manual';
        layer.style.cssText =
          'position:fixed;inset:0 auto auto 0;margin:0;padding:0;border:0;width:0;height:0;overflow:visible;background:transparent;pointer-events:none;';
        document.body.append(layer);
        layer.append(pointer);
      }
      if (layer.matches(':popover-open')) layer.hidePopover();
      layer.showPopover();
      Object.assign(pointer.style, {
        display: 'block',
        left: x + 'px',
        top: y + 'px',
        borderColor: '#f2f5ff',
        background: click ? '#64a1fd' : '#526fabe8',
        boxShadow: click ? '0 0 0 6px #5698f46b' : '0 0 0 2px #151d2acc',
      });
    },
    { x, y, click },
  );
}
async function clickControl(locator, offset) {
  await showPointer(locator, { offset });
  await wait(425);
  await showPointer(locator, { click: true, offset });
  await wait(170);
  await locator.evaluate((el) => el.click());
}

async function typeText(input, text, interval, onType) {
  await input.focus();
  let typed = '';
  for (const character of text) {
    await page.keyboard.insertText(character);
    typed += character;
    if (onType) {
      assert.equal(await input.inputValue(), typed);
      await onType(typed);
    }
    await wait(interval);
  }
  assert.equal(await input.inputValue(), text);
}

try {
  page.setDefaultTimeout(6500);
  original = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('thingsmd');
    if (
      app.vault.getMarkdownFiles().length ||
      (await plugin.taskRecords()).length ||
      app.vault.getAbstractFileByPath('Projects') ||
      app.vault.getAbstractFileByPath('Reference')
    )
      throw Error('Recordings require the empty disposable vault');
    return {
      taskNotesTab: plugin.settings.taskNotesTab,
      enableWaiting: plugin.settings.enableWaiting,
      colorMode: app.vault.getConfig('theme') || 'system',
      theme: app.customCss.theme,
      leftSize: app.workspace.leftSplit.size,
      leafId: app.workspace.activeLeaf.id,
      viewState: app.workspace.activeLeaf.getViewState(),
    };
  });
  themesCreated = await mkdir(themes, { recursive: true });
  await mkdir(theme);
  themeCreated = true;
  await cp(themeSource, theme, { recursive: true });
  await page.setViewportSize(viewport);
  frameStyle = await page.addStyleTag({
    content: `
    .status-bar, .tooltip, .notice-container { visibility: hidden; }
    .mod-root .metadata-container, .mod-root .mod-frontmatter,
    .mod-root .HyperMD-frontmatter, .mod-root .HyperMD-frontmatter-begin,
    .mod-root .HyperMD-frontmatter-end { display: none !important; }
    #demo-pointer { width: 19px !important; height: 19px !important; }
  `,
  });
  await page.evaluate(async (mode) => {
    await app.customCss.readThemes(false);
    await app.customCss.setTheme('Things');
    app.changeTheme(mode);
  }, colorMode);
  await page.evaluate(
    async ({ project, datesNote, scheduleTitle }) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      workspace.leftSplit.expand();
      workspace.leftSplit.setSize(212);
      workspace.rightSplit.collapse();
      await plugin.updateSettings({ taskNotesTab: 'current', enableWaiting: true });
      await vault.createFolder('Projects');
      await vault.createFolder('Reference');
      const note = await vault.create(
        project,
        'Plan a small studio launch and publish the first-run guide.\n\n## Next actions\n\n',
      );
      const planner = await vault.create(
        datesNote,
        'Decide when work should show up and when it needs to be done.\n\n',
      );
      await vault.create('Reference/Brand guidelines.md', 'Use the launch colors consistently.\n');
      await vault.create(
        'Reference/Meeting notes.md',
        'Record decisions from the studio check-in.\n',
      );
      await vault.create('Ideas.md', 'Ideas for future projects.\n');
      const example = await plugin.createTask({
        title: 'Review the onboarding checklist',
        when: 'today',
        project,
      });
      await plugin.createTask({ title: 'Pick up the print samples', when: 'evening' });
      const schedule = await plugin.createTask({ title: scheduleTitle, project: datesNote });
      await vault.append(note, '![[' + example.file.path.slice(0, -3) + ']]\n\n');
      await vault.append(planner, '![[' + schedule.file.path.slice(0, -3) + ']]\n');
      await plugin.openList('today');
    },
    { project, datesNote, scheduleTitle },
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
  const projectLink = sidebar.getByText('Studio Launch', { exact: true });
  if (!process.argv.includes('--dates-only'))
    await record(
      'create',
      page,
      area,
      async (mark) => {
        await clickControl(projectLink);
        await openNote(project);
        await active
          .locator('.cm-line')
          .filter({ hasText: 'Plan a small studio launch' })
          .waitFor();
        await page.evaluate(() => {
          const editor = app.workspace.activeLeaf.view.editor;
          editor.focus();
          editor.setCursor({ line: editor.lastLine(), ch: 0 });
          document.getElementById('demo-pointer').style.display = 'none';
        });
        mark('Blank line ready');
        await wait(600);
        await page.keyboard.insertText('+');
        await page.waitForFunction(() => {
          const editor = app.workspace.activeLeaf.view.editor;
          return editor.getLine(editor.lastLine()) === '+';
        });
        await wait(850);
        await page.evaluate(() => {
          const editor = app.workspace.activeLeaf.view.editor;
          editor.setCursor({ line: editor.lastLine(), ch: 1 });
          editor.focus();
        });
        await page.keyboard.insertText(' ');
        const title = active.locator('.ot-title-input:visible');
        await title.waitFor();
        mark('Task card opens');
        await wait(650);
        await typeText(title, taskTitle, 29);
        mark('Task title complete');
        await wait(4250);
        await title.dispatchEvent('keydown', {
          key: 'Tab',
          code: 'Tab',
          bubbles: true,
          cancelable: true,
        });
        await page.waitForFunction(() => {
          const view = app.workspace.activeLeaf.view;
          return view.file?.path.startsWith('ThingsMD/') && !!view.editor;
        });
        mark('Description opens');
        assert.equal(
          await active
            .locator(
              '.metadata-container:visible, .mod-frontmatter:visible, .HyperMD-frontmatter:visible',
            )
            .count(),
          0,
        );
        await wait(400);
        await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus());
        for (const [index, text] of description.entries()) {
          if (index) await page.keyboard.insertText('\n\n');
          for (const group of text.match(/\S+\s*/g)) {
            await page.keyboard.insertText(group);
            await wait(66);
          }
        }
        await page.evaluate(() => app.workspace.activeLeaf.view.save(false));
        await waitForAsync(
          page,
          async ({ taskTitle, description }) => {
            const tasks = await app.plugins.getPlugin('thingsmd').taskRecords();
            return tasks.some(
              (task) =>
                task.meta.title === taskTitle &&
                description.every((text) => task.body.includes(text)),
            );
          },
          { taskTitle, description },
        );
        mark('Description complete');
        await wait(6500);
        await openNote(project);
        await row(taskTitle).waitFor();
        mark('Task card saved');
      },
      { lead: 550, tail: 1580 },
    );

  await openNote(datesNote);
  const id = await row(scheduleTitle).getAttribute('data-task-id');
  assert.ok(id);
  const task = active.locator('.ot-task[data-task-id="' + id + '"]:visible');
  await showPointer(task, { offset: 65 });
  await record(
    'dates',
    page,
    area,
    async (mark) => {
      await wait(400);
      await task.dispatchEvent('dblclick', { bubbles: true });
      for (const [name, field, inputText, offset] of [
        ['When', 'when', 'tomorrow', 1],
        ['Deadline', 'deadline', 'in 4 days', 4],
      ]) {
        const control = task.getByRole('button', { name, exact: true });
        await control.waitFor();
        await clickControl(control);
        const picker = page.locator('.ot-date-picker:visible');
        const input = picker.getByLabel(name + ' date', { exact: true });
        await input.waitFor();
        await showPointer(input, { offset: -12 });
        await wait(280);
        await typeText(input, inputText, name === 'Deadline' ? 245 : 130, async (text) => {
          mark(name + ' search: ' + text);
          await input.evaluate(
            (search) =>
              new Promise((resolve) => {
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    const box = search.getBoundingClientRect();
                    const pointer = document.getElementById('demo-pointer');
                    pointer.style.left = box.x - 12 + 'px';
                    pointer.style.top = box.y + box.height / 2 + 'px';
                    resolve();
                  }),
                );
              }),
          );
        });
        const option = picker.locator('.ot-date-match.is-active');
        await option.waitFor();
        await clickControl(option, 105);
        await picker.waitFor({ state: 'hidden' });
        await waitForAsync(
          page,
          async ({ title, field, value }) =>
            (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
              ({ meta }) => meta.title === title && meta[field] === value,
            ),
          { title: scheduleTitle, field, value: dayAfter(offset) },
        );
      }
      assert.equal(await task.locator('.ot-card-badges button').count(), 2);
    },
    { lead: 640, tail: 1480 },
  );
} catch (error) {
  await page.screenshot({ path: 'artifacts/screencast/v9-capture-failure.png' });
  throw error;
} finally {
  if (original)
    await page.evaluate(async (before) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      const leaf = workspace.getLeafById(before.leafId);
      await leaf.setViewState(before.viewState);
      workspace.setActiveLeaf(leaf, { focus: true });
      await plugin.updateSettings({
        taskNotesTab: before.taskNotesTab,
        enableWaiting: before.enableWaiting,
      });
      for (const file of vault.getMarkdownFiles()) await vault.delete(file, true);
      for (const path of ['Projects', 'Reference']) {
        const folder = vault.getAbstractFileByPath(path);
        if (folder) await vault.delete(folder, true);
      }
      workspace.leftSplit.setSize(before.leftSize);
      const picker = document.querySelector('.workspace-drawer-vault-name');
      if (picker?.textContent === 'Studio') picker.textContent = vault.getName();
      document.getElementById('demo-pointer')?.remove();
      document.getElementById('demo-pointer-layer')?.remove();
      await app.customCss.setTheme(before.theme);
      app.changeTheme(before.colorMode);
    }, original);
  if (frameStyle) await frameStyle.evaluate((element) => element.remove());
  if (themeCreated) await rm(theme, { recursive: true });
  if (themesCreated) await rmdir(themes);
  await browser.close();
}
