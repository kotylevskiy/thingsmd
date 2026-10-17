const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
class Element {
  constructor(options = {}) {
    this.cls = typeof options === 'string' ? options : options.cls || '';
    this.text = options.text || '';
    this.attr = options.attr || {};
    this.children = [];
  }
  createSpan(options) {
    const child = new Element(options);
    this.children.push(child);
    return child;
  }
  createEl(tag, options) {
    return this.createSpan(options);
  }
  querySelector(cls) {
    return this.children.find((child) => child.cls === cls.slice(1));
  }
  insertBefore(child, before) {
    this.children.splice(this.children.indexOf(child), 1);
    this.children.splice(this.children.indexOf(before), 0, child);
  }
  toggleClass(cls, on) {
    if (on) this.cls += ` ${cls}`;
  }
}
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync('plugin/task-indicators.cjs', 'utf8'), {
  module: mod,
  require: (name) =>
    name === 'obsidian'
      ? { setIcon: () => {} }
      : name === './local-date.cjs'
        ? {
            ...require('../plugin/local-date.cjs'),
            today: () => '2026-10-17',
            dayAfter: () => '2026-10-18',
          }
        : require(`../plugin/${name.replace('./', '')}`),
  Intl,
  Date,
});
const render = (meta, page = 'upcoming') => {
  const line = new Element();
  line.createSpan('ot-task-title');
  mod.exports.taskIndicators(line, { meta, body: '' }, page);
  return line;
};
test('Upcoming omits redundant start metadata and renders deadline countdown on the same row', () => {
  assert.equal(render({ when: '2026-10-19' }).querySelector('.ot-row-indicators'), undefined);
  for (const [deadline, expected, overdue] of [
    ['2026-10-21', '4 days left', false],
    ['2026-10-18', '1 day left', false],
    ['2026-10-17', 'Today', true],
    ['2026-10-16', '1 day ago', true],
    ['2026-10-15', '2 days ago', true],
  ]) {
    const dates = render({ when: '2026-10-19', deadline }).querySelector('.ot-row-indicators');
    assert.equal(dates.children.length, 1);
    const item = dates.children[0];
    assert.equal(item.cls.includes('is-overdue'), overdue);
    assert.equal(item.children.at(-1).text, expected);
    assert.equal(item.children.at(-1).attr.datetime, deadline);
  }
});
test('repeating templates show the nominal deadline while placement remains on their earlier start', () => {
  const dates = render({
    when: '2026-10-19',
    repeat: { next: '2026-10-21', deadline: true },
  }).querySelector('.ot-row-indicators');
  assert.equal(dates.children[0].children.at(-1).attr.datetime, '2026-10-21');
  assert.equal(dates.children[0].children.at(-1).text, '4 days left');
  const completed = render({
    when: '2026-10-19',
    deadline: '2026-10-15',
    status: 'done',
  }).querySelector('.ot-row-indicators');
  assert.equal(completed.children[0].cls.includes('is-overdue'), false);
});
