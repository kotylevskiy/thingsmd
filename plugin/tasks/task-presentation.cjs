const { isFinished } = require('./task-status.cjs');
const { inToday } = require('./model.cjs');
const { today } = require('../shared/local-date.cjs');

// Shared by list rows and both native Markdown modes.
function taskState(row, meta) {
  row.classList.toggle('is-done', isFinished(meta));
  row.classList.toggle('is-canceled', meta.status === 'canceled');
  const someday = meta.when === 'someday' && !inToday(meta, today()) && !isFinished(meta);
  row.classList.toggle('is-someday', someday);
  const check = row.querySelector('.ot-task-line > input[type=checkbox]');
  if (row.classList.contains('is-expanded')) row.querySelector('.ot-waiting-marker')?.remove();
  if (check) {
    if (meta.status === 'canceled') check.setAttribute('aria-description', 'Canceled');
    else if (someday) check.setAttribute('aria-description', 'Someday — not yet scheduled');
    else check.removeAttribute('aria-description');
  }
}
module.exports = { taskState };
