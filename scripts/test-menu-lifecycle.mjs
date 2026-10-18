import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault({ settings: { enableWaiting: true } });
page.setDefaultTimeout(8000);
let state;
try {
  state = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd'),
      tasks = [];
    for (const title of ['Menu lifecycle first', 'Menu lifecycle second'])
      tasks.push(await p.createTask({ title, when: 'today' }));
    const path = 'Menu lifecycle ' + Date.now() + '.md';
    await app.vault.create(path, tasks.map((t) => '![[' + t.file.path + ']]').join('\n'));
    return { tasks, path };
  });
  for (const mode of ['list', 'source', 'preview']) {
    await page.evaluate(
      async ({ mode, path }) => {
        if (mode === 'list') await app.plugins.getPlugin('thingsmd').openList('today');
        else {
          const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
          await leaf.openFile(app.vault.getAbstractFileByPath(path));
          await leaf.setViewState({
            type: 'markdown',
            state: { file: path, mode, source: false },
            active: true,
          });
        }
      },
      { mode, path: state.path },
    );
    const row = (i) =>
      page.locator(
        `.workspace-leaf.mod-active .ot-task[data-task-id="${state.tasks[i].meta.id}"]:visible`,
      );
    for (let i = 0; i < 6; i++) {
      await row(i % 2).click({ button: 'right', position: { x: i % 2 ? 35 : 500, y: 8 } });
      await page.locator('.menu:visible').waitFor();
      assert.equal(await page.locator('.menu:visible').count(), 1);
    }
    await page.locator('.menu:visible').screenshot({ path: `artifacts/menu-single-${mode}.png` });
    await page.keyboard.press('Escape');
    await page.locator('.menu:visible').waitFor({ state: 'hidden' });
    // Slow the first request so a newer right click completes before it.
    await page.evaluate(
      async (ids) => {
        const p = app.plugins.getPlugin('thingsmd'),
          original = p.taskRecords;
        let n = 0;
        try {
          p.taskRecords = async function () {
            const records = await original.call(this);
            if (++n === 1) await new Promise((r) => setTimeout(r, 180));
            return records;
          };
          const rows = ids.map((id) =>
            [...document.querySelectorAll(`[data-task-id="${id}"]`)].find(
              (e) => e.getBoundingClientRect().width,
            ),
          );
          await Promise.all(
            rows.map((r, i) => p.showTaskMenu(r, { clientX: 100 + i * 200, clientY: 200 })),
          );
        } finally {
          p.taskRecords = original;
        }
      },
      state.tasks.map((t) => t.meta.id),
    );
    assert.equal(await page.locator('.menu:visible').count(), 1);
    await page.locator('.menu:visible').getByText('Mark as Waiting', { exact: true }).click();
    await waitForAsync(
      page,
      async (ids) => {
        const ts = await app.plugins.getPlugin('thingsmd').taskRecords();
        return (
          !ts.find((t) => t.meta.id === ids[0]).meta.is_waiting &&
          ts.find((t) => t.meta.id === ids[1]).meta.is_waiting
        );
      },
      state.tasks.map((t) => t.meta.id),
    );
    await page.evaluate(async (id) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.patchTask(
        (await p.taskRecords()).find((t) => t.meta.id === id),
        { is_waiting: false },
      );
    }, state.tasks[1].meta.id);
  }
  console.log(
    'PASS: repeated right clicks keep one menu in lists, Live Preview and Reading; out-of-order requests target only the newest task; Escape dismisses.',
  );
} finally {
  await page.keyboard.press('Escape');
  await page.evaluate(async (s) => {
    const p = app.plugins.getPlugin('thingsmd');
    p.beginTaskMenu();
    if (s) {
      const f = app.vault.getAbstractFileByPath(s.path);
      if (f) await app.vault.delete(f);
      for (const t of s.tasks) await p.deleteTask(t.file.path);
    }
    await p.openList('today');
  }, state);
  await browser.close();
}
