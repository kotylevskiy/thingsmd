const test = require('node:test');
const assert = require('node:assert/strict');
const { noteAccess } = require('../plugin/note-access.cjs');

test('note access prefers unsaved editor text and refuses stale writes or rollbacks', async () => {
  let text = 'Unsaved text',
    saved = 0;
  const file = { path: 'Note.md' };
  const view = {
    file,
    getMode: () => 'source',
    save: async () => saved++,
    editor: {
      getValue: () => text,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: (next, from, to) => {
        text = text.slice(0, from.ch) + next + text.slice(to.ch);
      },
    },
  };
  const access = noteAccess({ workspace: { getLeavesOfType: () => [{ view }] }, vault: {} });
  assert.equal(await access.read(file), 'Unsaved text');
  await access.write(file, 'Unsaved text', 'Placed task', { save: true });
  assert.equal(saved, 1);
  text = 'Concurrent edit';
  await assert.rejects(access.write(file, 'Placed task', 'Unsaved text'), /note changed/);
  assert.equal(text, 'Concurrent edit');
});

test('closed note writes compare inside the vault transaction', async () => {
  let text = 'Original';
  const file = { path: 'Note.md' };
  const access = noteAccess({
    workspace: { getLeavesOfType: () => [] },
    vault: {
      read: async () => text,
      process: async (file, transform) => {
        text = transform(text);
      },
    },
  });
  const before = await access.read(file);
  text = 'Concurrent edit';
  await assert.rejects(access.write(file, before, 'Task moved'), /note changed/);
  assert.equal(text, 'Concurrent edit');
});

test('note access waits for a host save already in progress before reading and writing', async () => {
  let text = 'Before',
    saves = 0;
  const file = { path: 'Note.md' };
  const view = {
    file,
    saving: true,
    getMode: () => 'source',
    save: async () => {
      saves++;
    },
    editor: {
      getValue: () => text,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: (value, from, to) => {
        text = text.slice(0, from.ch) + value + text.slice(to.ch);
      },
    },
  };
  const access = noteAccess({ workspace: { getLeavesOfType: () => [{ view }] } });
  const reading = access.read(file);
  const writing = access.write(file, 'Before', 'After', { save: true });
  await Promise.resolve();
  assert.equal(text, 'Before');
  assert.equal(saves, 0);
  view.saving = false;
  assert.equal(await reading, 'Before');
  await writing;
  assert.equal(text, 'After');
  assert.equal(saves, 1);
});

test('metadata writes replace only the changed text and retain the description cursor', async () => {
  let text = '---\ntitle: Task\nis_waiting: false\n---\nDescription with unsaved text.\n';
  let cursor = text.indexOf('unsaved');
  const file = { path: 'ThingsMD/task.md' };
  const before = text;
  const next = text.replace('is_waiting: false', 'is_waiting: true');
  const edits = [];
  const view = {
    file,
    getMode: () => 'source',
    save: async () => {},
    editor: {
      getValue: () => text,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: (insert, from, to) => {
        edits.push({ insert, from: from.ch, to: to.ch });
        // Model the native editor's selection mapping through a replacement.
        cursor =
          cursor >= to.ch ? cursor + insert.length - (to.ch - from.ch) : from.ch + insert.length;
        text = text.slice(0, from.ch) + insert + text.slice(to.ch);
      },
    },
  };
  const access = noteAccess({ workspace: { getLeavesOfType: () => [{ view }] } });
  await access.write(file, before, next, { save: true });
  assert.equal(text, next);
  assert.equal(cursor, text.indexOf('unsaved'));
  assert.ok(edits[0].to < before.indexOf('Description'));
  assert.ok(
    edits[0].insert.length < 5,
    'A boolean metadata change does not replace the description',
  );
});

test('checked native writes use the registered background writer and unregister cleanly', async () => {
  const { registerEditorWriter } = require('../plugin/note-access.cjs');
  let text = 'Old text',
    nativeCalls = 0,
    fallbackCalls = 0;
  const file = { path: 'Note.md' };
  const editor = {
    getValue: () => text,
    offsetToPos: (ch) => ({ line: 0, ch }),
    replaceRange: (insert, from, to) => {
      fallbackCalls++;
      text = text.slice(0, from.ch) + insert + text.slice(to.ch);
    },
  };
  const view = { file, editor, getMode: () => 'source' };
  const access = noteAccess({ workspace: { getLeavesOfType: () => [{ view }] } });
  const unregister = registerEditorWriter(editor, ({ from, to, insert }) => {
    nativeCalls++;
    text = text.slice(0, from) + insert + text.slice(to);
  });
  await access.write(file, 'Old text', 'New text');
  assert.equal(text, 'New text');
  assert.equal(nativeCalls, 1);
  assert.equal(fallbackCalls, 0);
  await assert.rejects(access.write(file, 'Stale text', 'Overwrite'), /note changed/);
  assert.equal(nativeCalls, 1, 'Compare snapshots before dispatching any native write');
  unregister();
  await access.write(file, 'New text', 'Final text');
  assert.equal(text, 'Final text');
  assert.equal(fallbackCalls, 1);
});

test('an editor input filter cannot silently turn a rejected write into a successful save', async () => {
  const text = 'Original',
    file = { path: 'Note.md' };
  let saves = 0;
  const view = {
    file,
    getMode: () => 'source',
    save: async () => saves++,
    editor: {
      getValue: () => text,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: () => {},
    },
  };
  const access = noteAccess({ workspace: { getLeavesOfType: () => [{ view }] } });
  await assert.rejects(
    access.write(file, text, 'Changed', { save: true }),
    /editor did not accept/,
  );
  assert.equal(saves, 0);
});

test('divergent native tabs are never picked arbitrarily for a task write', async () => {
  const file = { path: 'Task.md' };
  const buffers = ['First unsaved draft', 'Second unsaved draft'];
  const leaves = buffers.map((text) => ({
    view: { file, getMode: () => 'source', editor: { getValue: () => text } },
  }));
  const access = noteAccess({ workspace: { getLeavesOfType: () => leaves }, vault: {} });
  await assert.rejects(access.read(file), /different drafts/);
  await assert.rejects(access.write(file, buffers[0], 'Changed'), /different drafts/);
  assert.deepEqual(
    leaves.map(({ view }) => view.editor.getValue()),
    buffers,
  );
});
