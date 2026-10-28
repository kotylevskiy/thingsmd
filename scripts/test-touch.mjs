import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
const cdp = await page.context().newCDPSession(page);
page.setDefaultTimeout(6000);
let tasks = [],
  note = `Touch ${Date.now()}.md`;
const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const collapsed = await page.evaluate(() => app.workspace.leftSplit.collapsed);
const row = (id) =>
  page.locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]:visible`);
const touch = (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints:
      type === 'touchEnd' || type === 'touchCancel'
        ? []
        : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });
const point = async (el) => {
  // Releasing a hold replays any deferred render. Playwright's scrolling action
  // can retain the retiring node; resolve the locator again before starting a gesture.
  const until = Date.now() + 6000;
  while (true) {
    try {
      await el.scrollIntoViewIfNeeded();
      return await el.evaluate((node) => {
        const b = node.getBoundingClientRect();
        return { x: b.x + Math.min(b.width / 2, 130), y: b.y + b.height / 2 };
      });
    } catch (error) {
      if (Date.now() >= until || !error.message.includes('not attached')) throw error;
    }
  }
};
async function tap(el, hold = 0, refresh = false) {
  const p = await point(el);
  await touch('touchStart', p.x, p.y);
  if (refresh)
    await page.evaluate(async () => {
      const p = app.plugins.getPlugin('thingsmd');
      const row = document.querySelector('.ot-touch-pending');
      const task = (await p.taskRecords()).find((t) => t.meta.id === row?.dataset.taskId);
      if (!task) throw new Error('The held task must remain mounted during a refresh');
      await p.patchTask(task, { title: task.meta.title + ' refreshed' });
    });
  if (hold) await page.waitForTimeout(hold);
  await touch('touchEnd');
}
async function drag(from, to, cancel = false) {
  const a = await point(from),
    b = await point(to);
  await touch('touchStart', a.x, a.y);
  await page.waitForTimeout(450);
  for (let i = 1; i <= 8; i++)
    await touch('touchMove', a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y + 8) * i) / 8);
  await touch(cancel ? 'touchCancel' : 'touchEnd');
}
try {
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  tasks = await page.evaluate(async (note) => {
    app.workspace.leftSplit.collapse();
    const p = app.plugins.getPlugin('thingsmd'),
      ts = [];
    for (let i = 0; i < 3; i++)
      ts.push(await p.createTask({ title: 'Touch task ' + i, when: 'today', order: i * 1024 }));
    await app.vault.create(note, ts.map((t) => `![[${t.file.path}]]`).join('\n\n'));
    await p.openList('today');
    return ts;
  }, note);
  await page.waitForTimeout(350);
  for (const mode of ['list', 'source', 'preview']) {
    if (mode !== 'list')
      await page.evaluate(
        async ({ note, mode }) => {
          const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
          await leaf.openFile(app.vault.getAbstractFileByPath(note));
          await leaf.setViewState({
            type: 'markdown',
            state: { file: note, mode, source: false },
            active: true,
          });
        },
        { note, mode },
      );
    await tap(row(tasks[0].meta.id));
    await row(tasks[0].meta.id).locator('.ot-title-input').waitFor();
    await row(tasks[0].meta.id)
      .locator('.ot-title-input')
      .fill('Touch edited ' + mode);
    await page.screenshot({ path: `artifacts/touch-editor-${mode}.png` });
    await row(tasks[0].meta.id).locator('.ot-title-input').press('Enter');
    await row(tasks[0].meta.id).locator('.ot-title-input').waitFor({ state: 'hidden' });
    await tap(row(tasks[0].meta.id).locator('.ot-task-line > input[type=checkbox]'), 600, true);
    await page.locator('.menu').getByText('Mark as Canceled', { exact: true }).waitFor();
    assert.equal(
      await row(tasks[0].meta.id).locator('.ot-task-line > input[type=checkbox]').isChecked(),
      false,
      'Holding a checkbox opens actions without completing the task',
    );
    await page.locator('.menu').getByText('Mark as Canceled', { exact: true }).click();
    await waitForAsync(
      page,
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
          .status === 'canceled',
      tasks[0].meta.id,
    );
    await waitForAsync(
      page,
      (id) =>
        document
          .querySelector(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`)
          ?.classList.contains('is-canceled'),
      tasks[0].meta.id,
    );
    assert.match(await row(tasks[0].meta.id).locator('.ot-task-title').innerText(), / refreshed$/);
    await tap(row(tasks[0].meta.id), 600);
    await page.locator('.menu').getByText('Mark as Incomplete', { exact: true }).click();
    await waitForAsync(
      page,
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
          .status === 'todo',
      tasks[0].meta.id,
    );
    await waitForAsync(
      page,
      (id) => {
        const row = document.querySelector(
          `.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`,
        );
        return row && !row.classList.contains('is-done');
      },
      tasks[0].meta.id,
    );
    await tap(row(tasks[0].meta.id), 600);
    await page.locator('.menu').waitFor();
    await page.screenshot({ path: `artifacts/touch-menu-${mode}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await row(tasks[0].meta.id).locator('.ot-task-more').isVisible(), false);
    await page.screenshot({ path: `artifacts/touch-no-dots-${mode}.png` });
    const ids = tasks.map((t) => t.meta.id);
    const sequence = () =>
      page
        .locator('.workspace-leaf.mod-active .ot-task:visible')
        .evaluateAll(
          (rows, ids) => rows.map((r) => r.dataset.taskId).filter((id) => ids.includes(id)),
          ids,
        );
    const before = await sequence();
    await drag(row(before[0]), row(before[2]), true);
    assert.deepEqual(await sequence(), before);
    await drag(row(before[0]), row(before[2]));
    await page.waitForFunction(
      ({ ids, first }) =>
        [...document.querySelectorAll('.workspace-leaf.mod-active .ot-task')]
          .filter((r) => r.offsetHeight && ids.includes(r.dataset.taskId))
          .at(-1)?.dataset.taskId === first,
      { ids, first: before[0] },
    );
    await page.screenshot({ path: `artifacts/touch-drag-${mode}.png` });
    await tap(row(before[0]));
    await row(before[0]).locator('.ot-title-input').waitFor();
    await row(before[0]).locator('.ot-title-input').press('Enter');
    await row(before[0]).locator('.ot-title-input').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async (note) => {
      const v = app.workspace.activeLeaf.view;
      if (v.getMode?.() === 'source') await v.save();
      return app.vault.adapter.read(note);
    }, note);
    for (const t of tasks)
      assert.equal(saved.split(t.file.path).length - 1, 1, 'Each task reference remains unique');
    console.log('PASS touch:', mode, 'tap edit, hold menu, no mobile dots, drag reorder, cancel');
  }
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await page.setViewportSize({ width: 390, height: 400 });
  const scroller = page.locator('.workspace-leaf.mod-active .ot-main');
  await scroller.evaluate((e) => (e.scrollTop = 0));
  const box = await scroller.boundingBox();
  const orderBefore = await page.evaluate(
    async (ids) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords())
        .filter((t) => ids.includes(t.meta.id))
        .map((t) => [t.meta.id, t.meta.listOrder]),
    tasks.map((t) => t.meta.id),
  );
  await touch('touchStart', box.x + 130, box.y + box.height - 80);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', box.x + 130, box.y + box.height - 80 - i * 20);
    await page.waitForTimeout(20);
  }
  await touch('touchEnd');
  await page.waitForFunction(
    () => document.querySelector('.workspace-leaf.mod-active .ot-main').scrollTop > 0,
  );
  assert.equal(await page.locator('.ot-task-drag-ghost').count(), 0);
  assert.deepEqual(
    await page.evaluate(
      async (ids) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords())
          .filter((t) => ids.includes(t.meta.id))
          .map((t) => [t.meta.id, t.meta.listOrder]),
      tasks.map((t) => t.meta.id),
    ),
    orderBefore,
  );
  console.log('PASS touch: ordinary swipe scrolls without reordering');
} catch (e) {
  await page.screenshot({ path: 'artifacts/touch-failure.png' });
  console.log(
    await page.evaluate(() => ({
      text: app.workspace.activeLeaf.view.data,
      ghost: !!document.querySelector('.ot-task-drag-ghost'),
      rows: [...document.querySelectorAll('.workspace-leaf.mod-active .ot-task')].map((r) => ({
        id: r.dataset.taskId,
        title: r.textContent,
        driver: !!r.closest('.markdown-preview-view')?._otTouchDrag,
      })),
    })),
  );
  throw e;
} finally {
  await touch('touchCancel').catch(() => {});
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.setViewportSize(viewport);
  await page.evaluate(
    async ({ tasks, note, collapsed }) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
      for (const t of tasks) await p.deleteTask(t.file.path);
      await p.openList('inbox');
      if (!collapsed) app.workspace.leftSplit.expand();
    },
    { tasks, note, collapsed },
  );
  await cdp.detach();
  await browser.close();
}
