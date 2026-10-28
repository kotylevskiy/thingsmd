const { compareTasks, insertionOrder } = require('../tasks/model.cjs');
const orderValue = (task, key) =>
  Number.isFinite(task.meta.listOrder?.[key])
    ? task.meta.listOrder[key]
    : Number(task.meta.order) || 0;
const compareList = (key) => (a, b) =>
  orderValue(a, key) - orderValue(b, key) || compareTasks(a, b);
function listInsertion(tasks, key, beforeId) {
  return insertionOrder(
    tasks.map((t) => ({ ...t, meta: { ...t.meta, order: orderValue(t, key) } })),
    beforeId,
  );
}
module.exports = { compareList, listInsertion };
