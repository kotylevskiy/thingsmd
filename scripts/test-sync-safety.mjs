import { editTaskNotes } from './edit-task-notes.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
let task, path;
const prefix = `Sync safety ${Date.now()}`;
const active = page.locator('.workspace-leaf.mod-active');
const title = () => active.locator('.ot-title-input');
const disk = () => readFile(path, 'utf8');
const external = async (fn) => writeFile(path, fn(await disk()));
const record = () =>
  page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
    task.meta.id,
  );
const row = () => active.locator(`.ot-task[data-task-id="${task.meta.id}"]`);
async function close() {
  await title().press('Enter');
  await title().waitFor({ state: 'hidden' });
}
async function reload() {
  await active.getByRole('button', { name: 'Reload task', exact: true }).click();
  await title().waitFor({ state: 'hidden' });
}
try {
  task = await page.evaluate(async (prefix) => {
    app.setting.close();
    const p = app.plugins.getPlugin('thingsmd');
    const t = await p.createTask({ title: prefix });
    await p.openList('inbox');
    return t;
  }, prefix);
  path = resolve(process.env.THINGSMD_TEST_VAULT, task.file.path);
  await row().dblclick();
  await editTaskNotes(page, 'Saved local notes');
  await close();
  assert.match(await disk(), /Saved local notes/);
  // Real filesystem writes bypass the plugin and Obsidian adapter notifications.
  await external((s) => s.replace(prefix, prefix + ' remote'));
  await row()
    .getByText(prefix + ' remote', { exact: true })
    .waitFor();
  await row().dblclick();
  await title().waitFor();
  await external((s) => s + '\nRemote notes');
  await title().fill(prefix + ' local title');
  await close();
  assert.match(await disk(), /Remote notes/);
  assert.equal((await record()).meta.title, prefix + ' local title');
  await row().dblclick();
  await title().waitFor();
  await external((s) => s.replace(prefix + ' local title', prefix + ' remote title'));
  await title().fill(prefix + ' unsaved title');
  await active.getByRole('alert').waitFor();
  assert.equal(await title().inputValue(), prefix + ' unsaved title');
  assert.equal((await record()).meta.title, prefix + ' remote title');
  await title().press('Enter');
  assert.equal(await title().count(), 1);
  await page.screenshot({ path: 'artifacts/sync-title-conflict.png' });
  await reload();
  await row().dblclick();
  await title().waitFor();
  const stale = await record();
  await external((s) => s + '\nSecond remote notes');
  const conflict = await page.evaluate(async (stale) => {
    try {
      await app.plugins.getPlugin('thingsmd').patchTask(stale, {}, 'Unsaved local notes');
      return '';
    } catch (error) {
      return error.message;
    }
  }, stale);
  assert.match(conflict, /changed elsewhere/);
  assert.match(await disk(), /Second remote notes/);
  await close();
  // Inject an indexed-file write failure for this fixture only, then retry the same draft.
  await row().dblclick();
  await page.evaluate((path) => {
    const a = app.vault;
    window.syncTestWrite = a.process;
    a.process = async function (p, ...args) {
      if (p.path === path) throw new Error('Injected disk failure');
      return window.syncTestWrite.call(this, p, ...args);
    };
  }, task.file.path);
  const before = await disk();
  await title().fill('Recover after failed write');
  await active.getByRole('alert').waitFor();
  assert.equal(await disk(), before);
  assert.equal(await title().inputValue(), 'Recover after failed write');
  await page.evaluate(() => {
    app.vault.process = window.syncTestWrite;
    delete window.syncTestWrite;
  });
  await close();
  assert.match(await disk(), /Recover after failed write/);
  // Changes in the read/recheck interval must abort the local write.
  const race = await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd'),
      t = (await p.taskRecords()).find((t) => t.meta.id === id),
      original = p.readTask;
    let reads = 0;
    try {
      p.readTask = async function (file) {
        if (file.path === t.file.path && ++reads === 2)
          await app.vault.adapter.write(
            t.file.path,
            (await original.call(this, file)) + '\nConcurrent remote write',
          );
        return original.call(this, file);
      };
      try {
        await p.patchTask(t, { title: 'Must not replace remote' });
        return 'unexpected success';
      } catch (e) {
        return e.message;
      }
    } finally {
      p.readTask = original;
    }
  }, task.meta.id);
  assert.match(race, /changed elsewhere/);
  assert.match(await disk(), /Concurrent remote write/);
  assert.doesNotMatch(await disk(), /Must not replace remote/);
  // Concurrent plugin writes to separate fields merge; same-field stale edits reject.
  const concurrent = await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd'),
      t = (await p.taskRecords()).find((t) => t.meta.id === id);
    const a = await Promise.allSettled([
      p.patchTask(t, { title: 'Concurrent title' }),
      p.patchTask(t, { checklist: [{ text: 'Merged item', done: false }] }),
    ]);
    const fresh = (await p.taskRecords()).find((t) => t.meta.id === id);
    const b = await Promise.allSettled([
      p.patchTask(fresh, { title: 'Winner' }),
      p.patchTask(fresh, { title: 'Loser' }),
    ]);
    return [a.map((r) => r.status), b.map((r) => r.status)];
  }, task.meta.id);
  assert.deepEqual(concurrent, [
    ['fulfilled', 'fulfilled'],
    ['fulfilled', 'rejected'],
  ]);
  assert.equal((await record()).meta.title, 'Winner');
  assert.deepEqual((await record()).meta.checklist, [{ text: 'Merged item', done: false }]);
  const saved = await disk();
  await page.evaluate(async () => {
    const id = 'thingsmd';
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
    await app.plugins.getPlugin(id).openList('inbox');
  });
  assert.equal(await disk(), saved);
  await row().getByText('Winner', { exact: true }).waitFor();
  console.log(
    'PASS: real external-file refresh; durable saves/reload; non-overlapping edits merge; title/body conflicts preserve disk and draft; failed writes retain draft and retry; read/recheck race rejects; local writes serialize.',
  );
} finally {
  await page.evaluate(async (task) => {
    if (window.syncTestWrite) {
      app.vault.process = window.syncTestWrite;
      delete window.syncTestWrite;
    }
    const p = app.plugins.getPlugin('thingsmd');
    const v = app.workspace.activeLeaf.view;
    clearTimeout(v.saveTimer);
    v.taskEditorController.taskDraft = null;
    v.expanded = null;
    v.editing = false;
    if (task) await p.deleteTask(task.file.path);
    await p.openList('inbox');
  }, task);
  await browser.close();
}
