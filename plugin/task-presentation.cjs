const { inToday } = require('./model.cjs');
const { today } = require('./local-date.cjs');

// Shared by list rows and both native Markdown modes.
function taskState(row, meta) {
  const someday = meta.when === 'someday' && !inToday(meta, today()) && meta.status !== 'done';
  row.classList.toggle('is-someday', someday);
  const check = row.querySelector('.ot-task-line > input[type=checkbox]');
  if (row.classList.contains('is-expanded')) row.querySelector('.ot-waiting-marker')?.remove();
  if (check) {
    if (someday) check.setAttribute('aria-description', 'Someday — not yet scheduled');
    else check.removeAttribute('aria-description');
  }
}
module.exports = { taskState };
