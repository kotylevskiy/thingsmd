import { editTaskNotes } from './edit-task-notes.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const title = `Repeat ${Date.now()}`,
  note = title + '.md';
let id;
const active = page.locator('.workspace-leaf.mod-active');
const records = () =>
  page.evaluate(
    async (title) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).filter((t) => t.meta.title === title),
    title,
  );
try {
  id = await page.evaluate(
    async ({ title, note }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const t = await p.createTask(
        { title, project: note, checklist: [{ text: 'A step', done: true }] },
        undefined,
        'Template notes',
      );
      await app.vault.create(note, `Before\n\n![[${t.file.path.slice(0, -3)}]]\n\nAfter\n`);
      await p.openList('anytime');
      return t.meta.id;
    },
    { title, note },
  );
  const template = () => active.locator(`.ot-task[data-task-id="${id}"]`);
  await template().dblclick();
  await active.getByRole('button', { name: 'Repeat', exact: true }).click();
  const modal = page.locator('.ot-repeat-modal');
  await modal.waitFor();
  await modal.getByLabel('Repeat unit', { exact: true }).selectOption('day');
  await modal.getByLabel('Next repeat date', { exact: true }).click();
  await modal.getByRole('textbox', { name: 'Date', exact: true }).fill('2099-01-15');
  await modal.getByRole('textbox', { name: 'Date', exact: true }).press('Enter');
  await modal.getByLabel('Add deadlines', { exact: true }).check();
  await modal.getByLabel('Days earlier', { exact: true }).fill('5');
  await modal.getByLabel('Repeat ends', { exact: true }).selectOption('date');
  await modal.getByLabel('Repeat end date', { exact: true }).click();
  await modal.getByRole('textbox', { name: 'Date', exact: true }).fill('2099-01-17');
  await modal.getByRole('textbox', { name: 'Date', exact: true }).press('Enter');
  await page.screenshot({ path: 'artifacts/repeat-dialog.png' });
  await modal.getByRole('button', { name: 'OK', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  await page.locator('.ot-list-link[data-list="upcoming"]').click();
  await template().waitFor();
  assert.equal(await template().locator('.ot-repeat-indicator.is-template').count(), 1);
  await template().click({ button: 'right' });
  await page.locator('.menu').getByText('When…', { exact: true }).waitFor();
  assert.equal(await page.locator('.menu').getByText('Deadline…', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(
    await template().evaluate((row) => {
      const repeat = row.querySelector('.ot-repeat-indicator');
      return (
        repeat.previousElementSibling.matches('.ot-task-title') &&
        repeat.nextElementSibling.matches('.ot-task-details') &&
        !!repeat.nextElementSibling.querySelector('.ot-note-icon') &&
        !!repeat.nextElementSibling.querySelector('.ot-checklist-indicator')
      );
    }),
    true,
    'Repeat is the first indicator after the title, before notes and checklist',
  );
  await template().getByRole('checkbox').check();
  await waitForAsync(
    page,
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
        (t) => t.meta.id === id && t.meta.repeat.next === '2099-01-16',
      ),
    id,
  );
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').repeating.tick());
  let all = await records(),
    t = all.find((t) => t.meta.id === id),
    copy = all.find((t) => t.meta.repeatSource === id);
  assert.equal(t.meta.status, 'todo');
  assert.equal(t.meta.repeat.next, '2099-01-16');
  assert.equal(copy.meta.deadline, '2099-01-15');
  assert.equal(copy.meta.when, '2099-01-10');
  assert.equal(copy.meta.checklist[0].done, false);
  assert.match(
    await page.evaluate((note) => app.vault.adapter.read(note), note),
    new RegExp(copy.meta.id),
  );
  await page.evaluate((id) => app.plugins.getPlugin('thingsmd').showRepeatingTask(id), id);
  assert.equal(await active.getByLabel('Checklist item 1', { exact: true }).isDisabled(), true);
  await editTaskNotes(page, 'Future copies use these notes');
  await active.getByRole('button', { name: 'Repeating rule', exact: true }).click();
  await page.getByText('Pause', { exact: true }).click();
  await waitForAsync(
    page,
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .repeat.paused,
    id,
  );
  await template().dblclick();
  await active.getByRole('button', { name: 'Repeating rule', exact: true }).click();
  await page.getByText('Resume', { exact: true }).click();
  await waitForAsync(
    page,
    async (id) =>
      !(await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .repeat.paused,
    id,
  );
  await template().dblclick();
  await active.getByRole('button', { name: 'Repeating rule', exact: true }).click();
  await page.getByText('Create Next Copy', { exact: true }).click();
  await active
    .getByRole('button', { name: 'This is a copy of a repeating to-do', exact: true })
    .waitFor();
  assert.equal(
    await active.locator('.ot-task-notes-preview').innerText(),
    'Future copies use these notes',
  );
  await active
    .getByRole('button', { name: 'This is a copy of a repeating to-do', exact: true })
    .click();
  await active.getByRole('button', { name: 'Repeating rule', exact: true }).waitFor();
  await active.locator('.ot-title-input').press('Enter');
  await active.locator('.ot-title-input').waitFor({ state: 'hidden' });
  // Fixed-schedule rescheduling presents the ThingsMD exception/rule decision.
  await template().dblclick();
  await active.locator('.is-expanded').getByRole('button', { name: 'When', exact: true }).click();
  await active.getByLabel('When date', { exact: true }).fill('2099-02-10');
  await active.getByLabel('When date', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Make Exception', exact: true }).click();
  await waitForAsync(
    page,
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
        (t) => t.meta.repeatSource === id && t.meta.when === '2099-02-10',
      ),
    id,
  );
  await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const v = app.workspace.activeLeaf.view;
    if (v.taskDraft) await v.finishTask();
    await p.repeating.tick();
  });
  all = await records();
  assert.equal(all.filter((t) => t.meta.repeatSource === id).length, 3);
  assert.equal(all.find((t) => t.meta.id === id).meta.repeat.next, null);
  await page.evaluate(async () => {
    const id = 'thingsmd';
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
  });
  assert.equal((await records()).filter((t) => t.meta.repeatSource === id).length, 3);
  // Completion-based rules also work through the native Markdown cards.
  const completion = await page.evaluate(
    async ({ title, note }) => {
      const p = app.plugins.getPlugin('thingsmd'),
        day = new Date(),
        key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const task = await p.createTask(
        { title: title + ' completion', project: note },
        undefined,
        'Completion template notes',
      );
      await app.vault.process(
        app.vault.getAbstractFileByPath(note),
        (text) => text + `\n![[${task.file.path.slice(0, -3)}]]\n`,
      );
      const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
      await leaf.setViewState({
        type: 'markdown',
        state: { file: note, mode: 'source', source: false },
        active: true,
      });
      await p.repeating.configure(task, {
        mode: 'completion',
        unit: 'week',
        interval: 1,
        anchor: key,
        next: key,
        on: [],
        end: null,
        deadline: false,
        leadDays: 0,
      });
      const copy = (await p.taskRecords()).find((t) => t.meta.repeatSource === task.meta.id);
      return { id: task.meta.id, copy: copy.meta.id };
    },
    { title, note },
  );
  const nativeCopy = active.locator(
    `.ot-native .ot-task[data-task-id="${completion.copy}"]:visible`,
  );
  assert.equal(
    await nativeCopy
      .locator('.ot-repeat-indicator')
      .evaluate((marker) => marker.previousElementSibling.matches('.ot-task-title')),
    true,
    'Generated copies also show recurrence after the title',
  );
  await nativeCopy.getByRole('checkbox').check();
  await active
    .locator(`.ot-native .ot-task.is-done[data-task-id="${completion.copy}"]:visible`)
    .waitFor();
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').repeating.tick());
  let c = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
    completion.id,
  );
  assert.ok(c.meta.repeat.next);
  assert.equal(c.meta.repeat.waitingFor, null);
  await nativeCopy.getByRole('checkbox').uncheck();
  await active
    .locator(`.ot-native .ot-task.is-done[data-task-id="${completion.copy}"]:visible`)
    .waitFor({ state: 'hidden' });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').repeating.tick());
  c = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
    completion.id,
  );
  assert.equal(c.meta.repeat.next, null);
  assert.equal(c.meta.repeat.waitingFor, completion.copy);
  console.log(
    'PASS: rule dialog, deadline offsets, early completion, template/checklist separation, pause/resume, next copy, copy-to-template navigation, exception rescheduling, end date, and reload idempotency.',
  );
} finally {
  await page.evaluate(
    async ({ title, note }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.repeating.tick();
      await p.openList('inbox');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === note) leaf.detach();
      const f = app.vault.getAbstractFileByPath(note);
      if (f) await app.vault.delete(f);
      for (const t of await p.taskRecords())
        if (t.meta.title.startsWith(title)) await p.deleteTask(t.file);
    },
    { title, note },
  );
  await browser.close();
}
