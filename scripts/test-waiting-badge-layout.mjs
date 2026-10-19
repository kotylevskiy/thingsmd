import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault({ settings: { enableWaiting: true } });
const note = `Waiting badge layout ${Date.now()}.md`;
let task, settings;
const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const originalSidebarCollapsed = await page.evaluate(() => app.workspace.leftSplit.collapsed);
try {
  ({ task, settings } = await page.evaluate(async (note) => {
    const p = app.plugins.getPlugin('thingsmd');
    const settings = { ...p.settings };
    await p.updateSettings({ logbook: 'manually' });
    const task = await p.createTask(
      {
        title: 'Waiting badge alignment with a long title and surrounding project context. '.repeat(
          5,
        ),
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
        const geometry = await waitForAsync(
          page,
          ({ id, done, width }) => {
            const el = [
              ...document.querySelectorAll(
                `.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`,
              ),
            ].find((row) => row.getBoundingClientRect().width > 0);
            if (!el || innerWidth !== width || el.classList.contains('is-done') !== done)
              return null;
            const line = el.querySelector('.ot-task-line');
            const plane = line.querySelector('.ot-waiting-marker');
            const rect = plane.getBoundingClientRect();
            const path = plane.querySelector('.ot-paper-plane path');
            const glyph = path.getBoundingClientRect();
            const icon = plane.querySelector('svg').getBoundingClientRect();
            const dates = line.querySelector('.ot-row-indicators').getBoundingClientRect();
            const title = line.querySelector('.ot-task-title').getBoundingClientRect();
            return {
              right: rect.right,
              edge:
                line.getBoundingClientRect().right -
                parseFloat(getComputedStyle(line).paddingRight),
              left: rect.left,
              dateRight: dates.right,
              dateTop: dates.top,
              titleBottom: title.bottom,
              firstLineCenter:
                title.top +
                parseFloat(getComputedStyle(line.querySelector('.ot-task-title')).lineHeight) / 2,
              markerCenters: [
                'input[type=checkbox]',
                '.ot-task-details',
                '.ot-row-indicators',
                '.ot-waiting-marker',
              ].map((selector) => {
                const bounds = line.querySelector(selector).getBoundingClientRect();
                return bounds.top + bounds.height / 2;
              }),
              completed: plane.classList.contains('is-completed'),
              fill: getComputedStyle(path).fill,
              stroke: getComputedStyle(path).stroke,
              color: getComputedStyle(plane).color,
              glyphFits:
                glyph.width > 0 &&
                glyph.height > 0 &&
                glyph.left >= icon.left - 1 &&
                glyph.right <= icon.right + 1 &&
                glyph.top >= icon.top - 1 &&
                glyph.bottom <= icon.bottom + 1,
            };
          },
          { id: task.meta.id, done, width },
        );
        assert.ok(
          Math.abs(geometry.right - geometry.edge) < 1,
          `${mode} ${width}px: airplane at trailing edge ${JSON.stringify(geometry)}`,
        );
        assert.equal(geometry.completed, done);
        assert.equal(geometry.fill, geometry.color, 'Solid plane inherits the themed state color');
        assert.equal(geometry.stroke, 'none');
        assert.equal(geometry.glyphFits, true, 'Bundled plane is visible and fits the icon canvas');
        if (width > 520) {
          for (const center of geometry.markerCenters)
            assert.ok(
              Math.abs(center - geometry.firstLineCenter) < 1,
              `${mode}: marker aligns with first title line`,
            );
          assert.ok(geometry.dateRight <= geometry.left, 'Deadline precedes airplane');
        } else
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
    await page.setViewportSize(originalViewport);
    await page.evaluate(
      (collapsed) =>
        collapsed ? app.workspace.leftSplit.collapse() : app.workspace.leftSplit.expand(),
      originalSidebarCollapsed,
    );
    await browser.close();
  }
}
