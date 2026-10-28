const test = require('node:test'),
  assert = require('node:assert/strict');
const { compareList, listInsertion } = require('../plugin/lists/list-order.cjs');
const { upcomingDates } = require('../plugin/tasks/model.cjs');
test('list ranks are independent and retain original note order', () => {
  const a = { meta: { id: 'a', order: 1 } },
    b = { meta: { id: 'b', order: 2 } };
  b.meta.listOrder = { today: listInsertion([a], 'today', 'a') };
  assert.deepEqual(
    [a, b].sort(compareList('today')).map((t) => t.meta.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    [a, b].sort(compareList('inbox')).map((t) => t.meta.id),
    ['a', 'b'],
  );
  assert.equal(b.meta.order, 2);
});
test('Upcoming has one scheduled placement and uses a deadline only without a dated When', () => {
  assert.deepEqual(upcomingDates({ when: '2099-01-02', deadline: '2099-01-04' }, '2099-01-01'), [
    '2099-01-02',
  ]);
  assert.deepEqual(upcomingDates({ when: '2099-01-02', deadline: '2099-01-02' }, '2099-01-01'), [
    '2099-01-02',
  ]);
  assert.deepEqual(upcomingDates({ when: '2099-01-01', deadline: '2099-01-04' }, '2099-01-02'), []);
  assert.deepEqual(upcomingDates({ when: 'anytime', deadline: '2099-01-04' }, '2099-01-02'), [
    '2099-01-04',
  ]);
});
