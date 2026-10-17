import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const prefix = `Lists ${Date.now()}`;
let paths = [];
const active = page.locator('.workspace-leaf.mod-active');
const open = async (list) => {
  await page.locator(`.ot-list-link[data-list="${list}"]`).click();
  await active
    .locator('h1')
    .getByText(list[0].toUpperCase() + list.slice(1), { exact: true })
    .waitFor();
  assert.equal(
    await active.locator('.view-header-title').textContent(),
    list[0].toUpperCase() + list.slice(1),
  );
};
const row = (name) =>
  active
    .locator('.ot-task')
    .filter({ has: page.locator('.ot-task-title', { hasText: prefix + ' ' + name }) });
try {
  paths = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const date = new Date();
    date.setDate(date.getDate() + 3);
    const future = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    await app.vault.create(`${prefix}.md`, '# List fixture\n');
    const tasks = [];
    for (const [title, fields] of [
      ['Inbox', {}],
      ['Project', { project: `${prefix}.md` }],
      ['Today', { when: 'today' }],
      ['Future', { when: future }],
      ['Anytime', { when: 'anytime' }],
      ['Someday', { when: 'someday' }],
      ['Deadline', { deadline: future }],
    ])
      tasks.push((await p.createTask({ title: prefix + ' ' + title, ...fields })).file.path);
    return tasks;
  }, prefix);
  await open('inbox');
  await row('Inbox').waitFor();
  for (const name of ['Project', 'Today', 'Future', 'Anytime', 'Someday'])
    assert.equal(await row(name).count(), 0);
  await row('Deadline').waitFor();
  await row('Inbox').dblclick();
  await active.locator('.is-expanded').getByRole('button', { name: 'When', exact: true }).click();
  await active.getByRole('button', { name: /^Today/ }).click();
  await active.locator('.ot-title-input').press('Enter');
  await active.locator('.ot-inbox-moved').getByText('1 to-do was moved out of the Inbox').waitFor();
  await row('Inbox').waitFor();
  await open('today');
  assert.equal(await active.locator('.ot-inbox-moved').count(), 0);
  await row('Inbox').waitFor();
  await row('Today').waitFor();
  await open('anytime');
  for (const name of ['Inbox', 'Today', 'Project', 'Anytime']) await row(name).waitFor();
  for (const name of ['Future', 'Someday']) assert.equal(await row(name).count(), 0);
  await row('Anytime').dblclick();
  await active.locator('.is-expanded').getByRole('button', { name: 'When', exact: true }).click();
  await active.getByRole('button', { name: 'Someday', exact: true }).click();
  await active.locator('.ot-title-input').press('Enter');
  await row('Anytime').waitFor({ state: 'hidden' });
  await open('someday');
  await row('Anytime').waitFor();
  await row('Someday').waitFor();
  await row('Anytime').dblclick();
  await active.locator('.is-expanded').getByRole('button', { name: 'When', exact: true }).click();
  await active.getByRole('button', { name: 'Clear schedule', exact: true }).click();
  await active.locator('.ot-title-input').press('Enter');
  await row('Anytime').waitFor({ state: 'hidden' });
  await open('upcoming');
  await row('Future').waitFor();
  assert.equal(await row('Deadline').count(), 0);
  assert.equal(await row('Someday').count(), 0);
  assert.equal(
    await active.locator('button.ot-capture').count(),
    await active.locator('section[data-date]').count(),
  );
  assert.equal(await active.getByRole('button', { name: 'New to-do', exact: true }).count(), 0);
  assert.ok((await active.locator('section[data-date]').count()) >= 7);
  assert.ok(
    await active
      .locator('section[data-date]')
      .evaluateAll((sections) => sections.some((section) => !section.querySelector('.ot-task'))),
  );
  await open('anytime');
  assert.equal(await active.locator('button.ot-capture').count(), 0);
  assert.equal(await active.getByRole('button', { name: 'New to-do', exact: true }).count(), 0);
  await open('inbox');
  assert.equal(await row('Anytime').count(), 0);
  console.log(
    'PASS: five sidebar lists, Inbox exclusions, Today/Anytime overlap, project membership, future/deadline grouping, Someday assignment, clear-to-Anytime, seven-day Upcoming overview, per-day Upcoming capture buttons, and no capture buttons in Anytime.',
  );
} finally {
  await page.evaluate(
    async ({ paths, prefix }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.captureModal?.close();
      for (const path of paths) await p.deleteTask(path);
      const note = app.vault.getAbstractFileByPath(`${prefix}.md`);
      if (note) await app.vault.delete(note);
      await p.openList('upcoming');
    },
    { paths, prefix },
  );
  await browser.close();
}
