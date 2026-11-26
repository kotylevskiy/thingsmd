import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';

const { browser, page } = await connectTestVault({ settings: { enableWaiting: true } });
const wasMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd')?.mountListLinks,
    undefined,
    { timeout: 20000 },
  );
let tasks = [];
try {
  await page.setViewportSize({ width: 390, height: 844 });
  if (!wasMobile) await page.evaluate(() => app.emulateMobile(true));
  else await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => app.workspace.leftSplit.type), 'mobile-drawer');
  tasks = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    app.workspace.leftSplit.collapse();
    const date = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      ].join('-');
    };
    return [
      await p.createTask(
        {
          title: 'Учебные материалы нужно разложить по папкам',
          when: 'anytime',
          is_waiting: true,
          deadline: date(3),
        },
        undefined,
        'Full notes remain available in the editor.',
      ),
      await p.createTask(
        {
          title:
            'Проверить учебные материалы, разложить документы по папкам и подготовить список для занятия',
          when: date(2),
          deadline: date(3),
        },
        undefined,
        'Full notes remain available in the editor.',
      ),
    ];
  });
  const active = page.locator('.workspace-leaf.mod-active');
  for (const [index, list] of ['waiting', 'upcoming'].entries()) {
    await page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
    const rows = active.locator(`.ot-task[data-task-id="${tasks[index].meta.id}"]`);
    await rows.first().waitFor();
    for (const row of await rows.all()) {
      const title = row.locator('.ot-task-title');
      const metrics = await title.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
        clipped: el.scrollWidth > el.clientWidth,
        text: el.textContent,
      }));
      assert.ok(metrics.height <= metrics.lineHeight + 1);
      assert.equal(metrics.clipped, true);
      assert.equal(metrics.text, tasks[index].meta.title);
      const textBox = await title.boundingBox();
      const check = await row.locator('.ot-task-line > input').boundingBox();
      assert.ok(Math.abs(check.y + check.height / 2 - textBox.y - textBox.height / 2) < 2);
      const notes = await row.locator('.ot-task-details').boundingBox();
      assert.ok(Math.abs(notes.y + notes.height / 2 - textBox.y - textBox.height / 2) < 2);
      const dates = row.locator('.ot-row-indicators');
      if (await dates.count()) {
        const dateBox = await dates.boundingBox();
        assert.ok(Math.abs(dateBox.x - textBox.x) < 1);
      }
    }
    await page.screenshot({ path: `artifacts/compact-real-mobile-${list}.png` });
    if (list === 'upcoming') {
      assert.equal(await rows.count(), 1);
      assert.equal(await rows.locator('.ot-row-when').count(), 0);
      assert.equal(await rows.locator('.ot-occurrence-label').count(), 0);
      assert.equal(await rows.locator('.ot-row-deadline time').count(), 1);
      assert.ok(await active.getByRole('button', { name: '+ New task', exact: true }).count());
    }
    await rows.first().locator('.ot-task-title').click();
    const editor = rows.first().getByLabel('Task title', { exact: true });
    await editor.waitFor();
    assert.equal(await editor.inputValue(), tasks[index].meta.title);
    await editor.press('Enter');
    await editor.waitFor({ state: 'hidden' });
  }
  console.log(
    'PASS: real Obsidian mobile mode keeps long titles compact, notes adjacent, dates aligned, one Upcoming row with deadline metadata, capture available and full titles editable.',
  );
} finally {
  try {
    await page.evaluate(
      async (ids) => {
        const p = app.plugins.getPlugin('thingsmd');
        for (const task of await p.taskRecords())
          if (ids.includes(task.meta.id)) await p.deleteTask(task.file);
      },
      tasks.map((task) => task.meta.id),
    );
    if (!wasMobile) {
      await page.evaluate(() => app.emulateMobile(false));
      await ready();
    }
  } finally {
    await browser.close();
  }
}
