import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const note = `navigation-${Date.now()}.md`;
let paths = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const selected = () =>
  page.evaluate(() => document.activeElement?.closest('.ot-native')?.dataset.taskPath || null);
const cursor = () => page.evaluate(() => app.workspace.activeLeaf.view.editor.getCursor());
try {
  paths = await page.evaluate(async (note) => {
    const p = app.plugins.getPlugin('thingsmd');
    const tasks = [
      await p.createTask({ title: 'Navigation first' }),
      await p.createTask({ title: 'Navigation second' }),
    ];
    const file = await app.vault.create(
      note,
      `Before\n![[${tasks[0].file.path.slice(0, -3)}]]\n![[${tasks[1].file.path.slice(0, -3)}]]\nAfter\n`,
    );
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.openFile(file);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: note, mode: 'source', source: false },
    });
    return tasks.map((t) => t.file.path);
  }, note);
  for (const path of paths)
    await page
      .locator(`.workspace-leaf.mod-active .ot-native[data-task-path="${path}"] .ot-task`)
      .waitFor();
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: 0, ch: 2 });
    e.focus();
  });
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), paths[0], 'First Down selects the first task');
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), paths[1], 'Second Down selects the adjacent task');
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), null);
  assert.deepEqual(await cursor(), { line: 3, ch: 2 });
  await page.keyboard.press('ArrowUp');
  assert.equal(await selected(), paths[1]);
  await page.keyboard.press('ArrowUp');
  assert.equal(await selected(), paths[0]);
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await cursor(), { line: 0, ch: 2 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const title = page.locator('.workspace-leaf.mod-active .ot-title-input');
  await title.waitFor();
  await title.press('ArrowDown');
  assert.equal(await title.count(), 1, 'Arrow keys inside inputs do not select other tasks');
  await title.press('Enter');
  await title.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => app.workspace.getActiveFile()?.path),
    note,
    'Closing a task keeps the project note active',
  );
  // Blank lines remain ordinary cursor stops; a repeated reference is a separate stop.
  await page.evaluate((paths) => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setValue(`Before\n\n![[${paths[0].slice(0, -3)}]]\n![[${paths[0].slice(0, -3)}]]\nAfter`);
    e.setCursor({ line: 0, ch: 0 });
    e.focus();
  }, paths);
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), null);
  assert.equal((await cursor()).line, 1);
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), paths[0]);
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), paths[0]);
  await page.keyboard.press('ArrowDown');
  assert.equal((await cursor()).line, 4);
  // A wrapped paragraph still traverses its visual lines before selecting a task.
  await page.evaluate((paths) => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setValue(
      `${'Long paragraph with native cursor movement. '.repeat(35)}\n![[${paths[0].slice(0, -3)}]]\nAfter`,
    );
    e.setCursor({ line: 0, ch: 0 });
    e.focus();
  }, paths);
  await page.waitForFunction(() =>
    app.workspace.activeLeaf.view.editor.getLine(0).startsWith('Long paragraph'),
  );
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: 0, ch: 0 });
    e.focus();
  });
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), null, 'Stay in the wrapped paragraph');
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: 0, ch: e.getLine(0).length });
    e.focus();
  });
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(
    (path) => document.activeElement?.closest('.ot-native')?.dataset.taskPath === path,
    paths[0],
    { timeout: 2000 },
  );
  assert.equal(await selected(), paths[0], 'Last visual line enters the task');
  await page.keyboard.press('ArrowDown');
  assert.equal((await cursor()).line, 2);
  // Logged tasks remain embedded in Markdown but have no visible card. Native
  // CodeMirror movement can bounce at these zero-height replacement widgets.
  await page.evaluate(
    async ({ paths }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.patchTask(
        (await p.records()).find((task) => task.file.path === paths[0]),
        { status: 'done', completed: '2020-01-01' },
      );
      const e = app.workspace.activeLeaf.view.editor;
      e.setValue(`Before\n![[${paths[0]}]]\n![[${paths[0]}]]\n\n![[${paths[1]}]]\nAfter`);
      e.setCursor({ line: 0, ch: 2 });
      e.focus();
    },
    { paths },
  );
  await page
    .locator('.workspace-leaf.mod-active .ot-hidden-task')
    .first()
    .waitFor({ state: 'attached' });
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(
    await cursor(),
    { line: 3, ch: 0 },
    'Skip logged tasks, stopping at the blank line',
  );
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), paths[1], 'Reach the visible task after logged tasks');
  await page.keyboard.press('ArrowUp');
  assert.equal((await cursor()).line, 3);
  await page.keyboard.press('ArrowUp');
  assert.equal((await cursor()).line, 0, 'Skip logged tasks in reverse as well');
  for (const deleted of [false, true]) {
    if (deleted) {
      await page.evaluate(async (path) => {
        const p = app.plugins.getPlugin('thingsmd');
        await p.patchTask(
          (await p.records()).find((task) => task.file.path === path),
          {
            deleted: true,
          },
        );
      }, paths[0]);
    }
    const text = `![[${paths[0]}]]\nBefore\n![[${paths[0]}]]\n![[${paths[1]}]]\n![[${paths[0]}]]\nAfter\n![[${paths[0]}]]`;
    await page.evaluate((text) => {
      const e = app.workspace.activeLeaf.view.editor;
      e.setValue(text);
      e.setCursor({ line: 1, ch: 2 });
      e.focus();
    }, text);
    await page.keyboard.press('ArrowUp');
    assert.deepEqual(
      await cursor(),
      { line: 1, ch: 2 },
      'Hidden leading tasks are not cursor stops',
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(await selected(), paths[1], 'Reach a visible task directly across hidden tasks');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual(await cursor(), { line: 5, ch: 2 }, 'Exit a visible task across hidden tasks');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual(
      await cursor(),
      { line: 5, ch: 2 },
      'Hidden trailing tasks are not cursor stops',
    );
    await page.keyboard.press('ArrowUp');
    assert.equal(await selected(), paths[1]);
    await page.keyboard.press('ArrowUp');
    assert.deepEqual(await cursor(), { line: 1, ch: 2 });
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      text,
      'Keyboard navigation preserves every task reference and surrounding text',
    );
  }
  // Source Mode retains plain text navigation.
  await page.evaluate((paths) => {
    app.workspace.activeLeaf.view.editor.setValue(`Before\n\n![[${paths[0].slice(0, -3)}]]\nAfter`);
  }, paths);
  await page.evaluate(async () => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    const state = leaf.getViewState();
    state.state.source = true;
    await leaf.setViewState(state);
  });
  await page.waitForFunction(
    () => !document.querySelector('.workspace-leaf.mod-active .ot-native'),
  );
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: 1, ch: 0 });
    e.focus();
  });
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), null);
  assert.equal((await cursor()).line, 2);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: task selection, repeated and hidden tasks, document boundaries, reverse navigation, blank lines, title editing and Source Mode.',
  );
} finally {
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
