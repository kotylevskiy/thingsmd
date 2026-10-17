const test = require('node:test');
const assert = require('node:assert/strict');
const attach = require('../plugin/list-row-drag.cjs');

test('a row drop routes the target group and its insertion side to the view command', () => {
  const group = {},
    calls = [];
  const row = { parentElement: group, hasClass: () => true, removeClass() {} };
  const view = { page: 'today', dropInGroup: (...args) => calls.push(args) };
  attach(view, row, { meta: { id: 'target' } }, 'today', false);
  const event = { preventDefault() {}, stopPropagation() {} };
  row.ondrop(event);
  assert.deepEqual(calls, [[event, group, 'target', true]]);
});
