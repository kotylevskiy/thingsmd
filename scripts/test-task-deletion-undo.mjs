import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault({ settings: { trashRetention: 'never' } });
page.setDefaultTimeout(10000);
let note = `Deletion undo ${Date.now()}.md`;
const gapNote = `Task card spacing ${Date.now()}.md`;
let task;
let original;
let gapTasks = [];
const active = page.locator('.workspace-leaf.mod-active');
const row = () => active.locator('.ot-native:not(.ot-hidden-task) .ot-task:visible');
async function deleted(value) {
  await waitForAsync(
    page,
    async ({ path, value }) => {
      const t = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.file.path === path,
      );
      return !!t?.meta.deleted === value;
    },
    { path: task.path, value },
  );
}
async function open(mode, path = note) {
  await page.evaluate(
    async ({ note, mode }) => {
      const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
      await leaf.setViewState({
        type: 'markdown',
        state: { file: note, mode, source: false },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    { note: path, mode },
  );
  await row().first().waitFor();
}
try {
  ({ task, original } = await page.evaluate(async (note) => {
    const p = app.plugins.getPlugin('thingsmd');
    const t = await p.createTask({ title: 'Recover this task', project: note, when: 'anytime' });
    const original = `Before.\n\n![[${t.file.path}]]\n\nAfter.\n`;
    await app.vault.create(note, original);
    return { task: { path: t.file.path }, original };
  }, note));
  for (const mode of ['source', 'preview']) {
    for (const key of ['Backspace', 'Delete']) {
      await open(mode);
      await row().focus();
      await row().press(key);
      await deleted(true);
      await row().waitFor({ state: 'hidden' });
      await page.keyboard.press('Meta+z');
      await deleted(false);
      await row().waitFor();
      await page.keyboard.press('Meta+Shift+z');
      await deleted(true);
      await row().waitFor({ state: 'hidden' });
      // Restore through the real Trash control, then return to the same note.
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('trash'));
      await active
        .locator('.ot-task')
        .filter({ hasText: 'Recover this task' })
        .getByRole('button', { name: 'Restore', exact: true })
        .click();
      await deleted(false);
      await open(mode);
      assert.equal(await page.evaluate((note) => app.vault.adapter.read(note), note), original);
      console.log(`PASS delete/undo/redo/Trash Restore: ${mode}, ${key}`);
    }
  }
  // A caret at the block boundary must use the same history as widget deletion.
  await open('source');
  await page.evaluate(() => {
    const editor = app.workspace.activeLeaf.view.editor;
    const line = editor
      .getValue()
      .split('\n')
      .findIndex((line) => line.startsWith('![['));
    editor.setCursor({ line: line + 1, ch: 0 });
    editor.focus();
  });
  await page.keyboard.press('Backspace');
  await deleted(true);
  await page.keyboard.press('Meta+z');
  await deleted(false);
  await row().waitFor();
  // Queue a rapid Undo while the soft deletion is still waiting for storage.
  await page.evaluate(() => {
    const p = app.plugins.getPlugin('thingsmd');
    const trash = p.trashTask;
    const pending = (window.deletionUndoTest = { trash });
    p.trashTask = async function (...args) {
      await new Promise((resolve) => {
        pending.release = resolve;
      });
      const result = await trash.apply(this, args);
      pending.finished = true;
      return result;
    };
  });
  await row().focus();
  await row().press('Delete');
  await page.waitForFunction(() => !!window.deletionUndoTest?.release);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Meta+z');
  await page.evaluate(() => {
    const p = app.plugins.getPlugin('thingsmd');
    p.trashTask = window.deletionUndoTest.trash;
    window.deletionUndoTest.release();
  });
  // Wait for the deletion to finish and its queued inverse to restore the card.
  await waitForAsync(
    page,
    async (path) => {
      const t = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.file.path === path,
      );
      return window.deletionUndoTest?.finished && !t?.meta.deleted;
    },
    task.path,
  );
  await page.evaluate(() => {
    delete window.deletionUndoTest;
  });
  await row().waitFor();
  // Recover a missing reference from persisted placement and preserve new prose.
  await row().focus();
  await row().press('Delete');
  await deleted(true);
  await page.evaluate(
    async ({ note, path }) => {
      const view = app.workspace.activeLeaf.view;
      const text = view.editor
        .getValue()
        .split('\n')
        .filter((line) => !line.includes(path))
        .join('\n');
      view.editor.setValue('New introduction.\n' + text);
      await view.save();
      const p = app.plugins.getPlugin('thingsmd');
      const t = (await p.taskRecords()).find((t) => t.file.path === path);
      await p.restoreTask(t);
    },
    { note, path: task.path },
  );
  await row().waitFor();
  assert.equal(
    await page.evaluate((note) => app.vault.adapter.read(note), note),
    'New introduction.\n' + original,
  );
  console.log('PASS caret undo and missing-reference recovery with surrounding edits');
  // A Trash snapshot must follow the source note through a rename as well.
  await row().focus();
  await row().press('Delete');
  await deleted(true);
  const renamed = note.replace(/\.md$/, ' renamed.md');
  await page.evaluate(
    async ({ note, renamed }) => {
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(note), renamed);
    },
    { note, renamed },
  );
  note = renamed;
  await waitForAsync(
    page,
    async ({ path, note }) => {
      const task = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.file.path === path,
      );
      return task?.meta.deletedFrom?.some((location) => location.path === note);
    },
    { path: task.path, note },
  );
  await page.evaluate(async (path) => {
    const view = app.workspace.activeLeaf.view;
    view.editor.setValue(
      view.editor
        .getValue()
        .split('\n')
        .filter((line) => !line.includes(path))
        .join('\n'),
    );
    await view.save();
    await app.plugins.getPlugin('thingsmd').openList('trash');
  }, task.path);
  await active
    .locator('.ot-task')
    .filter({ hasText: 'Recover this task' })
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  await deleted(false);
  await open('source');
  assert.equal(
    await page.evaluate((note) => app.vault.adapter.read(note), note),
    'New introduction.\n' + original,
  );
  console.log('PASS Trash Restore after renaming its source note');

  gapTasks = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    return [
      (await p.createTask({ title: 'Upper task card' })).file.path,
      (await p.createTask({ title: 'Lower task card' })).file.path,
    ];
  });
  const first = `Before spacing.\n\n![[${gapTasks[0]}]]`;
  const last = `![[${gapTasks[1]}]]\n\nAfter spacing.\n`;
  const spaced = first + '\n\n' + last;
  const compact = first + '\n' + last;
  const taskFiles = () =>
    page.evaluate(
      (paths) => Promise.all(paths.map((path) => app.vault.adapter.read(path))),
      gapTasks,
    );
  const before = await taskFiles();
  await page.evaluate(
    async ({ path, text }) => {
      await app.vault.create(path, text);
    },
    { path: gapNote, text: spaced },
  );
  await open('source', gapNote);
  await row().nth(1).waitFor();
  const expectBuffer = (text) =>
    page.waitForFunction((text) => app.workspace.activeLeaf.view.editor.getValue() === text, text);
  for (const key of ['Backspace', 'Delete']) {
    await page.evaluate(() => {
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setCursor({ line: 3, ch: 0 });
      editor.focus();
    });
    await page.keyboard.press(key);
    await expectBuffer(compact);
    await waitForAsync(
      page,
      async ({ path, text }) => (await app.vault.adapter.read(path)) === text,
      { path: gapNote, text: compact },
    );
    assert.equal(await row().count(), 2);
    assert.deepEqual(await taskFiles(), before);
    await page.keyboard.press('Meta+z');
    await expectBuffer(spaced);
    await page.keyboard.press('Meta+Shift+z');
    await expectBuffer(compact);
    await page.keyboard.press('Meta+z');
    await expectBuffer(spaced);
    assert.deepEqual(await taskFiles(), before);
    console.log(`PASS ${key} removes only the blank line between cards and supports Undo/Redo`);
  }
} finally {
  await page.evaluate(
    async ({ note, task, gapNote, gapTasks }) => {
      const p = app.plugins.getPlugin('thingsmd');
      if (window.deletionUndoTest) {
        p.trashTask = window.deletionUndoTest.trash;
        window.deletionUndoTest.release?.();
        delete window.deletionUndoTest;
      }
      await p.open();
      for (const path of [note, gapNote]) {
        for (const leaf of app.workspace.getLeavesOfType('markdown'))
          if (leaf.view.file?.path === path) leaf.detach();
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file);
      }
      if (task) await p.deleteTask(task.path);
      for (const path of gapTasks) await p.deleteTask(path);
    },
    { note, task, gapNote, gapTasks },
  );
  await browser.close();
}
