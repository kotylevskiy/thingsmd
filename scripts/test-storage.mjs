import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const note = `Ordinary note ${Date.now()}.md`,
  renamed = note.replace('Ordinary', 'Renamed');
let task;
try {
  task = await page.evaluate(async (note) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const task = await plugin.createTask({ title: 'Hidden storage verification', project: note });
    await app.vault.create(note, `Normal notes, no frontmatter.\n\n![[${task.file.path}]]\n`);
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: 'markdown',
      state: { file: note, mode: 'source', source: false },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return task.file.path;
  }, note);
  assert.ok(task.startsWith('.thingsmd-storage/'));
  await page
    .locator('.workspace-leaf.mod-active .ot-task-title')
    .getByText('Hidden storage verification', { exact: true })
    .waitFor();
  const indexed = await page.evaluate(
    (task) => app.vault.getMarkdownFiles().some((f) => f.path === task),
    task,
  );
  assert.equal(indexed, false, 'Hidden task is not an ordinary indexed vault note');
  await page.evaluate(async (task) => {
    const text = await app.vault.adapter.read(task);
    await app.vault.adapter.write(
      task,
      text.replace('Hidden storage verification', 'Changed externally'),
    );
  }, task);
  await page
    .locator('.workspace-leaf.mod-active .ot-task-title')
    .getByText('Changed externally', { exact: true })
    .waitFor();
  await page.evaluate(
    async ({ note, renamed }) =>
      app.fileManager.renameFile(app.vault.getAbstractFileByPath(note), renamed),
    { note, renamed },
  );
  await waitForAsync(
    page,
    async ({ task, renamed }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.file.path === task)
        ?.meta.project === renamed,
    { task, renamed },
  );
  const before = await page.evaluate((task) => app.vault.adapter.read(task), task);
  await page.evaluate(async () => {
    const id = 'thingsmd';
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
  });
  assert.equal(
    await page.evaluate((task) => app.vault.adapter.read(task), task),
    before,
    'Reload preserves hidden task data',
  );
  const refs = await page.evaluate(
    async (task) =>
      (await app.plugins.getPlugin('thingsmd').records()).find((t) => t.file.path === task)
        .references,
    task,
  );
  assert.deepEqual(refs, [renamed]);
  const deletionRace = await page.evaluate(async (path) => {
    const p = app.plugins.getPlugin('thingsmd'),
      adapter = app.vault.adapter,
      read = adapter.read;
    let removed = false;
    // Remove the actual fixture file after the directory scan has found it.
    adapter.read = async function (filePath, ...args) {
      if (filePath === path && !removed) {
        removed = true;
        await adapter.remove(path);
      }
      return read.call(this, filePath, ...args);
    };
    try {
      const tasks = await p.taskRecords();
      return { removed, indexed: tasks.some((t) => t.file.path === path) };
    } finally {
      adapter.read = read;
    }
  }, task);
  assert.deepEqual(deletionRace, { removed: true, indexed: false });
  console.log(
    'PASS: ordinary note without project metadata, hidden Markdown task, external update polling, note rename, reference indexing, reload, and deletion during an actual file scan.',
  );
} finally {
  await page.evaluate(
    async ({ note, renamed, task }) => {
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if ([note, renamed].includes(leaf.view.file?.path)) leaf.detach();
      for (const path of [note, renamed]) {
        const f = app.vault.getAbstractFileByPath(path);
        if (f) await app.vault.delete(f);
      }
      if (task && (await app.vault.adapter.exists(task)))
        await app.plugins.getPlugin('thingsmd').deleteTask(task);
    },
    { note, renamed, task },
  );
  await browser.close();
}
