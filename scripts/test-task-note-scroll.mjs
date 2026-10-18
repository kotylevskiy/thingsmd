import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const id = `note-scroll-${Date.now()}`;
let path, leafId;
const original = await page.evaluate(() => ({
  waiting: app.plugins.getPlugin('thingsmd').settings.enableWaiting,
  mobile: !!localStorage.getItem('EmulateMobile'),
}));
const mobile = async (value) => {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
};
try {
  if (process.argv.includes('--mobile') && !original.mobile) await mobile(true);
  await page.setViewportSize(
    process.argv.includes('--mobile') ? { width: 390, height: 844 } : { width: 1100, height: 700 },
  );
  ({ path, leafId } = await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.updateSettings({ enableWaiting: true });
    const t = await p.createTask(
      {
        title: 'Stable task controls',
        checklist: Array.from({ length: 25 }, (_, i) => ({ text: `Step ${i + 1}`, done: false })),
      },
      id,
      '## Description\n\n' +
        Array.from(
          { length: 40 },
          (_, i) => `Paragraph ${i + 1}: description text stays here.\n\n`,
        ).join(''),
    );
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: 'markdown',
      state: { file: t.file.path, mode: 'source', source: false },
      active: true,
    });
    await app.workspace.revealLeaf(leaf);
    return { path: t.file.path, leafId: leaf.id };
  }, id));
  for (const mode of ['source', 'raw', 'preview']) {
    await page.evaluate(
      async ({ path, mode }) => {
        await app.workspace.activeLeaf.setViewState({
          type: 'markdown',
          state: {
            file: path,
            mode: mode === 'preview' ? 'preview' : 'source',
            source: mode === 'raw',
          },
          active: true,
        });
        if (mode !== 'preview') {
          const editor = app.workspace.activeLeaf.view.editor;
          editor.setCursor(editor.offsetToPos(editor.getValue().indexOf('Paragraph 30')));
        }
      },
      { path, mode },
    );
    await page.waitForTimeout(300);
    if (mode === 'preview') {
      await page.locator('.workspace-leaf.mod-active .markdown-preview-view').evaluate((el) => {
        el.scrollTop = 0;
      });
    }
    const button = page
      .locator('.workspace-leaf.mod-active .ot-task-note-controls')
      .getByRole('button', { name: 'Waiting For', exact: true });
    await button.waitFor();
    await button.scrollIntoViewIfNeeded();
    await button.click({ trial: true });
    await page.waitForTimeout(150);
    for (const value of [true, false]) {
      await button.click({ trial: true });
      const before = await button.evaluate((el) => {
        const view = app.workspace.activeLeaf.view;
        const scroller = view.containerEl.querySelector(
          view.getMode() === 'source' ? '.cm-scroller' : '.markdown-preview-view',
        );
        window.taskScrollProbe = { button: el, scroller };
        return {
          top: el.getBoundingClientRect().top,
          scroll: scroller.scrollTop,
          cursor: view.getMode() === 'source' ? view.editor.getCursor() : null,
        };
      });
      assert.ok(before.scroll > 0, JSON.stringify({ mode, before }));
      await button.click();
      const clicked = await button.evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        scroll: window.taskScrollProbe.scroller.scrollTop,
      }));
      await waitForAsync(
        page,
        async ({ id, value }) => {
          const p = app.plugins.getPlugin('thingsmd');
          return (
            (await p.taskRecords()).find((t) => t.meta.id === id)?.meta.is_waiting === value &&
            ![...p.taskNoteControllers].find((c) => c.taskDraft?.task.meta.id === id)?.taskSave
          );
        },
        { id, value },
      );
      // Allow the metadata refresh and native scroll anchoring to settle.
      await page.waitForTimeout(300);
      const after = await button.evaluate((el) => ({
        same: el === window.taskScrollProbe.button,
        top: el.getBoundingClientRect().top,
        scroll: window.taskScrollProbe.scroller.scrollTop,
        cursor:
          app.workspace.activeLeaf.view.getMode() === 'source'
            ? app.workspace.activeLeaf.view.editor.getCursor()
            : null,
      }));
      console.log({ mode, before, clicked, after });
      assert.ok(
        Math.abs(after.top - before.top) < 2,
        'Waiting toggle must keep the controls in place',
      );
      assert.ok(
        Math.abs(after.scroll - before.scroll) < 2,
        'Waiting toggle must preserve scroll position',
      );
      assert.equal(after.same, true, 'Saving waiting status must not replace the controls');
      assert.deepEqual(
        after.cursor,
        before.cursor,
        'Metadata saves must preserve the description cursor',
      );
    }
    if (mode !== 'preview') {
      const oldScroll = await page.evaluate(() => window.taskScrollProbe.scroller.scrollTop);
      await page.evaluate(() => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.focus();
        editor.setCursor(editor.offsetToPos(editor.getValue().indexOf('Paragraph 35')));
      });
      await waitForAsync(
        page,
        (oldScroll) => window.taskScrollProbe.scroller.scrollTop > oldScroll + 100,
        oldScroll,
      );
    } else {
      const scroller = page.locator('.workspace-leaf.mod-active .markdown-preview-view');
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await scroller
        .getByText('Paragraph 40: description text stays here.', { exact: true })
        .waitFor();
      await scroller.evaluate((el) => {
        el.scrollTop = 0;
      });
      await button.waitFor();
      await button.scrollIntoViewIfNeeded();
      await button.click({ trial: true });
      assert.equal(
        await scroller.getByLabel('Checklist text 25', { exact: true }).inputValue(),
        'Step 25',
        'The full checklist survives scrolling away and back',
      );
    }
  }
  console.log(
    'PASS: waiting toggles preserve controls, scroll position and description cursor in Live Preview, Source and Reading view.',
  );
} finally {
  await page.evaluate(
    async ({ path, leafId, original }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.updateSettings({ enableWaiting: original.waiting });
      app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.id === leafId) leaf.detach();
      });
      const file = path && app.vault.getFileByPath(path);
      if (file) await app.vault.delete(file);
      delete window.taskScrollProbe;
    },
    { path, leafId, original },
  );
  if (process.argv.includes('--mobile') && !original.mobile) await mobile(false);
  await browser.close();
}
