import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
const note = `Waiting badge layout ${Date.now()}.md`;
let task, settings;
try {
  ({ task, settings } = await page.evaluate(async (note) => {
    const p = app.plugins.getPlugin('thingsmd');
    const settings = { ...p.settings };
    await p.updateSettings({ logbook: 'manually' });
    const task = await p.createTask(
      {
        title: 'Waiting badge alignment',
        when: '2099-05-01',
        deadline: '2099-05-03',
        is_waiting: true,
      },
      undefined,
      'Notes indicator',
    );
    await app.vault.create(note, `![[${task.file.path}]]\n`);
    return { task, settings };
  }, note));
  for (const done of [false, true]) {
    await page.evaluate(
      async ({ id, done }) => {
        const p = app.plugins.getPlugin('thingsmd');
        await p.patchTask(
          (await p.taskRecords()).find((t) => t.meta.id === id),
          { status: done ? 'done' : 'todo' },
        );
      },
      { id: task.meta.id, done },
    );
    for (const mode of ['upcoming', 'source', 'preview']) {
      await page.evaluate(
        async ({ mode, note }) => {
          const p = app.plugins.getPlugin('thingsmd');
          app.workspace.leftSplit.collapse();
          if (mode === 'upcoming') await p.openList(mode);
          else {
            const leaf = p.mainWorkspaceLeaf();
            await leaf.openFile(app.vault.getAbstractFileByPath(note));
            await leaf.setViewState({
              type: 'markdown',
              state: { file: note, mode, source: false },
              active: true,
            });
          }
        },
        { mode, note },
      );
      const row = page.locator(
        `.workspace-leaf.mod-active .ot-task[data-task-id="${task.meta.id}"]:visible`,
      );
      await row.waitFor();
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 844 });
        const geometry = await row.evaluate((el) => {
          const line = el.querySelector('.ot-task-line');
          const plane = line.querySelector('.ot-waiting-marker');
          const rect = plane.getBoundingClientRect();
          const dates = line.querySelector('.ot-row-indicators').getBoundingClientRect();
          const title = line.querySelector('.ot-task-title').getBoundingClientRect();
          return {
            right: rect.right,
            edge:
              line.getBoundingClientRect().right - parseFloat(getComputedStyle(line).paddingRight),
            left: rect.left,
            dateRight: dates.right,
            dateTop: dates.top,
            titleBottom: title.bottom,
            completed: plane.classList.contains('is-completed'),
          };
        });
        assert.ok(
          Math.abs(geometry.right - geometry.edge) < 1,
          `${mode} ${width}px: airplane at trailing edge`,
        );
        assert.equal(geometry.completed, done);
        if (width > 520)
          assert.ok(geometry.dateRight <= geometry.left, 'Deadline precedes airplane');
        else
          assert.ok(geometry.dateTop >= geometry.titleBottom, 'Phone deadline remains below title');
      }
    }
  }
  console.log(
    'PASS: airplane at trailing edge with deadline and notes in Upcoming, Live Preview and Reading, desktop/phone, active/completed states.',
  );
} finally {
  try {
    await page.evaluate(
      async ({ id, note, settings }) => {
        const p = app.plugins.getPlugin('thingsmd');
        await p.openList('upcoming');
        if (id) {
          const task = (await p.taskRecords()).find((t) => t.meta.id === id);
          if (task) await p.deleteTask(task.file);
        }
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.delete(file);
        if (settings) await p.updateSettings(settings);
      },
      { id: task?.meta.id, note, settings },
    );
  } finally {
    await browser.close();
  }
}
