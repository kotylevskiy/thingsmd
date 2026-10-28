const test = require('node:test');
const assert = require('node:assert/strict');
const { listCounts } = require('../plugin/lists/list-counts.cjs');
const task = (meta = {}, references = []) => ({
  meta: { type: 'thingsmd-task', status: 'todo', ...meta },
  references,
});
test('sidebar counts unfinished Inbox and Today tasks once, including evening and waiting', () => {
  assert.deepEqual(
    listCounts(
      [
        task(),
        task({ when: 'today' }),
        task({ when: 'today', evening: '2026-10-16' }),
        task({ when: 'today', deadline: '2026-10-16' }),
        task({ when: 'today', is_waiting: true }),
        task({ when: '2026-10-15' }),
        task({ deadline: '2026-10-15' }),
        task({ status: 'done', when: 'today' }),
        task({ status: 'canceled', when: 'today' }),
        task({ status: 'canceled' }),
        task({ deleted: true, when: 'today' }),
        task({ repeat: { next: '2026-10-16' }, when: 'today' }),
        task({ when: '2099-01-01' }),
        task({ project: 'Project.md' }),
        task({}, ['Project.md']),
        task({ is_waiting: true }),
        { meta: { type: 'thingsmd-project' } },
      ],
      '2026-10-16',
      { logbook: 'manually', captureDestination: 'inbox' },
    ),
    { inbox: 1, today: 6 },
  );
});
test('empty lists have zero counts and reached dates enter Today', () => {
  assert.deepEqual(listCounts([], '2026-10-16', {}), { inbox: 0, today: 0 });
  assert.deepEqual(listCounts([task({ when: '2026-10-17' })], '2026-10-17', {}), {
    inbox: 0,
    today: 1,
  });
});

test('disabling waiting returns unfiled waiting tasks to the Inbox counter', () => {
  const tasks = [task({ is_waiting: true }), task({ is_waiting: true, when: 'today' })];
  assert.deepEqual(listCounts(tasks, '2026-10-17', { enableWaiting: false }), {
    inbox: 1,
    today: 1,
  });
  assert.deepEqual(listCounts(tasks, '2026-10-17', { enableWaiting: true }), {
    inbox: 0,
    today: 1,
  });
});
