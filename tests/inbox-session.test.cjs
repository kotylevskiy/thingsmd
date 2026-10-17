const test = require('node:test');
const assert = require('node:assert/strict');
const InboxSession = require('../plugin/inbox-session.cjs');
const { inList } = require('../plugin/model.cjs');
const day = '2026-10-17';
const task = (id, fields = {}) => ({ meta: { id, status: 'todo', ...fields } });
const active = (tasks) => tasks.filter((t) => inList(t, 'inbox', day));

test('future deadlines retain Inbox membership; due deadlines and processing keep a temporary row', () => {
  const session = new InboxSession();
  let t = task('a');
  assert.deepEqual(session.update([t], active([t]), day), []);
  for (const deadline of ['2099-01-01', null]) {
    t = task('a', { deadline });
    assert.deepEqual(session.update([t], active([t]), day), []);
    assert.equal(inList(t, 'inbox', day), true);
    assert.equal(inList(t, 'upcoming', day), false);
    assert.equal(inList(t, 'anytime', day), false);
  }
  for (const fields of [
    { deadline: '2026-10-16' },
    { deadline: day },
    { when: 'today' },
    { when: '2099-01-01' },
    { project: 'Note.md' },
  ]) {
    t = task('a', fields);
    assert.deepEqual(session.update([t], active([t]), day), [t]);
  }
  t = task('a');
  assert.deepEqual(session.update([t], active([t]), day), []);
  session.reset();
  t = task('a', { when: 'today' });
  assert.deepEqual(session.update([t], active([t]), day), []);
});

test('moved section excludes unrelated, deleted, completed and missing tasks', () => {
  const session = new InboxSession();
  const tasks = ['a', 'b', 'c', 'd'].map((id) => task(id));
  session.update(tasks, tasks, day);
  const changed = [
    task('a', { when: 'someday' }),
    task('b', { deleted: true }),
    task('c', { status: 'done' }),
    task('unrelated', { when: 'today' }),
  ];
  assert.deepEqual(session.update(changed, [], day), [changed[0]]);
});

test('deadline-only tasks enter other lists once processed; daily-note mode retains access', () => {
  const t = task('a', { deadline: '2099-01-01' });
  for (const fields of [{ when: 'anytime' }, { project: 'Note.md' }]) {
    const processed = { meta: { ...t.meta, ...fields } };
    assert.equal(inList(processed, 'inbox', day), false);
    assert.equal(inList(processed, 'anytime', day), true);
    assert.equal(inList(processed, 'upcoming', day), true);
  }
  assert.equal(inList(t, 'upcoming', day, 'daily', 'daily-note'), true);
});
