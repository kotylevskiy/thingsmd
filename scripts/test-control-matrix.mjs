import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Control matrix ${Date.now()}`,
  note = prefix + '.md';
let tasks = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const active = page.locator('.workspace-leaf.mod-active');
let id;
const row = () => active.locator(`.ot-task[data-task-id="${id}"]:visible`),
  picker = () => page.locator('.ot-date-picker');
async function dateControl(kind) {
  await row().getByRole('button', { name: kind, exact: true }).click();
  await picker().waitFor();
}
async function setTextDate(kind, value) {
  await dateControl(kind);
  await picker()
    .getByLabel(kind === 'When' ? 'When date' : 'Deadline date')
    .fill(value);
  await picker()
    .getByLabel(kind === 'When' ? 'When date' : 'Deadline date')
    .press('Enter');
  await picker().waitFor({ state: 'detached' });
}
try {
  await page.evaluate(async (note) => {
    await app.vault.create(note, '# Controls\n');
  }, note);
  for (const view of ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'source', 'preview']) {
    const task = await page.evaluate(
      async ({ view, prefix, note }) => {
        const p = app.plugins.getPlugin('thingsmd');
        const t = await p.createTask({
          title: prefix + ' ' + view,
          when:
            view === 'today'
              ? 'today'
              : view === 'upcoming'
                ? '2099-01-01'
                : view === 'someday'
                  ? 'someday'
                  : view === 'inbox'
                    ? null
                    : 'anytime',
        });
        if (['source', 'preview'].includes(view)) {
          await app.vault.append(app.vault.getAbstractFileByPath(note), `\n![[${t.file.path}]]\n`);
          await new Promise((r) => setTimeout(r, 200));
          const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
          await leaf.openFile(app.vault.getAbstractFileByPath(note));
          await leaf.setViewState({
            type: 'markdown',
            state: { file: note, mode: view, source: false },
            active: true,
          });
        } else {
          await p.openList(view);
          app.workspace.activeLeaf.view.selectTask(null);
        }
        return t;
      },
      { view, prefix, note },
    );
    tasks.push(task);
    id = task.meta.id;
    await row().waitFor();
    assert.equal(await active.locator('.ot-list-toolbar').count(), 0);
    await row().dblclick();
    await row()
      .getByLabel('Task title', { exact: true })
      .fill(prefix + ' ' + view + ' edited');
    await row().getByLabel('Task notes', { exact: true }).fill('Notes survive control edits.');
    await row().getByRole('button', { name: 'Checklist', exact: true }).click();
    await row().getByLabel('Checklist text 1', { exact: true }).fill('First step');
    await row().getByLabel('Checklist item 1', { exact: true }).check();
    assert.equal(await row().getByLabel('Checklist item 1', { exact: true }).isChecked(), true);
    const geometry = await row()
      .getByLabel('Checklist item 1', { exact: true })
      .evaluate((el) => {
        const p = getComputedStyle(el, '::after');
        return {
          width: el.clientWidth,
          height: el.clientHeight,
          glyphWidth: parseFloat(p.width),
          glyphHeight: parseFloat(p.height),
        };
      });
    assert.ok(geometry.glyphWidth <= geometry.width && geometry.glyphHeight <= geometry.height);
    await row().getByLabel('Checklist text 1', { exact: true }).press('Enter');
    await row().getByLabel('Checklist text 2', { exact: true }).fill('Second step');
    await row().getByLabel('Checklist text 2', { exact: true }).press('Enter');
    await row().getByLabel('Checklist text 3', { exact: true }).press('Backspace');
    assert.equal(await row().locator('.ot-checklist-row').count(), 2);
    await dateControl('When');
    await picker().getByLabel('When date').fill('2026-02-31');
    await picker().getByLabel('When date').press('Enter');
    assert.equal(await picker().getByLabel('When date').getAttribute('aria-invalid'), 'true');
    await picker().getByLabel('When date').fill('');
    if (await picker().getByLabel('Show full calendar').isVisible())
      await picker().getByLabel('Show full calendar').click();
    const month = await picker().locator('.ot-calendar-month').innerText();
    await picker().getByRole('button', { name: 'Next month', exact: true }).click();
    assert.notEqual(await picker().locator('.ot-calendar-month').innerText(), month);
    await picker().getByRole('button', { name: 'Previous month', exact: true }).click();
    assert.equal(await picker().locator('.ot-calendar-month').innerText(), month);
    await picker().locator('.ot-calendar-day:not(.is-outside)').nth(15).click();
    await picker().waitFor({ state: 'detached' });
    for (const label of [/^Today/, 'This Evening', 'Someday']) {
      await dateControl('When');
      await picker()
        .getByRole('button', { name: label, exact: typeof label === 'string' })
        .click();
      await picker().waitFor({ state: 'detached' });
    }
    await setTextDate('When', '2099-05-20');
    await dateControl('When');
    await picker().getByLabel('When date').fill('tomorrow');
    await picker().getByRole('button', { name: 'Clear search', exact: true }).click();
    assert.equal(await picker().getByLabel('When date').inputValue(), '');
    await picker().getByRole('button', { name: 'Clear schedule', exact: true }).click();
    await setTextDate('When', '2099-05-21');
    await dateControl('When');
    await picker().getByRole('button', { name: 'Clear schedule', exact: true }).click();
    await setTextDate('Deadline', '2099-06-01');
    await dateControl('Deadline');
    await picker().getByRole('button', { name: 'Remove deadline', exact: true }).click();
    await setTextDate('Deadline', '2099-06-02');
    await page.screenshot({ path: `artifacts/controls-${view}.png` });
    if (view === 'inbox') await page.screenshot({ path: 'artifacts/controls-checklist-fixed.png' });
    await row().getByLabel('Task title', { exact: true }).press('Enter');
    await waitForAsync(
      page,
      async (id) => {
        const t = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
          (t) => t.meta.id === id,
        );
        return (
          t.meta.when === 'anytime' &&
          t.meta.deadline === '2099-06-02' &&
          t.meta.checklist?.length === 2 &&
          t.meta.checklist[0].done &&
          t.body === 'Notes survive control edits.'
        );
      },
      id,
    );
    if (!['source', 'preview'].includes(view))
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
    await row().dblclick();
    await row().getByRole('button', { name: 'Repeat', exact: true }).click();
    await page
      .locator('.ot-repeat-modal')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await row().dblclick();
    await row().getByRole('button', { name: 'Move', exact: true }).click();
    await page
      .locator('.ot-move-modal')
      .getByLabel('Find destination')
      .fill('not a destination 12345');
    await page.locator('.ot-move-empty').waitFor();
    await page.keyboard.press('Escape');
    console.log('PASS control matrix:', view);
  }
  assert.deepEqual(errors, []);
} finally {
  await page.keyboard.press('Escape');
  await page.evaluate(
    async ({ tasks, note }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.open();
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      for (const t of tasks) await p.deleteTask(t.file.path);
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
      await p.open();
    },
    { tasks, note },
  );
  await browser.close();
}
