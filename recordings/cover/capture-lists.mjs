import { colorMode, rawDirectory, themeClass, themeSource } from './capture-config.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connectTestVault } from '../../scripts/obsidian-connection.mjs';
import { waitForAsync } from '../../scripts/wait-for-async.mjs';
import { dayAfter } from '../../plugin/shared/local-date.cjs';
import { record, addPointer } from './recorder.mjs';

const { browser, page } = await connectTestVault();
const themes = join(process.env.THINGSMD_TEST_VAULT, '.obsidian', 'themes');
const theme = join(themes, 'Things');
const output = rawDirectory;
const main = page.locator('.workspace-leaf.mod-active');
const sidebar = page.locator('.workspace-split.mod-left-split');
const viewport = { width: 1100, height: 620 };
const view = { x: 0, y: 0, ...viewport };
let previous;
let themeMade = false;
let themesMade;
let style;
const only = (id) => !process.argv[2] || process.argv.includes(id);
const focus = () =>
  page.evaluate(() => {
    require('@electron/remote').getCurrentWindow().focus();
    window.focus();
  });
async function showList(id, title) {
  const button = sidebar.locator('.ot-list-link[data-list="' + id + '"]');
  if (await button.count()) {
    const box = await button.boundingBox();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 9 });
    await button.evaluate((el) => el.click());
  } else {
    await page.evaluate(() => app.commands.executeCommandById('thingsmd:show-repeating'));
  }
  await main.locator('.ot-paper h1').getByText(title, { exact: true }).waitFor();
  await wait(180);
}
async function showNote(path) {
  await page.evaluate(async (path) => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.openFile(app.vault.getFileByPath(path));
    await leaf.setViewState({
      type: 'markdown',
      state: { file: path, mode: 'source', source: false },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, path);
}
async function still(id) {
  await mkdir(join(output, id), { recursive: true });
  await page.screenshot({ path: join(output, id, 'still.png'), scale: 'device' });
}
const byTitle = (title) =>
  page.locator('.workspace-split.mod-root .ot-task:visible').filter({ hasText: title }).first();

try {
  page.setDefaultTimeout(6500);
  await focus();
  previous = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    if (
      app.vault.getMarkdownFiles().length ||
      (await p.taskRecords()).length ||
      app.vault.getAbstractFileByPath('Projects') ||
      app.vault.getAbstractFileByPath('Reference')
    )
      throw Error('The screencast requires the empty disposable vault');
    return {
      settings: p.settings,
      mode: app.vault.getConfig('theme') || 'system',
      theme: app.customCss.theme,
      size: app.workspace.leftSplit.size,
      id: app.workspace.activeLeaf.id,
      state: app.workspace.activeLeaf.getViewState(),
    };
  });
  themesMade = await mkdir(themes, { recursive: true });
  await mkdir(theme);
  themeMade = true;
  await cp(themeSource, theme, { recursive: true });
  await page.setViewportSize(viewport);
  style = await page.addStyleTag({
    content: '.status-bar, .tooltip, .notice-container { visibility: hidden; }',
  });
  await page.evaluate(async (mode) => {
    await app.customCss.readThemes(false);
    await app.customCss.setTheme('Things');
    app.changeTheme(mode);
  }, colorMode);
  await page.evaluate(
    async (fixture) => {
      const p = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      workspace.leftSplit.expand();
      workspace.leftSplit.setSize(212);
      workspace.rightSplit.collapse();
      await p.updateSettings({
        enableWaiting: true,
        captureDestination: 'inbox',
        logbook: 'manually',
        trashRetention: 'never',
        showProjectProgress: true,
        taskNotesTab: 'current',
      });
      await vault.createFolder('Projects');
      await vault.createFolder('Reference');
      const project = 'Projects/Studio Launch.md';
      await vault.create(
        project,
        'Plan a small studio launch and publish the first-run guide.\n\n## Next actions\n\n',
      );
      await vault.create(
        'Projects/Editorial checklist.md',
        'Prepare the release announcement, screenshots, and final copy.\n\n## Next actions\n\n',
      );
      await vault.create('Reference/Brand guidelines.md', 'Use the launch colors consistently.\n');
      await vault.create(
        'Reference/Meeting notes.md',
        'Record decisions from the studio check-in.\n',
      );
      await vault.create('Ideas.md', 'Ideas for future projects.\n');
      const add = (title, props = {}) => p.createTask({ title, ...props });
      await add('Write down ideas for the launch');
      const brief = await add('Review the onboarding checklist', { when: 'today', project });
      await add('Pick up the print samples', { when: 'evening' });
      await add('Rehearse the walkthrough', { when: fixture.tomorrow });
      await add('Draft the next announcement', { when: 'anytime' });
      await add('Confirm the delivery window', { is_waiting: true });
      await add('Plan a studio open day', { when: 'someday' });
      const finished = await add('Agree on the launch date', { status: 'done' });
      await p.logCompleted(finished);
      await p.trashTask(await add('Print a draft handout'));
      await add('Review the plan every week', {
        repeat: { mode: 'regular', next: fixture.tomorrow, interval: 1, unit: 'week' },
      });
      const embed = (t) => '![[' + t.file.path.slice(0, -3) + ']]';
      const launch = vault.getAbstractFileByPath(project);
      await vault.append(launch, embed(brief) + '\n\n');
      const draft = vault.getAbstractFileByPath('Projects/Editorial checklist.md');
      for (const title of [
        'Draft the announcement',
        'Check screenshots',
        'Review the final copy',
      ]) {
        const task = await add(title, { project: draft.path });
        await vault.append(draft, embed(task) + '\n');
      }
    },
    { tomorrow: dayAfter(1) },
  );
  await page.waitForFunction(
    (themeClass) =>
      app.customCss.theme === 'Things' && document.body.classList.contains(themeClass),
    themeClass,
  );
  for (const [folder, note] of [
    ['Projects', 'Studio Launch'],
    ['Reference', 'Brand guidelines'],
  ]) {
    const item = sidebar.getByText(note, { exact: true });
    if (!(await item.isVisible()))
      await sidebar
        .locator('.nav-folder-title[data-path="' + folder + '"]')
        .evaluate((el) => el.click());
    await item.waitFor();
  }
  const picker = page.locator('.workspace-drawer-vault-name');
  await picker.evaluate((el) => {
    el.textContent = 'Studio';
  });
  await addPointer(page);

  if (only('lists')) {
    await showList('today', 'Today');
    const notes = sidebar.getByText('Studio Launch', { exact: true });
    const box = await notes.boundingBox();
    await page.mouse.move(box.x - 10, box.y + box.height / 2);
    await record(
      'intro',
      page,
      view,
      async () => {
        const targets = [sidebar.getByText('Today', { exact: true }), notes];
        for (const target of targets) {
          const rect = await target.boundingBox();
          for (let i = 0; i < 12; i++) {
            await page.mouse.move(rect.x + 8 + i, rect.y + rect.height / 2, { steps: 2 });
            await wait(14);
          }
          await wait(650);
        }
      },
      { lead: 650, tail: 1700 },
    );
    for (const [id, label] of [
      ['inbox', 'Inbox'],
      ['today', 'Today'],
      ['upcoming', 'Upcoming'],
      ['anytime', 'Anytime'],
      ['waiting', 'Waiting For'],
      ['someday', 'Someday'],
      ['logbook', 'Logbook'],
      ['trash', 'Trash'],
      ['repeating', 'Repeating'],
    ]) {
      await showList(id, label);
      if (id === 'repeating') await page.mouse.move(810, 27);
      await still('list-' + id);
    }
  }

  if (only('create')) {
    await showList('today', 'Today');
    const target = sidebar.getByText('Studio Launch', { exact: true });
    await record(
      'create',
      page,
      view,
      async (hint) => {
        await hint('Open a project note from the sidebar');
        const box = await target.boundingBox();
        await page.mouse.move(box.x + 55, box.y + box.height / 2, { steps: 12 });
        await wait(420);
        await target.evaluate((el) => el.click());
        await showNote('Projects/Studio Launch.md');
        await main.locator('.cm-line').filter({ hasText: 'Plan a small studio launch' }).waitFor();
        await focus();
        await page.evaluate(() => {
          const ed = app.workspace.activeLeaf.view.editor;
          ed.focus();
          ed.setCursor({ line: ed.lastLine(), ch: 0 });
        });
        await wait(420);
        await hint('Type + and press Space on an empty line');
        await page.keyboard.insertText('+');
        await page.waitForFunction(
          () =>
            app.workspace.activeLeaf.view.editor.getLine(
              app.workspace.activeLeaf.view.editor.lastLine(),
            ) === '+',
        );
        await wait(850);
        await page.evaluate(() => {
          const editor = app.workspace.activeLeaf.view.editor;
          editor.focus();
          editor.setCursor({ line: editor.lastLine(), ch: 1 });
        });
        await page.keyboard.insertText(' ');
        const title = main.locator('.ot-title-input:visible');
        try {
          await title.waitFor();
        } catch (error) {
          console.log(
            await page.evaluate(() => ({
              mode: app.workspace.activeLeaf.view.getState().mode,
              source: app.workspace.activeLeaf.view.getState().source,
              last: app.workspace.activeLeaf.view.editor.getLine(
                app.workspace.activeLeaf.view.editor.lastLine(),
              ),
            })),
          );
          throw error;
        }
        await hint('Enter the task title');
        await title.focus();
        for (const part of ['Send ', 'Send the ', 'Send the launch ', 'Send the launch brief']) {
          await title.fill(part);
          await wait(210);
        }
        assert.equal(await title.inputValue(), 'Send the launch brief');
        await wait(550);
        await hint('Press Tab from the title to edit the description');
        await title.dispatchEvent('keydown', {
          key: 'Tab',
          code: 'Tab',
          bubbles: true,
          cancelable: true,
        });
        await page.waitForFunction(
          () =>
            app.workspace.activeLeaf.view.file?.path?.startsWith('ThingsMD/') &&
            !!app.workspace.activeLeaf.view.editor,
        );
        await wait(600);
        await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus());
        for (const part of ['Include the launch date ', 'and a link ', 'to the guide.']) {
          await page.keyboard.insertText(part);
          await wait(210);
        }
        await waitForAsync(page, () =>
          app.workspace.activeLeaf.view.editor
            .getValue()
            .includes('Include the launch date and a link to the guide.'),
        );
        await page.evaluate(() => app.workspace.activeLeaf.view.save(false));
        await wait(550);
        await hint('The task stays embedded in the project note');
        await showNote('Projects/Studio Launch.md');
        await byTitle('Send the launch brief').waitFor();
        await waitForAsync(page, async () => {
          const p = app.plugins.getPlugin('thingsmd');
          return (await p.taskRecords()).some(
            (t) =>
              t.meta.title === 'Send the launch brief' &&
              t.body.includes('Include the launch date'),
          );
        });
      },
      { lead: 450, tail: 1250 },
    );
  }

  if (only('drag')) {
    await showNote('Projects/Editorial checklist.md');
    const first = byTitle('Draft the announcement'),
      last = byTitle('Review the final copy');
    await first.waitFor();
    await last.waitFor();
    await focus();
    await record(
      'drag',
      page,
      view,
      async (hint) => {
        await hint('Embed task cards beside the rest of the note');
        await wait(900);
        await hint('Drag a task above another to reorder it');
        const a = await last.boundingBox(),
          b = await first.boundingBox();
        await page.mouse.move(a.x + 90, a.y + a.height / 2, { steps: 12 });
        await wait(360);
        const source = { x: a.x + 90, y: a.y + a.height / 2 };
        const destination = { x: b.x + 110, y: b.y + 4 };
        await last
          .locator('.ot-task-title')
          .first()
          .evaluate((el, { x, y }) => {
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
            for (let i = 1; i <= 25; i++) {
              const clientX = source.x + ((destination.x - source.x) * i) / 25;
              const clientY = source.y + ((destination.y - source.y) * i) / 25;
              const pointer = document.getElementById('demo-pointer');
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
        await wait(650);
        await page.evaluate(({ x, y }) => {
          window.dispatchEvent(
            new PointerEvent('pointerup', {
              pointerId: 17,
              pointerType: 'mouse',
              clientX: x,
              clientY: y,
              cancelable: true,
            }),
          );
        }, destination);
        await waitForAsync(page, () => {
          const rows = [...document.querySelectorAll('.workspace-leaf.mod-active .ot-task')];
          return rows[0]?.textContent.includes('Review the final copy');
        });
      },
      { lead: 500, tail: 1350 },
    );
  }
} finally {
  if (previous)
    await page.evaluate(async (before) => {
      const p = app.plugins.getPlugin('thingsmd');
      const { vault, workspace } = app;
      const original = workspace.getLeafById(before.id);
      await original.setViewState(before.state);
      workspace.setActiveLeaf(original, { focus: true });
      await p.updateSettings(before.settings);
      for (const file of vault.getMarkdownFiles()) await vault.delete(file, true);
      for (const path of ['Projects', 'Reference']) {
        const folder = vault.getAbstractFileByPath(path);
        if (folder) await vault.delete(folder, true);
      }
      workspace.leftSplit.setSize(before.size);
      const picker = document.querySelector('.workspace-drawer-vault-name');
      if (picker?.textContent === 'Studio') picker.textContent = vault.getName();
      document.getElementById('demo-pointer')?.remove();
      await app.customCss.setTheme(before.theme);
      app.changeTheme(before.mode);
    }, previous);
  if (style) await style.evaluate((el) => el.remove());
  if (themeMade) await rm(theme, { recursive: true });
  if (themesMade) await rmdir(themes);
  await browser.close();
}
