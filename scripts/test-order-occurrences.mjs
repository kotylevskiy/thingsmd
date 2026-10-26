import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault({ settings: { enableWaiting: true } });
page.setDefaultTimeout(8000);
const prefix = `Ordering ${Date.now()}`,
  note = prefix + '.md';
let tasks = [],
  extras = [];
const active = page.locator('.workspace-leaf.mod-active');
const row = (id) => active.locator(`.ot-task[data-task-id="${id}"]`);
try {
  await page.evaluate(() => app.setting.close());
  extras = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd'),
      ts = [];
    for (let i = 0; i < 3; i++)
      ts.push(await p.createTask({ title: prefix + ' inbox ' + i, order: i * 1024 }));
    await p.openList('inbox');
    return ts;
  }, prefix);
  await page.evaluate(
    async (ids) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const t of await p.taskRecords())
        if (ids.includes(t.meta.id)) await p.patchTask(t, { order: 0 });
      await p.openList('inbox');
    },
    extras.map((t) => t.meta.id),
  );
  extras.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  await row(extras[2].meta.id).click();
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:move-task-up'));
  await waitForAsync(
    page,
    async (id) =>
      Number.isFinite(
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
          .listOrder?.inbox,
      ),
    extras[2].meta.id,
  );
  await row(extras[2].meta.id).dragTo(row(extras[0].meta.id), { targetPosition: { x: 50, y: 2 } });
  await page.waitForFunction(
    (ids) =>
      [...document.querySelectorAll('.workspace-leaf.mod-active .ot-task')].find((e) =>
        ids.includes(e.dataset.taskId),
      )?.dataset.taskId === ids[2],
    extras.map((t) => t.meta.id),
  );

  tasks = await page.evaluate(
    async ({ prefix, note }) => {
      const p = app.plugins.getPlugin('thingsmd'),
        tasks = [];
      for (let i = 0; i < 3; i++)
        tasks.push(
          await p.createTask({
            title: prefix + ' ' + i,
            order: i * 1024,
            when: 'today',
            checklist: [
              { text: 'One', done: false },
              { text: 'Two', done: true },
              { text: 'Three', done: false },
            ],
          }),
        );
      await app.vault.create(note, tasks.map((t) => `![[${t.file.path}]]`).join('\n'));
      await p.openList('today');
      return tasks;
    },
    { prefix, note },
  );
  const ids = tasks.map((t) => t.meta.id);
  const sequence = () =>
    active
      .locator('.ot-task')
      .evaluateAll(
        (els, ids) => els.map((e) => e.dataset.taskId).filter((id) => ids.includes(id)),
        ids,
      );
  await row(ids[2]).click();
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:move-task-up'));
  await page.waitForFunction(
    ({ ids }) => {
      const rows = [...document.querySelectorAll('.workspace-leaf.mod-active .ot-task')]
        .map((e) => e.dataset.taskId)
        .filter((id) => ids.includes(id));
      return rows.join() === [ids[0], ids[2], ids[1]].join();
    },
    { ids },
  );
  await row(ids[2]).dragTo(row(ids[0]), { targetPosition: { x: 50, y: 2 } });
  await page.waitForFunction(
    (ids) =>
      [...document.querySelectorAll('.workspace-leaf.mod-active .ot-task')].find((e) =>
        ids.includes(e.dataset.taskId),
      )?.dataset.taskId === ids[2],
    ids,
  );
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
  assert.deepEqual(await sequence(), ids);
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  assert.deepEqual(await sequence(), [ids[2], ids[0], ids[1]]);
  await row(ids[0]).dblclick();
  await row(ids[0]).getByLabel('Checklist text 3', { exact: true }).focus();
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:move-checklist-up'));
  await page.waitForFunction(
    () => document.querySelector('[data-quiet-label="Checklist text 2"]')?.value === 'Three',
  );
  assert.equal(
    await row(ids[0]).getByLabel('Checklist text 2', { exact: true }).inputValue(),
    'Three',
  );
  const grip = await row(ids[0])
      .getByRole('button', { name: 'Reorder checklist item 1', exact: true })
      .boundingBox(),
    target = await row(ids[0]).locator('.ot-checklist-row').nth(2).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  assert.equal(
    await row(ids[0]).getByLabel('Checklist text 3', { exact: true }).inputValue(),
    'One',
  );
  await page.screenshot({ path: 'artifacts/checklist-ordering.png' });
  await row(ids[0]).getByLabel('Task title', { exact: true }).press('Enter');
  await row(ids[0]).locator('.ot-title-input').waitFor({ state: 'hidden' });
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.patchTask(
      (await p.taskRecords()).find((t) => t.meta.id === id),
      { when: '2099-05-01', deadline: '2099-05-03' },
    );
    await p.openList('upcoming');
  }, ids[0]);
  const start = active.locator(
      `section[data-date="2099-05-01"] .ot-task[data-task-id="${ids[0]}"]`,
    ),
    due = active.locator(`section[data-date="2099-05-03"] .ot-task[data-task-id="${ids[0]}"]`);
  await start.waitFor();
  assert.equal(await due.count(), 0);
  assert.equal(await row(ids[0]).count(), 1);
  assert.equal(await start.locator('.ot-row-deadline time').getAttribute('datetime'), '2099-05-03');
  // Commands retain the single scheduled placement while deadline metadata stays independent.
  await start.click();
  await page.evaluate(() => app.commands.executeCommandById('thingsmd:toggle-waiting'));
  await page.waitForFunction((id) => {
    const row = document.activeElement;
    return (
      row?.dataset.taskId === id &&
      row.closest('section[data-date]')?.dataset.date === '2099-05-01' &&
      !!row.querySelector('.ot-waiting-marker')
    );
  }, ids[0]);
  await start.dblclick();
  await start.locator('.ot-title-input').waitFor();
  assert.equal(await row(ids[0]).locator('.ot-title-input').count(), 1);
  await start.getByLabel('Task title', { exact: true }).fill(prefix + ' changed');
  await start.getByLabel('Task title', { exact: true }).press('Enter');
  await row(ids[0])
    .first()
    .getByText(prefix + ' changed', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.notice').filter({ hasText: 'changed elsewhere' }).count(), 0);
  await page.screenshot({ path: 'artifacts/upcoming-single-placement.png' });
  await page.evaluate(() => app.workspace.leftSplit.collapse());
  await page.setViewportSize({ width: 390, height: 844 });
  // Resize and background refresh can replace the row. Resolve and scroll in
  // one browser operation rather than holding an element during a stability wait.
  await start.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
  await page.screenshot({ path: 'artifacts/upcoming-single-placement-mobile.png' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => app.workspace.leftSplit.expand());
  const original = await page.evaluate((note) => app.vault.adapter.read(note), note);
  assert.equal(original, tasks.map((t) => `![[${t.file.path}]]`).join('\n'));
  const date = await active.locator('section[data-date]').first().getAttribute('data-date');
  // Begin the native drag before scrolling to a distant day. dragTo() can
  // scroll the source away before the browser has emitted dragstart.
  await start.hover({ position: { x: 80, y: 10 } });
  const sourceBox = await start.boundingBox();
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + 100, sourceBox.y + 10, { steps: 4 });
  await active.locator('.ot-task.is-dragging').waitFor();
  const drop = active.locator(`section[data-date="${date}"] .ot-capture`);
  await drop.hover();
  await drop.hover();
  await page.mouse.up();
  await waitForAsync(
    page,
    async ({ id, date }) => {
      const t = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.id === id,
      );
      return t.meta.when === date && t.meta.deadline === '2099-05-03';
    },
    { id: ids[0], date },
  );
  await row(ids[0]).first().getByRole('checkbox').check();
  await page.waitForFunction(
    (id) =>
      [
        ...document.querySelectorAll(
          `.workspace-leaf.mod-active .ot-task[data-task-id="${id}"] input[type=checkbox]`,
        ),
      ].every((e) => e.checked),
    ids[0],
  );
  await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.openList('today');
    const id = p.manifest.id;
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
    await app.plugins.getPlugin(id).openList('today');
  });
  const stored = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
    ids[0],
  );
  assert.deepEqual(
    stored.meta.checklist.map((i) => i.text),
    ['Three', 'Two', 'One'],
  );
  assert.equal(stored.meta.checklist[1].done, true);
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('inbox'));
  assert.equal(
    await active.locator('.ot-task').evaluateAll(
      (rows, ids) => rows.find((r) => ids.includes(r.dataset.taskId))?.dataset.taskId,
      extras.map((t) => t.meta.id),
    ),
    extras[2].meta.id,
  );
  console.log(
    'PASS: independent persistent list ordering, keyboard and drag, checklist ordering, one Upcoming placement, single editor, persistent updates/completion, schedule drag preserves deadline, preserved note text.',
  );
} finally {
  await page.evaluate(
    async ({ tasks, note }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.open();
      for (const t of tasks) await p.deleteTask(t.file.path);
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
    },
    { tasks: [...tasks, ...extras], note },
  );
  await browser.close();
}
