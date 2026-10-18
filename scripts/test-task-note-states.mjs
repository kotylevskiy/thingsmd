import assert from 'node:assert/strict';
import { taskNoteContext } from './task-note-test-context.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const t = await taskNoteContext('states');
const { page, controls, action, saved } = t;
const button = (name) => controls().getByRole('button', { name, exact: true });
async function ruleState(id, key, expected) {
  await waitForAsync(
    page,
    async ({ id, key, expected }) => {
      const task = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
        (t) => t.meta.id === id,
      );
      return JSON.stringify(task?.meta.repeat?.[key] ?? null) === JSON.stringify(expected);
    },
    { id, key, expected },
  );
}
async function menu(label) {
  await action(button('Repeating rule'));
  await action(page.locator('.menu').getByText(label, { exact: true }));
}
try {
  // Persistence rules are shared. Cover each editor mode once, with both pointer
  // types; the control matrix separately covers every mode on desktop and mobile.
  for (const { mobile, mode } of [
    { mobile: false, mode: 'live' },
    { mobile: true, mode: 'source' },
    { mobile: true, mode: 'reading' },
  ]) {
    await t.screen({ width: mobile ? 390 : 1100, height: mobile ? 844 : 850, mobile });
    console.log('Checking task states', { mobile, mode });
    const task = await t.create({
      title: `${t.prefix} ${mobile} ${mode}`,
      checklist: [{ text: 'Original step', done: false }],
    });
    const id = task.meta.id;
    await t.open(task, mode);
    await action(button('Repeat'));
    const modal = page.locator('.ot-repeat-modal');
    await modal.getByLabel('Repeat interval', { exact: true }).fill('0');
    await action(modal.getByRole('button', { name: 'OK', exact: true }));
    await modal.getByRole('alert').waitFor();
    await modal.getByLabel('Repeat interval', { exact: true }).fill('1');
    await modal.getByLabel('Repeat unit', { exact: true }).selectOption('day');
    await action(modal.getByLabel('Next repeat date', { exact: true }));
    if (!(await modal.getByRole('textbox', { name: 'Date', exact: true }).isVisible()))
      await action(modal.getByLabel('Search dates', { exact: true }));
    await modal.getByRole('textbox', { name: 'Date', exact: true }).fill('2099-01-15');
    await modal.getByRole('textbox', { name: 'Date', exact: true }).press('Enter');
    await modal.getByLabel('Repeat ends', { exact: true }).selectOption('date');
    await action(modal.getByLabel('Repeat end date', { exact: true }));
    if (!(await modal.getByRole('textbox', { name: 'Date', exact: true }).isVisible()))
      await action(modal.getByLabel('Search dates', { exact: true }));
    await modal.getByRole('textbox', { name: 'Date', exact: true }).fill('2099-01-15');
    await modal.getByRole('textbox', { name: 'Date', exact: true }).press('Enter');
    await action(modal.getByRole('button', { name: 'OK', exact: true }));
    await modal.waitFor({ state: 'detached' });
    await ruleState(id, 'next', '2099-01-15');
    await button('Repeating rule').waitFor();
    assert.equal(
      await controls().getByLabel('Checklist item 1', { exact: true }).isDisabled(),
      true,
    );
    assert.equal(await button('Deadline').count(), 0);
    await menu('Pause');
    await ruleState(id, 'paused', true);
    await menu('Resume');
    await ruleState(id, 'paused', false);
    await menu('Edit Rule…');
    await modal.waitFor();
    await action(modal.getByRole('button', { name: 'Cancel', exact: true }));
    const complete = t.active.locator('.ot-task-note-heading.is-inline [role=checkbox]');
    await action(complete);
    await ruleState(id, 'next', null);
    await waitForAsync(
      page,
      () =>
        document
          .querySelector(
            '.workspace-leaf.mod-active .ot-task-note-heading.is-inline [role=checkbox]',
          )
          ?.getAttribute('aria-disabled') === 'true',
    );
    const copies = await page.evaluate(
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
          (t) => t.meta.repeatSource === id,
        ),
      id,
    );
    assert.equal(copies.length, 1);
    assert.equal(copies[0].meta.status, 'done');
    await complete.press('Space');
    assert.equal((await t.record(id)).meta.status, 'todo');
    await menu('Stop');
    await saved(id, 'repeat', null);
    await button('Deadline').waitFor();
    assert.equal(
      await controls().getByLabel('Checklist item 1', { exact: true }).isDisabled(),
      false,
    );

    // A failed write must retain the controls and allow retry through ordinary editing.
    await page.evaluate(() => {
      const p = app.plugins.getPlugin('thingsmd');
      window.noteStatePatch = p.patchTask;
      let fail = true;
      p.patchTask = async (...args) => {
        if (fail) {
          fail = false;
          throw Error('Injected task-note save failure');
        }
        return window.noteStatePatch.apply(p, args);
      };
    });
    await controls().getByLabel('Checklist text 1', { exact: true }).fill('Retry draft');
    await controls().getByRole('alert').waitFor();
    assert.equal((await t.record(id)).meta.checklist[0].text, 'Original step');
    await controls().getByLabel('Checklist text 1', { exact: true }).fill('Retry succeeded');
    await saved(id, 'checklist', [{ text: 'Retry succeeded', done: false }]);
    await controls().getByRole('alert').waitFor({ state: 'detached' });
    await page.evaluate(() => {
      app.plugins.getPlugin('thingsmd').patchTask = window.noteStatePatch;
      delete window.noteStatePatch;
    });
    assert.equal((await t.record(id)).body, task.body);

    // Context menus must target the open task throughout archive transitions.
    if (mobile) {
      await action(controls().getByLabel('Checklist text 1', { exact: true }), 600);
      assert.equal(
        await page.locator('.menu').count(),
        0,
        'Holding editable text must not open task actions',
      );
    }
    await t.contextMenu(controls().locator('.ot-task'));
    await action(page.locator('.menu').getByText('Move to Trash', { exact: true }));
    await saved(id, 'deleted', true);
    await t.contextMenu(controls().locator('.ot-task'));
    await action(page.locator('.menu').getByText('Restore', { exact: true }));
    await saved(id, 'deleted', null);
    await action(complete);
    await saved(id, 'status', 'done');
    await t.contextMenu(controls().locator('.ot-task'));
    await action(page.locator('.menu').getByText('Move to Logbook', { exact: true }));
    await waitForAsync(
      page,
      async (id) =>
        !!(await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)
          ?.meta.loggedAt,
      id,
    );
    await complete.press('Enter');
    await saved(id, 'status', 'todo');
    await saved(id, 'loggedAt', null);
    assert.equal((await t.record(id)).body, task.body);
    console.log('PASS task states:', { mobile, mode });
  }
} catch (error) {
  console.error(error);
  console.log(await page.evaluate(() => ({ touch: window.noteTouch })));
  await page.screenshot({ path: 'artifacts/task-note-states-failure.png' });
  throw error;
} finally {
  await page.evaluate(() => {
    if (window.noteStatePatch) {
      app.plugins.getPlugin('thingsmd').patchTask = window.noteStatePatch;
      delete window.noteStatePatch;
    }
  });
  await t.cleanup();
}
