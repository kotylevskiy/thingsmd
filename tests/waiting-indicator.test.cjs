const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync('plugin/tasks/task-indicators.cjs', 'utf8'), {
  module: mod,
  require: (name) =>
    name === 'obsidian'
      ? {
          setIcon: (el, icon) => {
            el.icon = icon;
          },
        }
      : name === './task-status.cjs'
        ? require('../plugin/tasks/task-status.cjs')
        : {},
});
test('waiting badge follows details, survives completion and is omitted in Waiting For', () => {
  for (const status of ['todo', 'done', 'canceled']) {
    const children = ['checkbox', 'title', 'notes'];
    const line = {
      createSpan: (options) => {
        children.push(options);
        return options;
      },
    };
    mod.exports.waitingIndicator(line, { is_waiting: true, status }, 'logbook');
    assert.equal(children.length, 4);
    assert.equal(children[3].icon, 'thingsmd-paper-plane');
    assert.equal(children[3].cls.includes('is-completed'), status !== 'todo');
    assert.equal(children[3].attr['aria-label'], 'Waiting For');
    mod.exports.waitingIndicator(line, { is_waiting: true, status }, 'waiting');
    mod.exports.waitingIndicator(line, { is_waiting: false, status }, 'anytime');
    mod.exports.waitingIndicator(line, { is_waiting: true, status }, 'anytime', false);
    assert.equal(children.length, 4);
  }
});
