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
      replaceRange: (next) => {
        text = next;
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
      replaceRange: (value) => {
        text = value;
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
