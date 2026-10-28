const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lineMove } = require('../plugin/tasks/task-drag.cjs');
function apply(text, from, to, target) {
  const move = lineMove(text, from, to, target);
  if (!move) return text;
  for (const c of [...move.changes].reverse())
    text = text.slice(0, c.from) + (c.insert || '') + text.slice(c.to ?? c.from);
  return text;
}
test('task line moves preserve prose and line endings in both directions', () => {
  assert.equal(apply('Intro\nA\nNotes\nB\nEnd', 6, 7, 16), 'Intro\nNotes\nB\nA\nEnd');
  assert.equal(apply('Intro\nA\nNotes\nB\nEnd', 14, 15, 6), 'Intro\nB\nA\nNotes\nEnd');
  assert.equal(apply('A\nB', 2, 3, 0), 'B\nA');
  assert.equal(apply('A\nB', 0, 1, 3), 'B\nA');
  assert.equal(apply('A\nB\n', 0, 1, 4), 'B\nA\n');
  assert.equal(lineMove('A\nB', 0, 1, 2), null);
});
