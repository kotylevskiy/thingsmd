import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
const prefix = `Cancellation ${Date.now()}`;
let fixture;
const activeRow = (id) =>
  page.locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]:visible`);
const status = (id, expected) =>
  waitForAsync(
    page,
    async ({ id, expected }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .status === expected,
    { id, expected },
  );
try {
  fixture = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const settings = { ...p.settings };
    await p.updateSettings({ logbook: 'manually', trashRetention: 'never', enableWaiting: true });
    const task = await p.createTask({
      title: prefix,
      when: 'today',
      is_waiting: true,
      repeatSource: 'missing-template',
    });
    const note = `${prefix}.md`;
    await app.vault.create(note, `Before\n![[${task.file.path}]]\nAfter\n`);
    return {
      task,
      note,
      settings,
      viewport: { width: innerWidth, height: innerHeight },
      mobile: !!localStorage.getItem('EmulateMobile'),
    };
  }, prefix);
  const id = fixture.task.meta.id;
  for (const mobile of [false, true]) {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1100, height: 850 });
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== mobile)
      await page.evaluate((mobile) => app.emulateMobile(mobile), mobile);
    await page.waitForFunction(
      () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd'),
    );
    for (const mode of ['list', 'source', 'preview']) {
      await page.evaluate(
        async ({ mode, note, id }) => {
          const p = app.plugins.getPlugin('thingsmd');
          const task = (await p.taskRecords()).find((t) => t.meta.id === id);
          await p.patchTask(task, { status: 'todo' });
          app.workspace.leftSplit.collapse();
          if (mode === 'list') await p.openList('today');
          else
            await p.mainWorkspaceLeaf().setViewState({
              type: 'markdown',
              state: { file: note, mode, source: false },
              active: true,
            });
        },
        { mode, note: fixture.note, id },
      );
      const row = activeRow(id);
      await row.waitFor();
      const markers = await row.evaluate((el) => {
        const repeat = el.querySelector('.ot-repeat-indicator');
        const waiting = el.querySelector('.ot-waiting-marker');
        return {
          next: repeat.nextElementSibling === waiting,
          delta: Math.abs(
            repeat.getBoundingClientRect().top +
              repeat.getBoundingClientRect().height / 2 -
              waiting.getBoundingClientRect().top -
              waiting.getBoundingClientRect().height / 2,
          ),
        };
      });
      assert.equal(markers.next, true);
      assert.ok(markers.delta < 5, JSON.stringify(markers));
      await row.click({ button: 'right' });
      const menu = page.locator('.menu:visible').last();
      await menu.getByText('Show in Project', { exact: true }).waitFor();
      const labels = await menu.locator('.menu-item-title').allTextContents();
      assert.equal(labels[labels.indexOf('Stop Waiting') + 1], 'Show in Project');
      if (mode === 'list') {
        await menu.getByText('Show in Project', { exact: true }).click();
        await page.waitForFunction(
          (note) => app.workspace.activeLeaf?.view.file?.path === note,
          fixture.note,
        );
        await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
        await row.waitFor();
        await row.click({ button: 'right' });
      }
      await menu.getByText('Mark as Canceled', { exact: true }).click();
      await status(id, 'canceled');
      await waitForAsync(
        page,
        (id) => {
          const row = document.querySelector(
            `.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`,
          );
          return row?.classList.contains('is-canceled');
        },
        id,
      );
      assert.match(
        await row
          .locator('.ot-task-title')
          .evaluate((el) => getComputedStyle(el).textDecorationLine),
        /line-through/,
      );
      const glyph = await row.locator('.ot-task-line > input[type=checkbox]').evaluate((el) => {
        const mark = getComputedStyle(el, '::after');
        return { width: parseFloat(mark.width), box: el.getBoundingClientRect().width };
      });
      assert.ok(glyph.width / glyph.box <= 0.65, 'Canceled X remains inset inside checkbox');
      await row.click({ button: 'right' });
      await page
        .locator('.menu:visible')
        .last()
        .getByText('Mark as Incomplete', { exact: true })
        .click();
      await status(id, 'todo');
      await waitForAsync(
        page,
        (id) =>
          !document
            .querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`)
            ?.classList.contains('is-done'),
        id,
      );
      await row.locator('.ot-task-line > input[type=checkbox]').click();
      await status(id, 'done');
      await waitForAsync(
        page,
        (id) =>
          document
            .querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`)
            ?.classList.contains('is-done'),
        id,
      );
      assert.equal(
        await row
          .locator('.ot-task-title')
          .evaluate((el) => getComputedStyle(el).textDecorationLine),
        'none',
      );
      if (!mobile && mode === 'list') {
        await row.locator('.ot-task-line > input[type=checkbox]').click({ modifiers: ['Alt'] });
        await status(id, 'canceled');
        await waitForAsync(
          page,
          (id) =>
            document
              .querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`)
              ?.classList.contains('is-canceled'),
          id,
        );
        await row.screenshot({ path: 'artifacts/canceled-checkbox-050.png' });
        await row.locator('.ot-task-line > input[type=checkbox]').click();
        await status(id, 'todo');
        await waitForAsync(
          page,
          (id) =>
            !document
              .querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`)
              ?.classList.contains('is-done'),
          id,
        );
        // Project navigation above can finish after its file becomes active.
        // Explicitly return to the list before testing its keyboard context.
        await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
        await page.waitForFunction(
          () => app.workspace.activeLeaf?.view.getViewType() === 'thingsmd-project-view',
        );
        await row.press(process.platform === 'darwin' ? 'Alt+Meta+k' : 'Alt+Control+k');
        await status(id, 'canceled');
      }
      console.log('PASS cancellation and indicators', { mobile, mode });
    }
    await page.evaluate(async (id) => {
      const p = app.plugins.getPlugin('thingsmd');
      const task = (await p.taskRecords()).find((t) => t.meta.id === id);
      await p.patchTask(task, { status: 'todo' });
      await p.openTaskNotes(task);
    }, id);
    const headingIcon = page
      .locator('.workspace-leaf.mod-active .ot-task-note-heading-icon:visible')
      .first();
    await headingIcon.waitFor();
    if (mobile) {
      const box = await headingIcon.boundingBox();
      await headingIcon.dispatchEvent('pointerdown', {
        pointerType: 'touch',
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      });
      await page.locator('.menu:visible').getByText('Mark as Canceled', { exact: true }).waitFor();
      await headingIcon.dispatchEvent('pointerup', { pointerType: 'touch' });
      await page.locator('.menu:visible').getByText('Mark as Canceled', { exact: true }).click();
    } else await headingIcon.click({ modifiers: ['Alt'] });
    await status(id, 'canceled');
    await page
      .locator('.workspace-leaf.mod-active .ot-task-note-heading.is-canceled:visible')
      .first()
      .waitFor();
    assert.equal(
      await page
        .locator('.workspace-leaf.mod-active .ot-task-note-title:visible')
        .first()
        .evaluate((el) => getComputedStyle(el).textDecorationLine),
      'line-through',
    );
    console.log('PASS native task-note cancellation', { mobile });
  }
  // Exercise the actual CodeMirror key path, not a synthetic card key event.
  await page.evaluate(() => app.emulateMobile(false));
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd'),
  );
  for (const key of ['Backspace', 'Delete']) {
    await page.evaluate(
      async ({ note, id, key }) => {
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.id === id);
        await p.patchTask(task, { status: 'todo', deleted: null, deletedAt: null });
        await p.mainWorkspaceLeaf().setViewState({
          type: 'markdown',
          state: { file: note, mode: 'source', source: false },
          active: true,
        });
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setCursor({ line: 1, ch: key === 'Delete' ? 0 : editor.getLine(1).length });
        editor.focus();
      },
      { note: fixture.note, id, key },
    );
    await activeRow(id).waitFor();
    await page.evaluate(() => {
      const p = app.plugins.getPlugin('thingsmd');
      window.originalTrash050 = p.trashTask;
      window.trashCalls050 = 0;
      p.trashTask = () => {
        window.trashCalls050++;
        return new Promise((resolve, reject) => {
          window.rejectTrash050 = reject;
        });
      };
    });
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    assert.equal(
      await page.evaluate(() => window.trashCalls050),
      1,
      'Repeated deletion coalesces pending work',
    );
    await page.evaluate(() => window.rejectTrash050(new Error('Simulated Trash write failure')));
    await page.getByText('Simulated Trash write failure', { exact: true }).last().waitFor();
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      `Before\n![[${fixture.task.file.path}]]\nAfter\n`,
    );
    await page.evaluate(() => {
      const p = app.plugins.getPlugin('thingsmd');
      p.trashTask = window.originalTrash050;
      delete window.originalTrash050;
      delete window.rejectTrash050;
      delete window.trashCalls050;
    });
    await page.keyboard.press(key);
    await waitForAsync(
      page,
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
          .deleted,
      id,
    );
    const text = await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue());
    assert.equal(text, `Before\n![[${fixture.task.file.path}]]\nAfter\n`);
    console.log('PASS adjacent-caret Trash preserves entire Markdown', key);
  }
} finally {
  if (fixture) {
    await page.waitForFunction(
      () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd'),
    );
    await page.evaluate(async ({ task, note, settings }) => {
      const p = app.plugins.getPlugin('thingsmd');
      if (window.originalTrash050) p.trashTask = window.originalTrash050;
      delete window.originalTrash050;
      delete window.rejectTrash050;
      delete window.trashCalls050;
      await p.updateSettings(settings);
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if ([note, task.file.path].includes(leaf.view.file?.path)) leaf.detach();
      for (const path of [note, task.file.path]) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file);
      }
    }, fixture);
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== fixture.mobile) {
      await page.evaluate((mobile) => app.emulateMobile(mobile), fixture.mobile);
      await page.waitForFunction(
        () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd'),
      );
    }
    await page.setViewportSize(fixture.viewport);
  }
  await browser.close();
}
