import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Inbox drag ${Date.now()}`;
let paths = [],
  notes = [],
  collapsed;
try {
  collapsed = await page.evaluate(() => app.workspace.leftSplit.collapsed);
  for (const mode of ['source', 'preview']) {
    const note = prefix + ' ' + mode + '.md';
    notes.push(note);
    const task = await page.evaluate(
      async ({ note, mode }) => {
        const p = app.plugins.getPlugin('thingsmd');
        for (const leaf of app.workspace.getLeavesOfType('things-project-view')) leaf.detach();
        const t = await p.createTask({
          title: mode === 'preview' ? '' : 'New task drag ' + mode,
          project: note,
          when: 'today',
        });
        const text = `Before\n\n![[${t.file.path.slice(0, -3)}]]\n\nAfter\n`,
          f = app.vault.getAbstractFileByPath(note);
        if (f) await app.vault.modify(f, text);
        else await app.vault.create(note, text);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const leaf = app.workspace.getLeaf('tab');
        await leaf.openFile(app.vault.getAbstractFileByPath(note));
        await leaf.setViewState({
          type: 'markdown',
          state: { file: note, mode, source: false },
          active: true,
        });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.workspace.leftSplit.expand();
        return t;
      },
      { note, mode },
    );
    paths.push(task.file.path);
    const row = page.locator(
      `.workspace-leaf.mod-active .ot-task[data-task-id="${task.meta.id}"]:visible`,
    );
    await row.waitFor();
    const expectedTitle = task.meta.title || 'New task';
    assert.equal(await row.locator('.ot-task-title').innerText(), expectedTitle);
    const target = page.locator('.ot-list-link[data-list="inbox"]:visible');
    const a = await row.boundingBox(),
      b = await target.boundingBox();
    await page.mouse.move(a.x + 80, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 90, a.y + a.height / 2 + 9, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await target.locator('xpath=self::*[contains(@class,"ot-note-drop-target")]').waitFor();
    await page.mouse.up();
    await waitForAsync(
      page,
      async (path) => {
        const p = app.plugins.getPlugin('thingsmd'),
          t = (await p.taskRecords()).find((t) => t.file.path === path);
        return t.meta.project === null && t.meta.when === null;
      },
      task.file.path,
    );
    await row.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(async (note) => {
        const v = app.workspace.activeLeaf.view;
        if (v.getMode() === 'source') await v.save();
        return app.vault.read(app.vault.getAbstractFileByPath(note));
      }, note),
      'Before\n\n\nAfter\n',
    );
    await target.click();
    const moved = page.locator(
      `.workspace-leaf.mod-active .ot-task[data-task-id="${task.meta.id}"]:visible`,
    );
    await moved.waitFor();
    assert.equal(await moved.locator('.ot-task-title').innerText(), expectedTitle);
  }
  console.log(
    'PASS: real pointer drag from Live Preview and Reading view to Inbox with no task-list view open; source reference removed, prose preserved, task visible in Inbox.',
  );
} finally {
  await page.mouse.up();
  await page.evaluate(
    async ({ notes, paths, collapsed }) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (notes.includes(leaf.view.file?.path)) leaf.detach();
      for (const note of notes) {
        const f = app.vault.getAbstractFileByPath(note);
        if (f) await app.vault.delete(f);
      }
      for (const path of paths) await p.deleteTask(path);
      await p.open();
      if (collapsed) app.workspace.leftSplit.collapse();
    },
    { notes, paths, collapsed },
  );
  await browser.close();
}
