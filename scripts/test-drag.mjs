import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const note = `drag-${Date.now()}.md`;
let paths = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const read = () => page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue());
const row = (title) =>
  page.locator('.workspace-leaf.mod-active .ot-task').filter({ hasText: title });
async function drag(source, target, after = false, cancel = false) {
  const a = await source.boundingBox(),
    b = await target.boundingBox();
  await page.mouse.move(a.x + 80, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 90, a.y + a.height / 2 + 8, { steps: 3 });
  await page.mouse.move(b.x + 100, b.y + (after ? b.height - 3 : 3), { steps: 12 });
  await page.locator('.ot-task-drop-marker:visible').waitFor();
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.locator('.ot-task-drop-marker').waitFor({ state: 'detached' });
  // Drop restores focus on the next frame; wait before issuing editor shortcuts.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
try {
  paths = await page.evaluate(async (note) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const tasks = [
      await plugin.createTask({ title: 'Drag first' }),
      await plugin.createTask({ title: 'Drag second' }),
    ];
    const f = await app.vault.create(
      note,
      `Introduction\n![[${tasks[0].file.path.slice(0, -3)}]]\nContext between tasks\n![[${tasks[1].file.path.slice(0, -3)}]]\nConclusion\n`,
    );
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.openFile(f);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: note, mode: 'source', source: false },
    });
    return tasks.map((t) => t.file.path);
  }, note);
  await row('Drag first').waitFor();
  await row('Drag second').waitFor();
  const original = await read();
  const taskContents = await page.evaluate(
    async (paths) => Promise.all(paths.map((p) => app.vault.adapter.read(p))),
    paths,
  );
  await drag(row('Drag second'), row('Drag first'));
  let moved = await read();
  assert.ok(moved.indexOf(paths[1].slice(0, -3)) < moved.indexOf(paths[0].slice(0, -3)));
  assert.ok(moved.includes('Context between tasks\nConclusion'));
  await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus());
  await page.keyboard.press('Meta+z');
  await page.waitForFunction(
    (text) => app.workspace.activeLeaf.view.editor.getValue() === text,
    original,
  );
  assert.equal(await read(), original, 'Undo restores exact text');
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForFunction(
    (text) => app.workspace.activeLeaf.view.editor.getValue() === text,
    moved,
  );
  assert.equal(await read(), moved, 'Redo restores movement');
  await drag(
    row('Drag second'),
    page.locator('.workspace-leaf.mod-active .cm-line').filter({ hasText: 'Conclusion' }),
    true,
  );
  assert.ok((await read()).indexOf('Conclusion') < (await read()).indexOf(paths[1].slice(0, -3)));
  const beforeCancel = await read();
  await drag(row('Drag second'), row('Drag first'), false, true);
  assert.equal(await read(), beforeCancel, 'Escape cancels');
  assert.deepEqual(
    await page.evaluate(
      async (paths) => Promise.all(paths.map((p) => app.vault.adapter.read(p))),
      paths,
    ),
    taskContents,
    'Task files unchanged',
  );
  await row('Drag first').dblclick();
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor();
  await page.keyboard.press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-title-input').waitFor({ state: 'hidden' });
  // Dropping outside the editor cancels; dragging near its edge scrolls long notes.
  const outsideBaseline = await read();
  const origin = await row('Drag first').boundingBox();
  await page.mouse.move(origin.x + 80, origin.y + origin.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, origin.y + 30, { steps: 10 });
  await page.mouse.up();
  assert.equal(await read(), outsideBaseline);
  await page.evaluate((paths) => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setValue(
      `![[${paths[0].slice(0, -3)}]]\n${'A paragraph of context.\n'.repeat(90)}![[${paths[1].slice(0, -3)}]]\n`,
    );
    e.setCursor({ line: 0, ch: 0 });
    e.focus();
  }, paths);
  await row('Drag first').scrollIntoViewIfNeeded();
  const first = await row('Drag first').boundingBox();
  const scroller = page.locator('.workspace-leaf.mod-active .cm-scroller');
  const bounds = await scroller.boundingBox();
  const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
  await page.mouse.move(first.x + 80, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 90, first.y + first.height / 2 + 10, { steps: 3 });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 10, { steps: 8 });
  await page.waitForFunction(
    (before) =>
      document.querySelector('.workspace-leaf.mod-active .cm-scroller').scrollTop > before + 30,
    scrollBefore,
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.locator('.ot-task-drag-ghost').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: whole-row drag, reorder across prose, drop after notes, undo/redo, Escape cancellation, preserved task files and working input after drag.',
  );
} finally {
  await page.mouse.up();
  await page.evaluate(
    async ({ note, paths }) => {
      await app.plugins.getPlugin('thingsmd').openList('inbox');
      for (const path of [note, ...paths]) {
        const f = app.vault.getAbstractFileByPath(path);
        if (f) await app.vault.delete(f);
        else if (path?.startsWith('ThingsMD/') && (await app.vault.adapter.exists(path)))
          await app.plugins.getPlugin('thingsmd').deleteTask(path);
      }
    },
    { note, paths },
  );
  await browser.close();
}
