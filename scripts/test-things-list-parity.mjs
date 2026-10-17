import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

await mkdir('artifacts/things-parity', { recursive: true });
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = `Things parity ${Date.now()}`;
const active = page.locator('.workspace-leaf.mod-active');
let settings;
try {
  const fixtures = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const settings = { ...p.settings };
    await p.updateSettings({ captureDestination: 'inbox', logbook: 'daily' });
    const date = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      ].join('-');
    };
    const cases = [
      ['Inbox', {}, ['inbox']],
      ['Inbox future deadline', { deadline: date(4) }, ['inbox']],
      ['Inbox due', { deadline: date(0) }, ['today', 'anytime']],
      ['Inbox overdue', { deadline: date(-2) }, ['today', 'anytime']],
      ['Anytime', { when: 'anytime' }, ['anytime']],
      ['Anytime deadline', { when: 'anytime', deadline: date(4) }, ['anytime', 'upcoming']],
      ['Explicit Anytime due', { when: 'anytime', deadline: date(0) }, ['anytime']],
      ['Someday deadline', { when: 'someday', deadline: date(4) }, ['someday', 'upcoming']],
      ['Explicit Someday due', { when: 'someday', deadline: date(0) }, ['someday']],
      ['Explicit Someday overdue', { when: 'someday', deadline: date(-2) }, ['someday']],
      ['Scheduled', { when: date(2) }, ['upcoming']],
      ['Scheduled later deadline', { when: date(2), deadline: date(4) }, ['upcoming']],
      ['Scheduled earlier deadline', { when: date(4), deadline: date(2) }, ['upcoming']],
      ['Scheduled same deadline', { when: date(2), deadline: date(2) }, ['upcoming']],
      ['Scheduled overdue deadline', { when: date(2), deadline: date(-2) }, ['upcoming']],
      ['Today later deadline', { when: 'today', deadline: date(4) }, ['today', 'anytime']],
      ['Past start', { when: date(-2), deadline: date(4) }, ['today', 'anytime']],
      ['Evening', { when: 'evening', deadline: date(4) }, ['today', 'anytime']],
      ['Waiting', { when: date(2), deadline: date(4), is_waiting: true }, ['waiting', 'upcoming']],
      [
        'Logged',
        { when: 'today', status: 'done', loggedAt: new Date().toISOString() },
        ['logbook'],
      ],
      ['Trashed', { when: 'today', deleted: true, deletedAt: new Date().toISOString() }, ['trash']],
    ];
    const tasks = [];
    for (const [name, fields, lists] of cases) {
      const task = await p.createTask(
        { title: `${prefix} ${name}`, ...fields },
        undefined,
        'Parity fixture notes',
      );
      tasks.push({ name, fields, lists, id: task.meta.id });
    }
    return { tasks, settings, dates: [date(-2), date(0), date(2), date(4)] };
  }, prefix);
  settings = fixtures.settings;
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => app.workspace.leftSplit.collapse());
    for (const list of [
      'inbox',
      'today',
      'upcoming',
      'anytime',
      'someday',
      'waiting',
      'logbook',
      'trash',
    ]) {
      await page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
      for (const task of fixtures.tasks) {
        const rows = active.locator(`.ot-task[data-task-id="${task.id}"]`);
        assert.equal(
          await rows.count(),
          task.lists.includes(list) ? 1 : 0,
          `${width}px ${list}: ${task.name}`,
        );
        if (list !== 'upcoming' || !task.lists.includes(list)) continue;
        const placement = task.fields.when?.match(/^\d{4}-/)
          ? task.fields.when
          : task.fields.deadline;
        assert.equal(await rows.getAttribute('data-occurrence'), placement);
        assert.equal(await rows.locator('.ot-row-when,.ot-occurrence-label').count(), 0);
        if (task.fields.deadline) {
          assert.equal(
            await rows.locator('.ot-row-deadline time').getAttribute('datetime'),
            task.fields.deadline,
          );
          if (task.fields.deadline === fixtures.dates[0])
            assert.equal(
              await rows.locator('.ot-row-deadline').getAttribute('class'),
              'ot-row-date ot-row-deadline is-overdue',
            );
        }
      }
      if (list === 'today')
        assert.equal(
          await active
            .locator('.ot-evening-section .ot-task')
            .filter({ hasText: `${prefix} Evening` })
            .count(),
          1,
        );
      if (list === 'upcoming')
        await page.screenshot({ path: `artifacts/things-parity/upcoming-${width}.png` });
    }
  }
  // Capture applies deadline changes immediately, before persisting the draft.
  for (const defer of [false, true]) {
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture({ when: 'anytime' }));
    const capture = page.locator('.ot-capture-modal');
    await capture.getByLabel('Task title', { exact: true }).fill(`${prefix} Captured ${defer}`);
    await capture.getByRole('button', { name: 'Deadline', exact: true }).click();
    const date = capture.getByRole('textbox', { name: 'Deadline date', exact: true });
    await date.fill(fixtures.dates[0]);
    await date.press('Enter');
    if (defer) {
      await capture.getByRole('button', { name: 'When', exact: true }).click();
      await capture.getByRole('button', { name: 'Someday', exact: true }).click();
    }
    await capture.getByRole('button', { name: 'Save', exact: true }).click();
    await capture.waitFor({ state: 'hidden' });
    const stored = await page.evaluate(
      async (title) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.title === title),
      `${prefix} Captured ${defer}`,
    );
    assert.equal(stored.meta.when, defer ? 'someday' : 'today');
    assert.equal(stored.meta.deadline, fixtures.dates[0]);
    if (defer) {
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('someday'));
      const deferred = active.locator(`.ot-task[data-task-id="${stored.meta.id}"]`);
      await deferred.dblclick();
      await deferred.getByRole('button', { name: 'Deadline', exact: true }).click();
      await deferred.getByRole('button', { name: 'Remove deadline', exact: true }).click();
      await deferred.getByLabel('Task title', { exact: true }).press('Enter');
      await deferred.locator('.ot-title-input').waitFor({ state: 'hidden' });
      const cleared = await page.evaluate(
        async (id) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
        stored.meta.id,
      );
      assert.equal(
        cleared.meta.when,
        'someday',
        'Removing a deadline respects the explicit Someday decision',
      );
      assert.equal(cleared.meta.deadline, null);
    }
  }
  // A real editor deadline change processes an Inbox task, but keeps its temporary row.
  const inbox = fixtures.tasks.find((t) => t.name === 'Inbox');
  const row = () => active.locator(`.ot-task[data-task-id="${inbox.id}"]`);
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('inbox'));
  await row().dblclick();
  await row().getByRole('button', { name: 'Deadline', exact: true }).click();
  await row().getByRole('textbox', { name: 'Deadline date', exact: true }).fill(fixtures.dates[0]);
  await row().getByRole('textbox', { name: 'Deadline date', exact: true }).press('Enter');
  await row().getByLabel('Task title', { exact: true }).press('Enter');
  await active.locator(`.ot-inbox-moved .ot-task[data-task-id="${inbox.id}"]`).waitFor();
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await row().waitFor();
  // Explicit moves retain the deadline, and return to one future placement when cleared.
  await page.evaluate(
    async ({ id, future }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.transferTask({ id, list: 'inbox' });
      let t = (await p.taskRecords()).find((t) => t.meta.id === id);
      if (!t.meta.deadline || t.meta.when != null)
        throw new Error('Inbox move erased deadline or failed to clear When');
      await p.patchTask(t, { deadline: future });
      await p.transferTask({ id, list: 'anytime' });
      await p.openList('upcoming');
    },
    { id: inbox.id, future: fixtures.dates[3] },
  );
  assert.equal(await row().count(), 1);
  assert.equal(await row().getAttribute('data-occurrence'), fixtures.dates[3]);
  // Reload must retain the same schedule and never recreate the duplicate deadline row.
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('thingsmd');
    await app.plugins.enablePlugin('thingsmd');
    await app.plugins.getPlugin('thingsmd').openList('upcoming');
  });
  assert.equal(await row().count(), 1);

  // Fixed repeats and completion-based repeats share the same list policy as ordinary tasks.
  const repeatIDs = await page.evaluate(
    async ({ prefix, dates }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const result = [];
      for (const mode of ['regular', 'completion']) {
        const t = await p.createTask({ title: `${prefix} Repeat ${mode}` });
        await p.repeating.configure(t, {
          mode,
          unit: mode === 'completion' ? 'week' : 'day',
          interval: 1,
          anchor: dates[3],
          on: [],
          end: null,
          deadline: true,
          leadDays: 2,
        });
        result.push(t.meta.id);
      }
      await p.openList('upcoming');
      return result;
    },
    { prefix, dates: fixtures.dates },
  );
  for (const id of repeatIDs) {
    const rows = active.locator(`.ot-task[data-task-id="${id}"]`);
    assert.equal(await rows.count(), 1);
    assert.equal(await rows.getAttribute('data-occurrence'), fixtures.dates[2]);
    assert.equal(
      await rows.locator('.ot-row-deadline time').getAttribute('datetime'),
      fixtures.dates[3],
    );
  }
  const copyID = await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const copy = await p.repeating.createNext(id);
    await p.openList('upcoming');
    return copy.meta.id;
  }, repeatIDs[1]);
  assert.equal(
    await active.locator(`.ot-task[data-task-id="${repeatIDs[1]}"]`).count(),
    0,
    'Completion template waits for its pending copy',
  );
  assert.equal(await active.locator(`.ot-task[data-task-id="${copyID}"]`).count(), 1);
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.repeating.pause(id, true);
    await p.openList('upcoming');
  }, repeatIDs[0]);
  assert.equal(await active.locator(`.ot-task[data-task-id="${repeatIDs[0]}"]`).count(), 0);
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = (await p.taskRecords()).find((t) => t.meta.id === id);
    await p.patchTask(task, { status: 'done' });
  }, copyID);
  await waitForAsync(
    page,
    async (id) => {
      const p = app.plugins.getPlugin('thingsmd');
      return !!(await p.taskRecords()).find((t) => t.meta.id === id)?.meta.repeat.next;
    },
    repeatIDs[1],
  );
  console.log(
    'PASS: 21 observed date/deadline scenarios across all eight lists at desktop/phone widths, Inbox deadline editor promotion and temporary section, preserved moves/reload, Waiting extension, repeat deadline placement, pause and completion-based advancement.',
  );
} finally {
  try {
    await page.evaluate(
      async ({ prefix, settings }) => {
        const p = app.plugins.getPlugin('thingsmd');
        for (const task of await p.taskRecords())
          if (task.meta.title?.startsWith(prefix)) await p.deleteTask(task.file);
        if (settings) await p.updateSettings(settings);
        await p.openList('upcoming');
      },
      { prefix, settings },
    );
  } finally {
    await browser.close();
  }
}
