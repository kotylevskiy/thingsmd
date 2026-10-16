import { connectTestVault } from './obsidian-connection.mjs';
import { mkdir } from 'node:fs/promises';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const folder = 'artifacts/design-review';
await mkdir(folder, { recursive: true });
const note = `Design review ${Date.now()}.md`;
let tasks = [];
const old = await page.evaluate(() => ({
  width: innerWidth,
  height: innerHeight,
  collapsed: app.workspace.leftSplit.collapsed,
  classes: document.body.className,
}));
const active = page.locator('.workspace-leaf.mod-active'),
  row = (i) => active.locator(`.ot-task[data-task-id="${tasks[i].meta.id}"]:visible`).first();
try {
  tasks = await page.evaluate(async (note) => {
    const p = app.plugins.getPlugin('thingsmd'),
      ts = [];
    const day = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return (
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      );
    };
    for (const fields of [
      { title: 'Read the exhibition guide' },
      { title: 'Book train tickets', when: 'today' },
      { title: 'Plan the weekend', when: 'evening' },
      { title: 'Prepare the presentation', when: day(1), deadline: day(3) },
      { title: 'Learn watercolor painting', when: 'someday' },
      { title: 'Find a new desk lamp', when: 'anytime' },
      {
        title: 'Send the proposal',
        status: 'done',
        completed: '2020-01-01',
        loggedAt: '2020-01-01',
      },
      { title: 'Old travel itinerary', deleted: true, deletedAt: new Date().toISOString() },
    ])
      ts.push(await p.createTask(fields));
    await p.patchTask(
      ts[1],
      {
        checklist: [
          { text: 'Compare departure times', done: true },
          { text: 'Reserve window seats', done: false },
        ],
      },
      'Check the return journey before booking.',
    );
    await app.vault.create(
      note,
      '---\ntitle: Weekend plans\n---\n# Travel\n\nKeep the itinerary and tickets together.\n\n' +
        ts
          .slice(1, 6)
          .map((t) => `![[${t.file.path}]]`)
          .join('\n'),
    );
    return ts;
  }, note);
  for (const mobile of [false, true]) {
    const prefix = mobile ? 'mobile' : 'desktop';
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 900 });
    await page.evaluate(
      (m) => (m ? app.workspace.leftSplit.collapse() : app.workspace.leftSplit.expand()),
      mobile,
    );
    await page.waitForTimeout(300);
    const snap = async (name) => {
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${folder}/${prefix}-${name}.png` });
    };
    for (const list of ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'trash']) {
      await page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
      await active.locator('.ot-list-heading').waitFor();
      await snap(list);
    }
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
    await row(1).dblclick();
    await snap('editor');
    for (const kind of ['When', 'Deadline']) {
      await row(1).getByRole('button', { name: kind, exact: true }).click();
      await snap(kind.toLowerCase());
      await page.keyboard.press('Escape');
    }
    await row(1).getByRole('button', { name: 'Move', exact: true }).click();
    await page.locator('.ot-move-modal').waitFor();
    await snap('move');
    await page.keyboard.press('Escape');
    await row(1).dblclick();
    await row(1).getByRole('button', { name: 'Repeat', exact: true }).click();
    await page.locator('.ot-repeat-modal').waitFor();
    await snap('repeat');
    await page
      .locator('.ot-repeat-modal')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture());
    await page.locator('.ot-capture-modal').waitFor();
    await snap('capture');
    await page.keyboard.press('Escape');
    for (const mode of ['source', 'preview']) {
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
      await row(1).waitFor();
      await snap(mode);
    }
    await page.evaluate(() => {
      document.body.classList.remove('theme-light');
      document.body.classList.add('theme-dark');
      return app.plugins.getPlugin('thingsmd').openList('today');
    });
    await snap('dark');
    await page.evaluate((cls) => (document.body.className = cls), old.classes);
  }
  console.log(
    'Captured all list views, both note modes, expanded editor, capture, date/Move/repeat controls, desktop/mobile and dark theme.',
  );
} finally {
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: old.width, height: old.height });
  await page.evaluate(
    async ({ tasks, note, old }) => {
      document.body.className = old.classes;
      const p = app.plugins.getPlugin('thingsmd');
      p.captureModal?.close();
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
      for (const t of tasks) await p.deleteTask(t.file.path);
      await p.openList('today');
      if (!old.collapsed) app.workspace.leftSplit.expand();
    },
    { tasks, note, old },
  );
  await browser.close();
}
