const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deletionTarget } = require('../plugin/task-reference-deletion.cjs');
test('deletion catches both widget boundaries without consuming surrounding Markdown', () => {
  const text = 'Before\n![[task]]\nAfter';
  for (const [key, pos] of [
    ['Delete', 6],
    ['Delete', 7],
    ['Backspace', 15],
    ['Backspace', 16],
  ])
    assert.equal(deletionTarget(text, pos, key)?.path, 'task.md');
  for (const [key, pos] of [
    ['Delete', 0],
    ['Backspace', 7],
    ['Delete', 16],
  ])
    assert.equal(deletionTarget(text, pos, key), null);
});
test('source examples and inline links are not task deletion targets', () => {
  for (const text of ['```\n![[task]]\n```', '---\n![[task]]\n---', 'text ![[task]]'])
    for (let pos = 0; pos <= text.length; pos++)
      assert.equal(deletionTarget(text, pos, 'Delete'), null);
});
