import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Visual audit ${Date.now()}`;
let state;
const notes = [],
  tasks = [];
try {
  state = await page.evaluate(() => ({
    dark: document.body.classList.contains('theme-dark'),
    collapsed: app.workspace.leftSplit.collapsed,
    progress: app.plugins.getPlugin('thingsmd').settings.showProjectProgress,
  }));
  for (let done = 0; done <= 4; done++) {
    const note = prefix + ` ${done * 25}%.md`;
    notes.push(note);
    const paths = await page.evaluate(
      async ({ prefix, done, note }) => {
        const p = app.plugins.getPlugin('thingsmd'),
          paths = [];
        for (let i = 0; i < 4; i++)
          paths.push(
            (
              await p.createTask({
                title: prefix + ' ' + done + ' ' + i,
                status: i < done ? 'done' : 'todo',
                when: 'today',
              })
            ).file.path,
          );
        await app.vault.create(note, paths.map((path) => `![[${path}]]`).join('\n'));
        return paths;
      },
      { prefix, done, note },
    );
    tasks.push(...paths);
  }
  await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.updateSettings({ showProjectProgress: true });
    app.workspace.leftSplit.expand();
    await p.openList('upcoming');
  });
  for (const note of notes)
    await page.locator(`.nav-file-title[data-path="${note}"] .ot-project-progress svg`).waitFor();
  const spacing = await page
    .locator('.workspace-leaf.mod-active section[data-date]')
    .evaluateAll((sections) =>
      sections.map((section) => {
        const b = section.querySelector('button.ot-capture'),
          previous = b.previousElementSibling || section.querySelector('h2');
        return {
          gap: b.getBoundingClientRect().top - previous.getBoundingClientRect().bottom,
          emptyDrop: !!section.querySelector('div.ot-drop-end'),
        };
      }),
    );
  assert.ok(
    spacing.every((s) => !s.emptyDrop && s.gap < 25),
    JSON.stringify(spacing),
  );
  await page.screenshot({ path: 'artifacts/upcoming-spacing-fixed.png' });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  const row = page
    .locator('.workspace-leaf.mod-active .ot-task')
    .filter({ hasText: prefix + ' 0 0' });
  await row.click({ button: 'right' });
  await page.locator('.menu').getByText('Move…', { exact: true }).click();
  const move = page.locator('.ot-move-modal');
  await move.getByLabel('Find destination').fill(prefix);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.body.classList.toggle('theme-dark', theme === 'dark');
      document.body.classList.toggle('theme-light', theme === 'light');
    }, theme);
    await page.mouse.move(0, 0);
    for (let done = 0; done <= 4; done++) {
      const sidebar = page.locator(
        `.nav-file-title[data-path="${notes[done]}"] .ot-project-progress`,
      );
      const pie = move
        .getByRole('button', { name: notes[done].slice(0, -3), exact: true })
        .locator('.ot-project-progress');
      for (const el of [sidebar, pie]) {
        assert.equal(await el.getAttribute('data-progress'), done + '/4');
        assert.equal(
          await el.evaluate((el) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--interactive-accent)';
            el.appendChild(probe);
            const expected = getComputedStyle(probe).color;
            probe.remove();
            return getComputedStyle(el).color === expected;
          }),
          true,
          'Pie uses theme accent',
        );
        const box = await el.boundingBox();
        assert.equal(box.width, 16);
        assert.equal(box.height, 16);
        assert.equal(await el.locator('svg path').count(), done > 0 && done < 4 ? 1 : 0);
      }
    }
    await page
      .locator('.workspace-leaf-content[data-type="file-explorer"]')
      .screenshot({ path: `artifacts/pies-sidebar-${theme}.png` });
    await move.screenshot({ path: `artifacts/pies-move-${theme}.png` });
  }
  console.log(
    'PASS: Upcoming capture spacing; empty, quarter, half, three-quarter and full SVG pies in sidebar and Move, light and dark.',
  );
} finally {
  await page.keyboard.press('Escape');
  await page.evaluate(
    async ({ notes, tasks, state }) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const path of notes) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file);
      }
      for (const path of tasks) await p.deleteTask(path);
      if (state) {
        document.body.classList.toggle('theme-dark', state.dark);
        document.body.classList.toggle('theme-light', !state.dark);
        await p.updateSettings({ showProjectProgress: state.progress });
        if (state.collapsed) app.workspace.leftSplit.collapse();
      }
      await p.openList('upcoming');
    },
    { notes, tasks, state },
  );
  await browser.close();
}
