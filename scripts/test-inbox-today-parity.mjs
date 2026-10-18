import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
// Freshly observed in the reference app (version 3.24.1) on 2026-10-17; action order is significant.
const cases = [
  {
    label: 'new Inbox',
    action: {},
    lists: ['inbox'],
  },
  {
    label: 'future deadline',
    action: {
      deadline: 2,
    },
    lists: ['inbox'],
  },
  {
    label: 'deadline today',
    action: {
      deadline: 0,
    },
    lists: ['today', 'anytime'],
  },
  {
    label: 'extend deadline while Today',
    action: {
      deadline: 3,
    },
    lists: ['today', 'anytime'],
  },
  {
    label: 'move back to Inbox',
    action: {
      list: 'inbox',
    },
    lists: ['inbox'],
  },
  {
    label: 'overdue deadline',
    action: {
      deadline: -2,
    },
    lists: ['today', 'anytime'],
  },
  {
    label: 'explicit Inbox with overdue deadline',
    action: {
      list: 'inbox',
    },
    lists: ['inbox'],
  },
  {
    label: 'edit notes in Inbox',
    action: {
      notes: 'Temporary notes',
    },
    lists: ['inbox'],
  },
  {
    label: 'assign identical overdue deadline',
    action: {
      deadline: -2,
    },
    lists: ['inbox'],
  },
  {
    label: 'schedule future despite overdue deadline',
    action: {
      when: 2,
    },
    lists: ['upcoming'],
  },
  {
    label: 'change overdue deadline while future scheduled',
    action: {
      deadline: -1,
    },
    lists: ['upcoming'],
  },
  {
    label: 'explicit Today',
    action: {
      list: 'today',
    },
    lists: ['today', 'anytime'],
  },
  {
    label: 'explicit Anytime with overdue deadline',
    action: {
      list: 'anytime',
    },
    lists: ['anytime'],
  },
  {
    label: 'assign identical deadline after clearing Today',
    action: {
      deadline: -1,
    },
    lists: ['anytime'],
  },
  {
    label: 'change to future deadline',
    action: {
      deadline: 3,
    },
    lists: ['upcoming', 'anytime'],
  },
  {
    label: 'explicit Today with future deadline',
    action: {
      list: 'today',
    },
    lists: ['today', 'anytime'],
  },
  {
    label: 'explicit Someday',
    action: {
      list: 'someday',
    },
    lists: ['upcoming', 'someday'],
  },
  {
    label: 'make deadline due from Someday',
    action: {
      deadline: 0,
    },
    lists: ['today', 'anytime'],
  },
  {
    label: 'reschedule Today to tomorrow',
    action: {
      when: 1,
    },
    lists: ['upcoming'],
  },
  {
    label: 'reschedule back to today',
    action: {
      when: 0,
    },
    lists: ['today', 'anytime'],
  },
  {
    label: 'explicit Inbox with due-today deadline',
    action: {
      list: 'inbox',
    },
    lists: ['inbox'],
  },
];
const { browser, page } = await connectTestVault();
const prefix = `Inbox Today replay ${Date.now()}`;
let task, settings;
try {
  ({ task, settings } = await page.evaluate(async (title) => {
    const p = app.plugins.getPlugin('thingsmd');
    const settings = { ...p.settings };
    await p.updateSettings({ captureDestination: 'inbox', logbook: 'daily' });
    return { settings, task: await p.createTask({ title }) };
  }, prefix));
  for (const { label, action, lists } of cases) {
    await page.evaluate(
      async ({ id, action }) => {
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.id === id);
        const date = (offset) => {
          const d = new Date();
          d.setDate(d.getDate() + offset);
          return [
            d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0'),
          ].join('-');
        };
        if ('list' in action) await p.transferTask({ id, list: action.list });
        else if ('deadline' in action) await p.patchTask(task, { deadline: date(action.deadline) });
        else if ('when' in action) await p.patchTask(task, { when: date(action.when) });
        else if ('notes' in action) await p.patchTask(task, {}, action.notes);
      },
      { id: task.meta.id, action },
    );
    const actual = [];
    for (const list of ['inbox', 'today', 'upcoming', 'anytime', 'someday']) {
      await page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
      const count = await page
        .locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${task.meta.id}"]`)
        .evaluateAll((rows) => rows.filter((row) => !row.closest('.ot-inbox-moved')).length);
      assert.ok(count <= 1, `${label}: no duplicate in ${list}`);
      if (count) actual.push(list);
    }
    assert.deepEqual(actual, lists, label);
    console.log(`PASS ${label}: ${actual.join(', ')}`);
  }
  // A reload must not undo an explicit return to Inbox with a due deadline.
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('thingsmd');
    await app.plugins.enablePlugin('thingsmd');
    await app.plugins.getPlugin('thingsmd').openList('inbox');
  });
  assert.equal(
    await page
      .locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${task.meta.id}"]`)
      .count(),
    1,
  );
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  assert.equal(
    await page
      .locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${task.meta.id}"]`)
      .count(),
    0,
  );
  console.log(
    'PASS: all 21 ThingsMD transitions match real Obsidian; explicit Inbox return survives reload.',
  );
} finally {
  try {
    await page.evaluate(
      async ({ id, settings }) => {
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.id === id);
        if (task) await p.deleteTask(task.file);
        if (settings) await p.updateSettings(settings);
        await p.openList('inbox');
      },
      { id: task?.meta.id, settings },
    );
  } finally {
    await browser.close();
  }
}
