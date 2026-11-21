import { colorMode, themeClass, themeSource } from './capture-config.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connectTestVault, settingsPage } from '../../scripts/obsidian-connection.mjs';
import { testVault } from '../../scripts/test-vault.mjs';
import { waitForAsync } from '../../scripts/wait-for-async.mjs';
import { dayAfter } from '../../plugin/shared/local-date.cjs';
import { region, record, finish } from './recorder.mjs';

const exec = promisify(execFile);
const { browser, page } = await connectTestVault();
const cleanFrameStyle = await page.addStyleTag({
  content: '.status-bar, .tooltip { visibility: hidden; }',
});
const original = await page.evaluate(async () => {
  const p = app.plugins.getPlugin('thingsmd');
  if (app.vault.getMarkdownFiles().length || (await p.taskRecords()).length)
    throw Error('The recordings require an empty disposable vault');
  return {
    settings: p.settings,
    theme: app.customCss.theme,
    mode: app.vault.getConfig('theme') || 'system',
    state: app.workspace.activeLeaf.getViewState(),
    leftWidth: app.workspace.leftSplit.size,
  };
});
const themes = join(await testVault(), '.obsidian', 'themes');
const theme = join(themes, 'Things');
const active = page.locator('.workspace-leaf.mod-active');
const notes = {
  release: 'Studio Launch.md',
  drag: 'Editorial checklist.md',
  dates: 'Task planning.md',
  convert: 'Existing tasks.md',
};
let createdTheme = false;
let createdThemes;
let addedCalendar;
let server;
const failures = [];
const errors = [];
page.setDefaultTimeout(7500);

const row = (title) => active.locator('.ot-task:visible').filter({ hasText: title }).first();
const byId = (id) => active.locator('.ot-task[data-task-id="' + id + '"]:visible').first();
const openList = (list) =>
  page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
const command = (id) =>
  page.evaluate((id) => app.commands.executeCommandById('thingsmd:' + id), id);
const make = (title, patch = {}) =>
  page.evaluate(
    async ({ title, patch }) => {
      return app.plugins.getPlugin('thingsmd').createTask({ title, ...patch });
    },
    { title, patch },
  );
const taskState = (id, field, value) =>
  waitForAsync(
    page,
    async ({ id, field, value }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((task) => task.meta.id === id)
        ?.meta[field] === value,
    { id, field, value },
  );
const openNote = (name, body, mode = 'source') =>
  page.evaluate(
    async ({ name, body, mode }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const file = app.vault.getAbstractFileByPath(name) ?? (await app.vault.create(name, body));
      const leaf = p.mainWorkspaceLeaf();
      await leaf.openFile(file);
      await leaf.setViewState({
        type: 'markdown',
        state: { file: name, mode, source: false },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    { name, body, mode },
  );

async function click(scope, locator, position) {
  await locator.waitFor({ state: 'visible' });
  const rect = await locator.boundingBox();
  const x = position?.x ?? Math.min(80, rect.width / 2);
  const y = position?.y ?? rect.height / 2;
  await scope.mouse.move(rect.x + x, rect.y + y, { steps: 11 });
  await wait(190);
  await locator.click({ delay: 100, position: { x, y } });
}

async function showSettings() {
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  return settingsPage(page);
}

async function story(id, action) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(id)) return;
  try {
    await page.evaluate(() => app.setting.close());
    await page.keyboard.press('Escape');
    await page.mouse.move(12, 840);
    await action();
    await finish(id);
  } catch (error) {
    failures.push(id);
    errors.push(error);
    console.error('Failed recording', id, error.message);
    const alerts = await page.locator('.notice, .ot-save-error').allTextContents();
    console.log(
      'Visible notice summaries:',
      alerts.map((alert) => alert.split(':')[0]),
    );
    await page.screenshot({ path: 'artifacts/screencast/' + id + '-failure.png' });
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').captureModal?.close());
    await page.mouse.up();
    await page.keyboard.press('Escape');
  }
}

try {
  createdThemes = await mkdir(themes, { recursive: true });
  await mkdir(theme);
  createdTheme = true;
  await cp(themeSource, theme, { recursive: true });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.evaluate(async (mode) => {
    await app.customCss.readThemes(false);
    await app.customCss.setTheme('Things');
    app.changeTheme(mode);
  }, colorMode);
  await page.evaluate(async () => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    await app.plugins.getPlugin('thingsmd').updateSettings({
      enableWaiting: true,
      logbook: 'manually',
      captureDestination: 'inbox',
      showProjectProgress: true,
    });
  });
  await page.waitForFunction(
    (themeClass) =>
      app.customCss.theme === 'Things' && document.body.classList.contains(themeClass),
    themeClass,
  );

  await story('create', async () => {
    await openNote(
      notes.release,
      '## Release planning\n\nUse this note for our launch decisions.\n\n',
    );
    await page.evaluate(() => {
      const editor = app.workspace.activeLeaf.view.editor;
      editor.focus();
      editor.setCursor({ line: 4, ch: 0 });
    });
    const area = await region(
      page,
      active.locator('.cm-line').filter({ hasText: 'Release planning' }).first(),
      { height: 280, top: 4 },
    );
    await record('create', page, area, async (hint) => {
      await hint('Type + on a blank line');
      await page.keyboard.type('+');
      await wait(950);
      await hint('Press Space');
      await page.keyboard.press('Space');
      const field = active.locator('.ot-title-input:visible');
      await field.waitFor();
      await wait(350);
      await hint('Name the task and press Enter');
      await field.pressSequentially('Send the launch brief', { delay: 67 });
      await wait(300);
      await field.press('Enter');
      await row('Send the launch brief').waitFor();
      await hint('The task card stays in the note');
    });
  });

  await story('dates', async () => {
    const task = await make('Polish the launch checklist');
    await page.setViewportSize({ width: 850, height: 720 });
    try {
      await openNote(
        notes.dates,
        '## Release checklist\n\n![[' + task.file.path.slice(0, -3) + ']]\n',
      );
      const line = byId(task.meta.id);
      const picker = active.locator('.ot-date-picker:visible');
      for (const [name, label, type, value] of [
        ['When', 'Start date · Tomorrow', 'When date', 'tomorrow'],
        ['Deadline', 'Deadline · In 4 days', 'Deadline date', 'in 4 days'],
      ]) {
        if (!(await line.locator('.ot-title-input').isVisible())) await line.dblclick();
        const toggle = line.getByRole('button', { name, exact: true });
        await toggle.waitFor();
        const area = await region(page, line, { width: 760, height: 424, top: 67, left: 20 });
        await record(
          'dates',
          page,
          area,
          async (hint) => {
            await hint(name === 'When' ? 'Open When' : 'Open Deadline');
            await click(page, toggle);
            const input = picker.getByLabel(type);
            await input.waitFor();
            await wait(475);
            await hint(label);
            await input.pressSequentially(value, { delay: 75 });
            await wait(750);
            await input.press('Enter');
            await picker.waitFor({ state: 'hidden' });
            if (await line.locator('.ot-title-input').isVisible())
              await line.locator('.ot-title-input').press('Enter');
            await taskState(
              task.meta.id,
              name === 'When' ? 'when' : 'deadline',
              dayAfter(name === 'When' ? 1 : 4),
            );
            await hint(
              name === 'When' ? 'The start date is saved' : 'The deadline is saved separately',
            );
          },
          { tail: name === 'When' ? 750 : 1350 },
        );
      }
    } finally {
      await page.setViewportSize({ width: 1100, height: 850 });
    }
  });

  await story('drag', async () => {
    const tasks = await Promise.all(
      ['Draft the announcement', 'Check screenshots', 'Review the final copy'].map((text) =>
        make(text),
      ),
    );
    await openNote(
      notes.drag,
      '## Editorial checklist\n\n' +
        tasks.map((task) => '![[' + task.file.path.slice(0, -3) + ']]').join('\n') +
        '\n',
    );
    const first = byId(tasks[0].meta.id);
    const last = byId(tasks[2].meta.id);
    await first.waitFor();
    const area = await region(page, first, { width: 560, height: 250, top: 55 });
    await record('drag', page, area, async (hint) => {
      const a = await last.boundingBox();
      const b = await first.boundingBox();
      await hint('Grab the third task');
      await page.mouse.move(a.x + 90, a.y + a.height / 2, { steps: 10 });
      await wait(500);
      await page.mouse.down();
      await page.mouse.move(a.x + 110, a.y + a.height / 2 + 8, { steps: 3 });
      await page.mouse.move(b.x + 100, b.y + 3, { steps: 19 });
      await page.locator('.ot-task-drop-marker:visible').waitFor();
      await hint('Drop above the first one');
      await wait(700);
      await page.mouse.up();
      await page.locator('.ot-task-drop-marker').waitFor({ state: 'detached' });
      await waitForAsync(
        page,
        (paths) => {
          const note = app.workspace.activeLeaf.view.editor.getValue();
          return note.indexOf(paths[1]) < note.indexOf(paths[0]);
        },
        [tasks[0].file.path.slice(0, -3), tasks[2].file.path.slice(0, -3)],
      );
    });
  });

  await story('sidebar', async () => {
    await openNote(notes.release, '## Studio Launch\n\nRoles, decisions, and launch materials.');
    await page.evaluate(async () => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const [name, status] of [
        ['Agree the launch date', 'done'],
        ['Review the launch brief', 'todo'],
      ]) {
        const task = await p.createTask({ title: name, status, project: 'Studio Launch.md' });
        await app.vault.append(
          app.vault.getAbstractFileByPath('Studio Launch.md'),
          '\n![[' + task.file.path.slice(0, -3) + ']]\n',
        );
      }
      await app.vault.create('Ideas.md', 'A regular Obsidian note.');
      app.workspace.leftSplit.expand();
      app.workspace.leftSplit.setSize(221);
    });
    await openList('today');
    const side = page.locator('.workspace-split.mod-left-split');
    const today = side.locator('.ot-list-link[data-list="today"]');
    const upcoming = side.locator('.ot-list-link[data-list="upcoming"]');
    const project = side.locator('.nav-file-title[data-path="Studio Launch.md"]');
    await project.locator('.ot-project-progress').waitFor();
    const area = { x: 43, y: 40, width: 700, height: 400 };
    await record('sidebar', page, area, async (hint) => {
      await click(page, today);
      await hint('Jump to Upcoming');
      await wait(350);
      await click(page, upcoming);
      await active.getByRole('heading', { name: 'Upcoming', exact: true }).waitFor();
      await wait(1050);
      await hint('Open a project note');
      await click(page, project);
      await page.waitForFunction(
        () => app.workspace.activeLeaf.view.file?.basename === 'Studio Launch',
      );
    });
    await page.evaluate(() => app.workspace.leftSplit.collapse());
  });

  await story('finish', async () => {
    const one = await make('Check the release notes', { when: 'today', order: -300 });
    const two = await make('Skip the printed handout', { when: 'today', order: -299 });
    const future = await make('Publish the changelog', { when: dayAfter(1), order: -300 });
    await openList('today');
    const first = byId(one.meta.id);
    const second = byId(two.meta.id);
    await first.waitFor();
    const area = await region(page, first, { width: 600, height: 315, top: 70 });
    await record(
      'finish',
      page,
      area,
      async (hint) => {
        await hint('Check off finished work');
        await first.getByRole('checkbox').waitFor();
        await click(page, first.getByRole('checkbox'));
        await taskState(one.meta.id, 'status', 'done');
        await wait(700);
        const position = { x: 130, y: 13 };
        const box = await second.boundingBox();
        await page.mouse.move(box.x + position.x, box.y + position.y, { steps: 9 });
        await second.click({ button: 'right', position });
        const cancel = page.locator('.menu:visible').getByText('Mark as Canceled', { exact: true });
        await cancel.waitFor();
        await hint('Cancel a task you’re dropping');
        await wait(700);
        await click(page, cancel);
        await taskState(two.meta.id, 'status', 'canceled');
      },
      { tail: 850 },
    );
  });

  await story('global-capture', async () => {
    const accelerator = 'Control+Super+Shift+Space';
    await page.evaluate(
      (key) => app.plugins.getPlugin('thingsmd').setGlobalCaptureHotkey(key),
      accelerator,
    );
    assert(
      await page.evaluate(
        (key) => require('@electron/remote').globalShortcut.isRegistered(key),
        accelerator,
      ),
    );
    const settings = await showSettings();
    const shortcut = settings
      .getByRole('button', { name: 'Customize global capture shortcut', exact: true })
      .locator(
        'xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," setting-item ")][1]',
      );
    await shortcut.scrollIntoViewIfNeeded();
    const keyArea = await region(settings, shortcut, {
      width: 635,
      height: 225,
      top: 26,
      left: 12,
    });
    await record(
      'global-capture',
      settings,
      keyArea,
      async (hint) => {
        await hint('Set a global shortcut in ThingsMD settings');
        await wait(750);
      },
      { lead: 160, tail: 200 },
    );
    await page.evaluate(() => app.setting.close());
    await openList('inbox');
  });

  await story('calendar', async () => {
    const today = dayAfter(0).replaceAll('-', '');
    server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/calendar' });
      response.end(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//ThingsMD//Docs//EN',
          'X-WR-CALNAME:Studio calendar',
          'BEGIN:VEVENT',
          'UID:demo@example.invalid',
          'DTSTAMP:' + today + 'T070000Z',
          'DTSTART:' + today + 'T100000',
          'DTEND:' + today + 'T110000',
          'SUMMARY:Studio design review',
          'END:VEVENT',
          'END:VCALENDAR',
          '',
        ].join('\r\n'),
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const settings = await showSettings();
    const add = settings.getByRole('button', { name: 'Add calendar', exact: true });
    await add.scrollIntoViewIfNeeded();
    const control = await region(settings, add, { width: 630, height: 205, left: 515, top: 90 });
    await record(
      'calendar',
      settings,
      control,
      async (hint) => {
        await hint('ThingsMD settings · Add calendar');
        await click(settings, add);
      },
      { tail: 180 },
    );
    const dialog = settings.locator('.ot-calendar-create:visible');
    await dialog.waitFor();
    const popup = await region(settings, dialog, { width: 640, height: 315, left: 30, top: 24 });
    await record(
      'calendar',
      settings,
      popup,
      async (hint) => {
        const field = dialog.getByLabel('Subscription URL', { exact: true });
        await hint('Paste a subscription URL');
        await click(settings, field);
        await field.fill('http://127.0.0.1:' + server.address().port + '/studio.ics');
        await wait(950);
        await hint('Add the calendar');
        await click(settings, dialog.getByRole('button', { name: 'Add calendar', exact: true }));
        await dialog.waitFor({ state: 'hidden' });
      },
      { tail: 220 },
    );
    addedCalendar = await page.evaluate(() =>
      app.plugins
        .getPlugin('thingsmd')
        .settings.calendars.find((calendar) => calendar.name === 'Studio calendar'),
    );
    assert(addedCalendar);
    await page.evaluate(() => app.setting.close());
    await openList('today');
    const container = active.locator('.ot-calendar').filter({ hasText: 'Studio design review' });
    await container.waitFor();
    const result = await region(page, container, { width: 570, height: 230, top: 68 });
    await record(
      'calendar',
      page,
      result,
      async (hint) => {
        await hint('The appointment appears in Today');
        await page.mouse.move(result.x + result.width - 18, result.y + 40, { steps: 10 });
      },
      { lead: 120, tail: 1100 },
    );
  });

  await story('conversion', async () => {
    const text = '- [ ] Review the proposal 📅 ' + dayAfter(3);
    await openNote(
      notes.convert,
      '## Existing tasks\n\n' + text + '\n- [ ] Keep this as Markdown\n',
    );
    const first = active.locator('.cm-line').filter({ hasText: 'Review the proposal' }).first();
    await first.waitFor();
    const area = await region(page, first, { width: 690, height: 392, top: 77 });
    await record('conversion', page, area, async (hint) => {
      await hint('Select just the task to convert');
      await click(page, first, { x: 110, y: 10 });
      await page.evaluate(() => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setSelection({ line: 2, ch: 0 }, { line: 2, ch: editor.getLine(2).length });
        editor.focus();
      });
      await wait(850);
      await hint('Run Convert selected tasks…');
      assert(await command('convert-selected-tasks'));
      const menu = page
        .locator('.menu:visible')
        .getByText('Convert to ThingsMD format', { exact: true });
      await page.bringToFront();
      await page.evaluate(() => require('@electron/remote').getCurrentWindow().focus());
      await click(page, menu);
      if (await menu.isVisible()) {
        await menu.evaluate((el) => el.closest('.menu-item').click());
        if (await menu.isVisible()) await page.keyboard.press('Enter');
      }
      await row('Review the proposal').waitFor();
      await hint('The other checkbox stays as Markdown');
      await wait(900);
      const task = row('Review the proposal');
      const pos = { x: 90, y: 14 };
      const bounds = await task.boundingBox();
      await page.mouse.move(bounds.x + pos.x, bounds.y + pos.y, { steps: 9 });
      await task.evaluate((el, pos) => {
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: rect.x + pos.x,
            clientY: rect.y + pos.y,
          }),
        );
      }, pos);
      const reverse = page
        .locator('.menu:visible')
        .getByText('Convert to Tasks Emoji / Dataview format', { exact: true });
      await reverse.waitFor();
      await hint('Convert back to the original format');
      await wait(700);
      await click(page, reverse);
      if (await reverse.isVisible())
        await reverse.evaluate((el) => el.closest('.menu-item').click());
      await waitForAsync(page, async () => {
        const p = app.plugins.getPlugin('thingsmd');
        return (
          !(await p.taskRecords()).some((task) => task.meta.title === 'Review the proposal') &&
          app.workspace.activeLeaf.view.editor.getValue().includes('Review the proposal')
        );
      });
      await hint('Markdown and the original deadline are restored');
    });
  });
} finally {
  await page.evaluate(
    async ({ original, addedCalendar }) => {
      const p = app.plugins.getPlugin('thingsmd');
      app.setting.close();
      await p.captureModal?.close();
      await p.setGlobalCaptureHotkey(original.settings.globalCaptureHotkey || '');
      await p.updateSettings(original.settings);
      if (addedCalendar) {
        app.secretStorage.deleteSecret(addedCalendar.secretName);
        const cache = original.settings.tasksFolder + '/Calendars/' + addedCalendar.id;
        if (await app.vault.adapter.exists(cache)) await app.vault.adapter.rmdir(cache, true);
      }
      await app.workspace.activeLeaf.setViewState(original.state);
      app.workspace.leftSplit.setSize(original.leftWidth);
      for (const file of app.vault.getMarkdownFiles()) await app.vault.delete(file);
      document.getElementById('demo-cue')?.remove();
      document.getElementById('demo-pointer')?.remove();
      await app.customCss.setTheme(original.theme);
      app.changeTheme(original.mode);
    },
    { original, addedCalendar },
  );
  if (createdTheme) await rm(theme, { recursive: true });
  if (createdThemes) await rmdir(themes);
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await cleanFrameStyle.evaluate((style) => style.remove());
  await browser.close();
}
if (failures.length)
  throw new AggregateError(errors, 'Recording failed for ' + failures.join(', '));
