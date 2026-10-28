const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../plugin/tasks/task-editor.cjs'),
  localRequire = createRequire(filename);
const moduleStub = { exports: {} };
const notices = [];
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module: moduleStub,
  setTimeout,
  clearTimeout,
  require: (name) =>
    name === 'obsidian'
      ? {
          Notice: class {
            constructor(message) {
              notices.push(message);
            }
          },
        }
      : name === '../shared/dom.cjs'
        ? {}
        : localRequire(name),
});
const TaskEditor = moduleStub.exports;
test('closing an editor drains edits arriving during multiple consecutive writes', async () => {
  const saved = [];
  let closed = false;
  const plugin = {
    app: {},
    patchTask: async (task, patch) => {
      saved.push(patch.title);
      if (saved.length < 4) {
        editor.taskDraft.values.title = 'Edit ' + (saved.length + 1);
        editor.taskDraft.dirty = true;
      }
      await Promise.resolve();
      return { ...task, meta: { ...task.meta, ...patch } };
    },
  };
  const editor = new TaskEditor(plugin, { querySelector: () => null }, async () => {
    closed = true;
  });
  editor.taskDraft = {
    task: { meta: { title: 'Original' }, body: '' },
    values: { title: 'Edit 1' },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.finishTask(), true);
  assert.deepEqual(saved, ['Edit 1', 'Edit 2', 'Edit 3', 'Edit 4']);
  assert.equal(editor.taskDraft, null);
  assert.equal(closed, true);
});

test('provisional tasks do not write an unchanged false waiting flag', async () => {
  let written;
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        written = patch;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: { meta: { title: '' }, body: '' },
    values: { title: 'Created in a note', is_waiting: false },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(written)), { title: 'Created in a note' });
});

test('clearing a title saves an empty title and other edits without trapping the editor', async () => {
  let written,
    closed = false;
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch, body) => {
        written = { patch, body };
        return { ...task, meta: { ...task.meta, ...patch }, body };
      },
    },
    { querySelector: () => null },
    async () => {
      closed = true;
    },
  );
  editor.taskDraft = {
    task: { meta: { title: 'Original' }, body: 'Old notes' },
    values: { title: '   ' },
    body: 'Ignored legacy draft',
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true, 'Autosave accepts a blank title');
  assert.equal(await editor.finishTask(), true);
  assert.equal(closed, true);
  assert.equal(editor.editing, false);
  assert.equal(editor.taskDraft, null);
  assert.deepEqual(JSON.parse(JSON.stringify(written)), {
    patch: { title: '' },
  });
});

test('closing a new inline task leaves its empty title unchanged', async () => {
  let title;
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        title = patch.title;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: { meta: { title: '' }, body: '' },
    values: { title: '' },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.finishTask(), true);
  assert.equal(title, undefined, 'No replacement title is written');
});

test('concurrent blur and navigation close once, cancel gestures and publish the saved task', async () => {
  let release,
    closes = 0,
    canceled = 0,
    writes = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        writes++;
        await gate;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
    async (render, task) => {
      closes++;
      assert.equal(task.meta.title, 'Saved title');
    },
  );
  editor.taskDraft = {
    task: { meta: { title: 'Original' }, body: '' },
    values: { title: 'Saved title' },
    body: '',
    dirty: true,
  };
  editor.cancelChecklistDrag = () => {
    canceled++;
  };
  const blur = editor.finishTask();
  const navigation = editor.finishTask(false);
  release();
  assert.deepEqual(await Promise.all([blur, navigation]), [true, true]);
  assert.equal(writes, 1);
  assert.equal(closes, 1);
  assert.equal(canceled, 1);
  assert.equal(editor.taskDraft, null);
});

test('a cancelled schedule is reconciled before the next autosave', async () => {
  const writes = [];
  const meta = {
    title: 'Original',
    when: 'today',
    evening: '2026-10-17',
    deadline: '2026-10-16',
    deadlineDeferredOn: null,
  };
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        writes.push(patch);
        return { ...task, meta: { ...meta, title: patch.title || meta.title } };
      },
    },
    { querySelector: () => null },
  );
  let badges = 0;
  editor.taskDraft = {
    task: { meta, body: '' },
    values: {
      ...meta,
      when: 'someday',
      evening: null,
      deadlineDeferredOn: '2026-10-17',
    },
    body: '',
    dirty: true,
    drawBadges: () => badges++,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  for (const key of ['when', 'evening', 'deadline', 'deadlineDeferredOn'])
    assert.equal(editor.taskDraft.values[key], meta[key]);
  assert.equal(badges, 1);
  editor.taskDraft.values.title = 'New title';
  editor.taskDraft.dirty = true;
  assert.equal(await editor.saveTaskDraft(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[1])), { title: 'New title' });
});

test('schedule reconciliation preserves newer dates entered during a save', async () => {
  const schedule = {
    when: '2099-01-01',
    evening: null,
    deadline: null,
    deadlineDeferredOn: null,
  };
  const newer = { ...schedule, when: '2099-02-01', evening: '2099-02-01' };
  const editor = new TaskEditor(
    {
      app: {},
      patchTask: async (task, patch) => {
        Object.assign(editor.taskDraft.values, newer);
        editor.taskDraft.dirty = true;
        return { ...task, meta: { ...task.meta, ...patch } };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: { meta: { title: 'Task', ...schedule, when: 'anytime' }, body: '' },
    values: { title: 'Task', ...schedule },
    body: '',
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  for (const [key, value] of Object.entries(newer))
    assert.equal(editor.taskDraft.values[key], value);
  assert.equal(editor.taskDraft.dirty, true);
});

test('metadata autosaves never write stale note bodies after native-tab edits', async () => {
  let current = {
    file: { path: 'ThingsMD/task.md' },
    meta: { id: 'task', title: 'Original' },
    body: 'Old body',
  };
  const bodies = [];
  const plugin = {
    app: {},
    renderTaskNotes() {},
    taskRecords: async () => [current],
    patchTask: async (task, patch, body) => {
      bodies.push(body);
      current = {
        ...current,
        meta: { ...current.meta, ...patch },
        body: body === undefined ? current.body : body,
      };
      return current;
    },
  };
  let published;
  const editor = new TaskEditor(plugin, { querySelector: () => null }, async (render, task) => {
    published = task;
  });
  editor.taskDraft = {
    task: current,
    values: { title: 'First change' },
    body: 'Old body',
    dirty: true,
  };
  current = { ...current, body: 'Written in the native editor' };
  await editor.saveTaskDraft();
  editor.taskDraft.values.title = 'Second change';
  editor.taskDraft.dirty = true;
  await editor.saveTaskDraft();
  await editor.finishTask();
  assert.deepEqual(bodies, [undefined, undefined]);
  assert.equal(current.body, 'Written in the native editor');
  assert.equal(published.body, current.body);
});

test('native task-note controls save metadata without owning a title or description draft', async () => {
  let write;
  const editor = new TaskEditor(
    {
      app: {},
      renderTaskNotes() {},
      patchTask: async (task, patch, body) => {
        write = { patch, body };
        return { ...task, meta: { ...task.meta, ...patch }, body: 'Unsaved native description' };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: {
      file: { path: 'ThingsMD/id.md' },
      meta: { title: 'Title', is_waiting: false },
      body: '',
    },
    values: { is_waiting: true },
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(write)), { patch: { is_waiting: true } });
  assert.equal(editor.taskDraft.task.body, 'Unsaved native description');
});

test('saving another field does not rebase an untouched checklist over an external change', async () => {
  const oldChecklist = [{ text: 'Original', done: false }];
  const externalChecklist = [{ text: 'External change', done: false }];
  let calls = 0;
  const editor = new TaskEditor(
    {
      app: {},
      renderTaskNotes() {},
      patchTask: async (task, patch) => {
        calls++;
        if (
          patch.checklist &&
          JSON.stringify(task.meta.checklist) !== JSON.stringify(externalChecklist)
        )
          throw Error('Changed elsewhere');
        return { ...task, meta: { ...task.meta, ...patch, checklist: externalChecklist } };
      },
    },
    { querySelector: () => null },
  );
  editor.taskDraft = {
    task: {
      file: { path: 'ThingsMD/id.md' },
      meta: { title: 'Title', is_waiting: false, checklist: oldChecklist },
    },
    values: { is_waiting: true, checklist: structuredClone(oldChecklist) },
    dirty: true,
  };
  assert.equal(await editor.saveTaskDraft(), true);
  editor.taskDraft.values.checklist[0].text = 'Local draft';
  editor.taskDraft.dirty = true;
  assert.equal(await editor.saveTaskDraft(), false);
  assert.equal(calls, 2);
  assert.equal(editor.taskDraft.values.checklist[0].text, 'Local draft');
  assert.equal(externalChecklist[0].text, 'External change');
});

test('a failed reread while closing retains the draft and permits retry without an unhandled rejection', async () => {
  let fail = true,
    closed = false;
  const task = {
    file: { path: 'ThingsMD/test.md' },
    meta: { id: 'test', title: 'Saved' },
    body: '',
  };
  const editor = new TaskEditor(
    {
      app: {},
      taskRecords: async () => {
        if (fail) throw new Error('Read failed');
        return [task];
      },
    },
    { querySelector: () => null },
    async () => {
      closed = true;
    },
  );
  const draft = (editor.taskDraft = { task, values: { title: 'Saved' }, dirty: false });
  assert.equal(await editor.finishTask(), false);
  assert.equal(editor.taskDraft, draft);
  assert.equal(closed, false);
  assert.equal(notices.at(-1), 'Read failed');
  fail = false;
  assert.equal(await editor.finishTask(), true);
  assert.equal(editor.taskDraft, null);
  assert.equal(closed, true);
});
