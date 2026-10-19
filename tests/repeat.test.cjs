const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextDate, addInterval, availableDate, validate } = require('../plugin/repeat-model.cjs');
const install = require('../plugin/repeat-engine.cjs');
const rule = (changes) => ({
  mode: 'regular',
  unit: 'day',
  interval: 1,
  anchor: '2026-10-01',
  next: '2026-10-01',
  on: [],
  end: null,
  deadline: false,
  leadDays: 0,
  epoch: 'test',
  ...changes,
});
function fixture(meta = {}, body = 'Template notes') {
  const store = new Map(),
    notes = new Map();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const plugin = {
    register: (fn) => {
      plugin.unload = fn;
    },
    app: {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        getMarkdownFiles: () => [...notes.keys()].map((path) => ({ path })),
        read: async (file) => notes.get(file.path),
        process: async (file, fn) => {
          notes.set(file.path, fn(notes.get(file.path)));
        },
      },
    },
    taskRecords: async () => [...store.values()].map(clone),
    update: async (file, fn) => {
      const old = store.get(file.path);
      store.set(file.path, { file: old.file, ...fn(clone(old)) });
    },
    createTask: async (fields, id, body = '') => {
      const path = '.thingsmd-storage/' + id + '.md';
      if (store.has(path)) throw new Error('Task already exists');
      const task = { file: { path }, meta: { id, type: 'thingsmd-task', ...fields }, body };
      store.set(path, clone(task));
      return task;
    },
  };
  store.set('.thingsmd-storage/template.md', {
    file: { path: '.thingsmd-storage/template.md' },
    meta: {
      id: 'template',
      title: 'Routine',
      status: 'todo',
      checklist: [{ text: 'Step', done: true }],
      repeat: rule(meta),
    },
    body,
  });
  notes.set('Project.md', 'Before\n![[.thingsmd-storage/template]]\nAfter\n');
  const api = install(plugin);
  return {
    api,
    plugin,
    store,
    notes,
    get: () => store.get('.thingsmd-storage/template.md'),
    copies: () => [...store.values()].filter((t) => t.meta.repeatSource),
  };
}
test('weekly selected days preserve interval and Monday-based week boundaries', () => {
  const r = rule({
    unit: 'week',
    interval: 2,
    on: [{ weekday: 1 }, { weekday: 5 }],
    anchor: '2026-10-05',
  });
  assert.equal(nextDate(r, '2026-10-05', true), '2026-10-05');
  assert.equal(nextDate(r, '2026-10-05'), '2026-10-09');
  assert.equal(nextDate(r, '2026-10-09'), '2026-10-19');
});
test('month end, leap years, selected months, ordinal weekdays, and inclusive end date', () => {
  const monthly = rule({ unit: 'month', anchor: '2026-01-31', on: [{ day: 31 }] });
  assert.equal(nextDate(monthly, '2026-01-31'), '2026-02-28');
  assert.equal(nextDate(monthly, '2026-02-28'), '2026-03-31');
  assert.equal(
    nextDate(
      rule({ unit: 'year', anchor: '2027-02-28', on: [{ month: 2, day: 29 }] }),
      '2027-02-28',
    ),
    '2028-02-29',
  );
  assert.equal(
    nextDate(rule({ unit: 'month', on: [{ ordinal: 3, weekday: 2 }] }), '2026-10-01', true),
    '2026-10-20',
  );
  assert.equal(
    nextDate(rule({ unit: 'month', on: [{ ordinal: -1, weekday: 5 }] }), '2026-10-01', true),
    '2026-10-30',
  );
  assert.equal(nextDate(rule({ end: '2026-10-02' }), '2026-10-01'), '2026-10-02');
  assert.equal(nextDate(rule({ end: '2026-10-02' }), '2026-10-02'), null);
  assert.equal(addInterval('2028-02-29', 1, 'year'), '2029-02-28');
  assert.equal(
    availableDate(rule({ next: '2026-11-15', deadline: true, leadDays: 5 })),
    '2026-11-10',
  );
  assert.throws(() => validate(rule({ interval: 0 })), /interval/);
});
test('fixed repeats catch up without completion, preserve template, and survive restarts without duplicates', async () => {
  const f = fixture();
  await f.api.tick(new Date('2026-10-03T12:00:00'));
  assert.equal(f.copies().length, 3);
  assert.equal(f.get().meta.repeat.next, '2026-10-04');
  assert.equal(f.copies()[0].body, 'Template notes');
  assert.equal(f.copies()[0].meta.checklist[0].done, false);
  assert.equal(f.get().meta.checklist[0].done, true);
  await install(f.plugin).tick(new Date('2026-10-03T12:00:00'));
  assert.equal(f.copies().length, 3);
  assert.equal((f.notes.get('Project.md').match(/!\[\[/g) || []).length, 4);
  assert.match(f.notes.get('Project.md'), /^Before\n/);
  assert.match(f.notes.get('Project.md'), /After\n$/);
});
test('completion interval starts at actual completion and never creates a second pending copy', async () => {
  const f = fixture({ mode: 'completion', unit: 'week' });
  await f.api.tick(new Date('2026-10-01T12:00:00'));
  await f.api.tick(new Date('2026-10-10T12:00:00'));
  assert.equal(f.copies().length, 1);
  const copy = f.copies()[0];
  copy.meta.status = 'done';
  copy.meta.completed = '2026-10-10T12:00:00';
  await f.api.tick(new Date('2026-10-10T12:00:00'));
  assert.equal(f.get().meta.repeat.next, '2026-10-17');
  await f.api.tick(new Date('2026-10-17T12:00:00'));
  assert.equal(f.copies().length, 2);
});
test('automatic copies generated at different times have identical contents and planned creation stamps', async () => {
  for (const mode of ['regular', 'completion']) {
    const first = fixture({
      mode,
      deadline: true,
      leadDays: 2,
      next: '2026-10-20',
      anchor: '2026-10-20',
      end: '2026-10-20',
    });
    const second = fixture({
      mode,
      deadline: true,
      leadDays: 2,
      next: '2026-10-20',
      anchor: '2026-10-20',
      end: '2026-10-20',
    });
    for (const f of [first, second]) f.plugin.settings = { timeZone: 'Europe/Berlin' };
    await first.api.tick(new Date('2026-10-17T21:59:59Z'));
    assert.equal(first.copies().length, 0);
    await first.api.tick(new Date('2026-10-17T22:00:45Z'));
    await second.api.tick(new Date('2026-10-19T12:00:00Z'));
    assert.deepEqual(first.copies(), second.copies());
    assert.equal(first.copies()[0].meta.created, '2026-10-17T22:00:00.000Z');
    assert.equal(first.copies()[0].meta.when, '2026-10-18');
    assert.deepEqual(first.get(), second.get());
    assert.equal(first.notes.get('Project.md'), second.notes.get('Project.md'));
  }
});
test('completion-based recurrence uses the vault completion day around midnight', async () => {
  const f = fixture({ mode: 'completion', next: '2026-10-20', anchor: '2026-10-20' });
  f.plugin.settings = { timeZone: 'Europe/Berlin' };
  await f.api.tick(new Date('2026-10-19T22:00:00Z'));
  assert.equal(f.copies().length, 1);
  const copy = f.copies()[0];
  copy.meta.status = 'done';
  copy.meta.completed = '2026-10-20T22:30:00Z';
  await f.api.tick(new Date('2026-10-20T22:30:00Z'));
  assert.equal(f.get().meta.repeat.next, '2026-10-22');
});
test('interruption after creating a copy retries placement and cursor advancement idempotently', async () => {
  const f = fixture({ end: '2026-10-01' });
  const original = f.plugin.update;
  let fail = true;
  f.plugin.update = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('Interrupted');
    }
    return original(...args);
  };
  await assert.rejects(f.api.tick(new Date('2026-10-01T12:00:00')), /Interrupted/);
  await f.api.tick(new Date('2026-10-01T12:00:00'));
  assert.equal(f.copies().length, 1);
  assert.equal(f.get().meta.repeat.next, null);
  assert.equal((f.notes.get('Project.md').match(/repeat-template/g) || []).length, 1);
});

test('repeat placement waits for an existing host save and durably preserves the latest editor text', async () => {
  const f = fixture({ end: '2026-10-01' });
  let text = f.notes.get('Project.md'),
    saves = 0;
  const view = {
    file: { path: 'Project.md' },
    saving: true,
    getMode: () => 'source',
    editor: {
      getValue: () => text,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: (next, from, to) => {
        text = text.slice(0, from.ch) + next + text.slice(to.ch);
      },
    },
    save: async () => {
      saves++;
      // Obsidian returns early while saving, scheduling another save later.
      if (!view.saving) f.notes.set('Project.md', text);
    },
  };
  f.plugin.app.workspace.getLeavesOfType = () => [{ view }];
  const generating = f.api.tick(new Date('2026-10-01T12:00:00'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saves, 0, 'Do not compete with the host save');
  text += 'Latest unsaved prose\n';
  view.saving = false;
  await generating;
  assert.equal(saves, 1);
  assert.match(f.notes.get('Project.md'), /Latest unsaved prose/);
  assert.match(f.notes.get('Project.md'), /repeat-template-test-2026-10-01/);
  assert.equal(f.get().meta.repeat.next, null);
});

test('a note changed during repeat placement is retained and placement retries without duplicate copies', async () => {
  const f = fixture({ end: '2026-10-01' });
  const process = f.plugin.app.vault.process;
  f.plugin.app.vault.process = async (file, fn) => {
    f.notes.set(file.path, f.notes.get(file.path) + 'External edit\n');
    return process(file, fn);
  };
  await assert.rejects(f.api.tick(new Date('2026-10-01T12:00:00')), /note changed/);
  assert.match(f.notes.get('Project.md'), /External edit/);
  assert.equal(f.copies().length, 1);
  assert.equal(f.get().meta.repeat.next, '2026-10-01');
  f.plugin.app.vault.process = process;
  await f.api.tick(new Date('2026-10-01T12:00:00'));
  assert.equal(f.copies().length, 1);
  assert.equal(
    (f.notes.get('Project.md').match(/repeat-template-test-2026-10-01/g) || []).length,
    1,
  );
  assert.match(f.notes.get('Project.md'), /External edit/);
});
test('paused, deleted and ended rules do not generate; deadlines and early completion remain independent', async () => {
  const f = fixture({
    next: '2099-01-15',
    anchor: '2099-01-15',
    unit: 'month',
    on: [{ day: 15 }],
    deadline: true,
    leadDays: 5,
    paused: true,
  });
  await f.api.tick(new Date('2099-01-20T12:00:00'));
  assert.equal(f.copies().length, 0);
  f.get().meta.repeat.paused = false;
  const copy = await f.api.createNext('template', true);
  assert.equal(copy.meta.status, 'done');
  assert.equal(copy.meta.deadline, '2099-01-15');
  assert.equal(copy.meta.when, '2099-01-10');
  assert.equal(f.get().meta.repeat.next, '2099-02-15');
  f.get().meta.deleted = true;
  await f.api.tick(new Date('2099-03-01T12:00:00'));
  assert.equal(f.copies().length, 1);
});
test('one-off rescheduling keeps the fixed rule; rule updates move future dates; stopping retains copies', async () => {
  const f = fixture({ unit: 'month', anchor: '2099-01-15', next: '2099-01-15', on: [{ day: 15 }] });
  await f.api.reschedule('template', '2099-01-20', false);
  assert.equal(f.copies()[0].meta.when, '2099-01-20');
  assert.equal(f.get().meta.repeat.next, '2099-02-15');
  await f.api.reschedule('template', '2099-02-22', true);
  assert.equal(f.get().meta.repeat.next, '2099-02-22');
  assert.deepEqual(f.get().meta.repeat.on, [{ day: 22 }]);
  await f.api.stop('template');
  assert.equal(f.get().meta.repeat, null);
  assert.equal(f.get().meta.when, '2099-02-22');
  assert.equal(f.copies().length, 1);
});
test('reopening a completion-based copy cancels its unmaterialized successor', async () => {
  const f = fixture({ mode: 'completion', unit: 'week' });
  await f.api.tick(new Date('2026-10-01T12:00:00'));
  const copy = f.copies()[0];
  copy.meta.status = 'done';
  copy.meta.completed = '2026-10-01T12:00:00';
  await f.api.tick(new Date('2026-10-01T12:00:00'));
  assert.equal(f.get().meta.repeat.next, '2026-10-08');
  copy.meta.status = 'todo';
  copy.meta.completed = null;
  await f.api.tick(new Date('2026-10-02T12:00:00'));
  assert.equal(f.get().meta.repeat.next, null);
  assert.equal(f.get().meta.repeat.waitingFor, copy.meta.id);
  assert.equal(f.copies().length, 1);
});
test('changing a completion rule preserves the outstanding copy instead of generating another', async () => {
  const f = fixture({ mode: 'completion', unit: 'week' });
  await f.api.tick(new Date('2026-10-01T12:00:00'));
  const before = f.get(),
    config = { ...before.meta.repeat, interval: 2, anchor: '2099-01-01' };
  await f.api.configure(before, config);
  assert.equal(f.copies().length, 1);
  assert.equal(f.get().meta.repeat.waitingFor, f.copies()[0].meta.id);
  assert.equal(f.get().meta.repeat.next, null);
});

test('unloading the plugin stops queued scheduler work', async () => {
  const f = fixture();
  f.plugin.unload();
  await f.api.tick(new Date('2026-10-10T12:00:00'));
  assert.equal(f.copies().length, 0);
});

test('repeat templates and generated copies obey single-placement list rules across availability and deadline days', async () => {
  const { inList, upcomingDates } = require('../plugin/model.cjs');
  for (const mode of ['regular', 'completion']) {
    const f = fixture({
      mode,
      unit: 'week',
      interval: 1,
      on: [{ weekday: 2 }],
      anchor: '2026-10-20',
      next: '2026-10-20',
      deadline: true,
      leadDays: 2,
    });
    f.get().meta.when = '2026-10-18';
    assert.equal(inList(f.get(), 'upcoming', '2026-10-17'), true);
    assert.deepEqual(upcomingDates(f.get().meta, '2026-10-17'), ['2026-10-18']);
    await f.api.tick(new Date('2026-10-18T12:00:00'));
    const copy = f.copies()[0];
    assert.equal(copy.meta.deadline, '2026-10-20');
    assert.equal(copy.meta.when, '2026-10-18');
    for (const day of ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']) {
      assert.equal(inList(copy, 'today', day), true);
      assert.equal(inList(copy, 'anytime', day), true);
      assert.equal(inList(copy, 'upcoming', day), false);
      assert.deepEqual(upcomingDates(copy.meta, day), []);
    }
    assert.equal(inList(f.get(), 'today', '2026-10-18'), false);
    assert.equal(inList(f.get(), 'upcoming', '2026-10-18'), mode === 'regular');
    copy.meta.status = 'done';
    copy.meta.completed = '2026-10-18T12:00:00';
    await f.api.tick(new Date('2026-10-18T12:00:00'));
    assert.equal(f.get().meta.repeat.next, mode === 'regular' ? '2026-10-27' : '2026-10-25');
    assert.equal(inList(copy, 'logbook', '2026-10-19'), true);
    assert.equal(inList(copy, 'today', '2026-10-19'), false);
    await f.api.pause('template', true);
    assert.equal(inList(f.get(), 'upcoming', '2026-10-18'), false);
  }
});

test('completion-based repeats honor the end date, including the last allowed occurrence', () => {
  const config = rule({ mode: 'completion', end: '2026-10-05' });
  assert.equal(nextDate(config, '2026-10-04'), '2026-10-05');
  assert.equal(nextDate(config, '2026-10-05'), null);
});

test('canceling the next occurrence preserves the template and rejects duplicate generation', async () => {
  const f = fixture({ anchor: '2099-01-01', next: '2099-01-01' });
  try {
    const copy = await f.api.createNext('template', true, '2099-01-01', 'canceled');
    assert.equal(copy.meta.status, 'canceled');
    assert.ok(copy.meta.completed);
    assert.equal(f.get().meta.status, 'todo');
    assert.equal(f.get().meta.repeat.next, '2099-01-02');
    await assert.rejects(
      f.api.createNext('template', true, '2099-01-01', 'canceled'),
      /already advanced/,
    );
    assert.equal(f.copies().length, 1);
  } finally {
    f.plugin.unload();
  }
});

test('completion-based repetition advances from cancellation and waits again on reopen', async () => {
  const f = fixture({ mode: 'completion', anchor: '2099-01-01', next: '2099-01-01' });
  try {
    const copy = await f.api.createNext('template', false, '2099-01-01');
    await f.plugin.update(copy.file, (current) => ({
      ...current,
      meta: { ...current.meta, status: 'canceled', completed: '2099-01-01T12:00:00Z' },
    }));
    await f.api.tick(new Date(2098, 11, 31));
    assert.equal(f.get().meta.repeat.next, '2099-01-02');
    await f.plugin.update(copy.file, (current) => ({
      ...current,
      meta: { ...current.meta, status: 'todo', completed: null },
    }));
    await f.api.tick(new Date(2098, 11, 31));
    assert.equal(f.get().meta.repeat.next, null);
    assert.equal(f.get().meta.repeat.waitingFor, copy.meta.id);
  } finally {
    f.plugin.unload();
  }
});
