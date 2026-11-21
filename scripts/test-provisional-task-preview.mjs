import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const { browser, page } = await connectTestVault();
const title = 'Provisional preview ' + Date.now();
const note = title + '.md';
const active = page.locator('.workspace-leaf.mod-active');
try {
  await page.evaluate(async (note) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const create = plugin.createTask;
    const gate = Promise.withResolvers();
    const fixture = (window.provisionalPreview = {
      create,
      release: gate.resolve,
      notices: [],
    });
    fixture.observer = new MutationObserver(() => {
      for (const node of document.querySelectorAll('.notice'))
        if (fixture.path && node.textContent.includes(fixture.path))
          fixture.notices.push(node.textContent);
    });
    fixture.observer.observe(document.body, { childList: true, subtree: true });
    plugin.createTask = function (fields, id, ...rest) {
      if (fields.project !== note) return create.call(this, fields, id, ...rest);
      fixture.path = this.settings.tasksFolder + '/' + id + '.md';
      fixture.write = gate.promise.then(() => create.call(this, fields, id, ...rest));
      return fixture.write;
    };
    const file = await app.vault.create(note, 'Project context\n\n');
    const leaf = plugin.mainWorkspaceLeaf();
    await leaf.openFile(file);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: note, mode: 'source', source: false },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const editor = leaf.view.editor;
    editor.focus();
    editor.setCursor({ line: editor.lastLine(), ch: 0 });
  }, note);
  await page.keyboard.insertText('+');
  await page.waitForFunction(() => {
    const editor = app.workspace.activeLeaf.view.editor;
    return editor.getLine(editor.lastLine()) === '+';
  });
  await page.keyboard.insertText(' ');
  const field = active.getByRole('textbox', { name: 'Task title', exact: true });
  await field.waitFor();
  await page.waitForFunction(
    () =>
      window.provisionalPreview.notices.length ||
      document.querySelector('.workspace-leaf.mod-active .ot-task-notes-placeholder'),
  );
  const pending = await page.evaluate(async () => ({
    exists: await app.vault.adapter.exists(window.provisionalPreview.path),
    notices: window.provisionalPreview.notices,
  }));
  assert.deepEqual(pending, { exists: false, notices: [] });
  assert.equal(await active.locator('.ot-task-notes-placeholder').textContent(), 'Notes');
  await field.fill(title);
  await page.evaluate(() => window.provisionalPreview.release());
  await field.dispatchEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await waitForAsync(
    page,
    async (title) => {
      const tasks = await app.plugins.getPlugin('thingsmd').taskRecords();
      return tasks.some(
        (task) => task.file.path === window.provisionalPreview.path && task.meta.title === title,
      );
    },
    title,
  );
  assert.deepEqual(await page.evaluate(() => window.provisionalPreview.notices), []);
  console.log(
    'PASS: task preview opens before the file exists, emits no file error, and saves the typed title.',
  );
} finally {
  try {
    await page.evaluate(async (note) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const fixture = window.provisionalPreview;
      if (!fixture) return;
      plugin.createTask = fixture.create;
      fixture.observer.disconnect();
      fixture.release();
      await fixture.write?.catch(() => {});
      await plugin.openList('today');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      const file = app.vault.getFileByPath(note);
      if (file) await app.vault.delete(file, true);
      const task = (await plugin.taskRecords()).find((record) => record.file.path === fixture.path);
      if (task) await plugin.deleteTask(task.file);
      delete window.provisionalPreview;
    }, note);
  } finally {
    await browser.close();
  }
}
