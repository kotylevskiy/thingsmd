const test = require('node:test');
const assert = require('node:assert/strict');
const { moveMessage } = require('../plugin/move-notice.cjs');
const day = '2026-10-17';
const task = (meta = {}, references = []) => ({
  meta: { title: 'Write report', ...meta },
  references,
});
const message = (before, after, preferred) => moveMessage(before, after, {}, day, preferred);

test('moves name destinations across Inbox, Today, Upcoming, Anytime, Someday and Waiting', () => {
  const inbox = task();
  assert.match(message(inbox, task({ when: 'today' })), /Today/);
  assert.match(message(inbox, task({ when: '2099-01-01' })), /Upcoming.*2099-01-01/);
  assert.match(message(task({ when: 'today' }), task({ when: 'anytime' })), /Anytime/);
  assert.match(message(task({ when: 'today' }), task({ when: 'someday' })), /Someday/);
  assert.match(message(task({ when: 'someday' }), inbox), /Inbox/);
  assert.match(message(inbox, task({ is_waiting: true })), /Waiting For/);
  assert.match(message(task({ when: '2099-01-01' }), task({ when: '2099-01-02' })), /2099-01-02/);
});

test('title, body, ordering, deadline-only Inbox edits and unsuccessful moves stay quiet', () => {
  const inbox = task();
  for (const patch of [{ title: 'Renamed' }, { order: 42 }, { deadline: '2099-01-01' }])
    assert.equal(message(inbox, task(patch)), null);
  assert.equal(message(inbox, undefined), null);
  assert.equal(message(inbox, task({ deleted: true })), null);
  assert.equal(message(inbox, task({ when: 'today', status: 'done' })), null);
});

test('filing names the note and explicit list moves name the chosen destination', () => {
  assert.match(message(task(), task({ project: 'Work.md' })), /Work/);
  assert.equal(
    message(task({ when: 'today' }), task({ when: 'anytime', project: 'Work.md' }), 'anytime'),
    '“Write report” moved to Anytime',
  );
});

test('rapid move notices replace their predecessor and unload dismisses the final notice', () => {
  const fs = require('node:fs'),
    vm = require('node:vm');
  const { createRequire } = require('node:module');
  const filename = require.resolve('../plugin/move-notice.cjs');
  const localRequire = createRequire(filename),
    module = { exports: {} },
    notices = [];
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: (name) =>
      name === 'obsidian'
        ? {
            Notice: class {
              constructor(message) {
                this.message = message;
                notices.push(this);
              }
              hide() {
                this.hidden = true;
              }
            },
          }
        : localRequire(name),
  });
  let cleanup;
  const plugin = {
    settings: {},
    register: (fn) => {
      cleanup = fn;
    },
  };
  module.exports.install(plugin);
  plugin.notifyTaskMove(task(), task({ when: 'someday' }));
  plugin.notifyTaskMove(task({ when: 'someday' }), task({ when: 'today' }));
  assert.equal(notices.length, 2);
  assert.equal(notices[0].hidden, true);
  assert.equal(notices[1].hidden, undefined);
  cleanup();
  assert.equal(notices[1].hidden, true);
});
