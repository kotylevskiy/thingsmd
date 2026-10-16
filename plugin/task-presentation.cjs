// Shared by list rows and both native Markdown modes.
function taskState(row, meta) {
  row.classList.toggle('is-someday', meta.when === 'someday' && meta.status !== 'done');
  const check = row.querySelector('.ot-task-line > input[type=checkbox]');
  row.querySelector('.ot-waiting-marker')?.remove();
  if (check && meta.is_waiting === true) {
    const marker = check.parentElement.createSpan({
      cls: 'ot-waiting-marker',
      attr: { role: 'img', 'aria-label': 'Waiting For' },
    });
    require('obsidian').setIcon(marker, 'send-horizontal');
    check.after(marker);
  }
  if (check) {
    if (meta.when === 'someday' && meta.status !== 'done')
      check.setAttribute('aria-description', 'Someday — not yet scheduled');
    else check.removeAttribute('aria-description');
  }
}
module.exports = { taskState };
