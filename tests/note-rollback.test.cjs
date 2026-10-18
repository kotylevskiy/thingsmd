const test = require('node:test');
const assert = require('node:assert/strict');
const { rollbackNotes, recoveryError } = require('../plugin/note-rollback.cjs');

test('rollback restores unchanged edits in reverse order and reports every conflict', async () => {
  const edits = ['A', 'B', 'C'].map((path) => ({ file: { path }, before: 'old', after: 'ours' }));
  const disk = new Map([
    ['A', 'ours'],
    ['B', 'external'],
    ['C', 'ours'],
  ]);
  const order = [];
  const failures = await rollbackNotes(edits, async (file, expected, next) => {
    order.push(file.path);
    if (disk.get(file.path) !== expected) throw Error('Changed elsewhere');
    disk.set(file.path, next);
  });
  assert.deepEqual(order, ['C', 'B', 'A']);
  assert.deepEqual([...disk.values()], ['old', 'external', 'old']);
  assert.deepEqual(failures, ['B: Changed elsewhere']);
  assert.match(
    recoveryError(Error('Move failed.'), failures).message,
    /Move failed.*Recovery needed.*B:/,
  );
  assert.equal(edits[0].file.path, 'A');
});
