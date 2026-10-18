import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Transfer ${Date.now()}`,
  a = prefix + ' A.md',
  b = prefix + ' B.md';
let ids = [];
const active = page.locator('.workspace-leaf.mod-active');
const record = async (id) =>
  page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
    id,
  );
const read = async (path) =>
  page.evaluate(async (path) => {
    const v = app.workspace
      .getLeavesOfType('markdown')
      .find((l) => l.view.file?.path === path && l.view.getMode() === 'source')?.view;
    return v ? v.editor.getValue() : app.vault.adapter.read(path);
  }, path);
const openNote = async (path) =>
  page.evaluate(async (path) => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.setViewState({
      type: 'markdown',
      state: { file: path, mode: 'source', source: false },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor.focus();
  }, path);
try {
  ids = await page.evaluate(
    async ({ prefix, a, b }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await app.vault.create(a, 'Before A\n\nAfter A\n');
      await app.vault.create(b, 'Before B\n\nAfter B\n');
      const tasks = [];
      for (const title of ['Drag', 'Cut'])
        tasks.push(
          (
            await p.createTask(
              { title: prefix + ' ' + title, checklist: [{ text: 'Step', done: false }] },
              undefined,
              'Task notes',
            )
          ).meta.id,
        );
      await p.openList('inbox');
      return tasks;
    },
    { prefix, a, b },
  );
  const listRow = (id) => active.locator(`.ot-task[data-task-id="${id}"]`);
  await listRow(ids[0]).dragTo(page.locator(`.nav-file-title[data-path="${a}"]`));
  await waitForAsync(
    page,
    async ({ id, a }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .project === a,
    { id: ids[0], a },
  );
  await active.locator(`.ot-inbox-moved .ot-task[data-task-id="${ids[0]}"]`).waitFor();
  assert.match(await read(a), new RegExp(ids[0]));
  assert.equal((await record(ids[0])).body, 'Task notes');
  await listRow(ids[1]).click();
  await listRow(ids[1]).press('Meta+x');
  await listRow(ids[1]).locator('..').waitFor();
  await page.waitForFunction(() =>
    require('electron').clipboard.readText().startsWith('![[ThingsMD/'),
  );
  assert.equal((await record(ids[1])).meta.project, undefined, 'Cut alone does not move or delete');
  await openNote(b);
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: 2, ch: 0 });
    e.focus();
  });
  await page.keyboard.press('Meta+v');
  await waitForAsync(
    page,
    async ({ id, b }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .project === b,
    { id: ids[1], b },
  );
  assert.match(
    await read(b),
    new RegExp(`Before B\\n\\n!\\[\\[ThingsMD/${ids[1]}\\]\\]\\nAfter B`),
  );
  const native = () =>
    active.locator(`.ot-native[data-task-path="ThingsMD/${ids[1]}.md"] .ot-task:visible`);
  await native().click();
  await native().press('Meta+c');
  await page.waitForTimeout(100);
  await openNote(a);
  await page.evaluate(() => {
    const e = app.workspace.activeLeaf.view.editor;
    e.setCursor({ line: 0, ch: 0 });
    e.focus();
  });
  await page.keyboard.press('Meta+v');
  await waitForAsync(
    page,
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
        (t) => t.meta.title === prefix + ' Cut',
      ).length === 2,
    prefix,
  );
  const copies = await page.evaluate(
    async (prefix) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
        (t) => t.meta.title === prefix + ' Cut',
      ),
    prefix,
  );
  const copy = copies.find((t) => t.meta.id !== ids[1]);
  assert.ok(copy, JSON.stringify({ ids, copies }));
  ids.push(copy.meta.id);
  assert.equal(copy.body, 'Task notes');
  assert.deepEqual(copy.meta.checklist, [{ text: 'Step', done: false }]);
  assert.equal(copy.meta.project, a);
  assert.match(await read(b), new RegExp(ids[1]));
  // Moving an inline task onto a file-tree note uses the pointer drag path.
  await openNote(b);
  const box = await native().boundingBox(),
    target = await page.locator(`.nav-file-title[data-path="${a}"]`).boundingBox();
  await page.mouse.move(box.x + 100, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 16 });
  await page.locator('.ot-note-drop-target').waitFor();
  await page.mouse.up();
  await waitForAsync(
    page,
    async ({ id, a }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .project === a,
    { id: ids[1], a },
  );
  await waitForAsync(
    page,
    async ({ a, b, id }) => {
      const read = async (path) => {
        const view = app.workspace
          .getLeavesOfType('markdown')
          .find((leaf) => leaf.view.file?.path === path && leaf.view.getMode() === 'source')?.view;
        return view ? view.editor.getValue() : app.vault.adapter.read(path);
      };
      return !(await read(b)).includes(id) && (await read(a)).includes(id);
    },
    { a, b, id: ids[1] },
  );
  assert.ok(!(await read(b)).includes(ids[1]));
  assert.match(await read(a), new RegExp(ids[1]));
  assert.ok((await read(b)).includes('After B'));
  console.log(
    'PASS: Inbox drag to file tree, deferred cut, paste at cursor, independent copy with notes/checklist, and inline pointer drag between notes.',
  );
} finally {
  await page.evaluate(
    async ({ a, b, prefix }) => {
      for (const l of app.workspace.getLeavesOfType('markdown'))
        if ([a, b].includes(l.view.file?.path)) l.detach();
      for (const path of [a, b]) {
        const f = app.vault.getAbstractFileByPath(path);
        if (f) await app.vault.delete(f);
      }
      const p = app.plugins.getPlugin('thingsmd');
      for (const task of await p.taskRecords())
        if (task.meta.title?.startsWith(prefix)) await p.deleteTask(task.file);
      await p.openList('inbox');
    },
    { a, b, prefix },
  );
  await browser.close();
}
