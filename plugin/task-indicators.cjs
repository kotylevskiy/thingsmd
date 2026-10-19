const { isFinished } = require('./task-status.cjs');
const { setIcon } = require('obsidian');
const { today, dayAfter, daysBetween, validDate } = require('./local-date.cjs');
const { inToday, inEvening, isTodayWhen } = require('./model.cjs');
// Keep waiting separate from completion, including archived tasks.
function waitingIndicator(line, meta, page, enableWaiting = true) {
  if (!enableWaiting || meta.is_waiting !== true || page === 'waiting') return;
  const marker = line.createSpan({
    cls: 'ot-waiting-marker' + (isFinished(meta) ? ' is-completed' : ''),
    attr: { role: 'img', 'aria-label': 'Waiting For', title: 'Waiting For' },
  });
  setIcon(marker, 'thingsmd-paper-plane');
}
function taskIndicators(line, task, page, enableWaiting = true) {
  const details =
    task.meta.checklist?.length || task.body.trim() ? line.createSpan('ot-task-details') : null;
  if (task.meta.checklist?.length) {
    const indicator = details.createSpan({
      cls: 'ot-checklist-indicator',
      attr: {
        role: 'img',
        'aria-label': `${task.meta.checklist.filter((item) => item.done).length} of ${task.meta.checklist.length} checklist items completed`,
      },
    });
    indicator.title = indicator.getAttribute('aria-label');
    setIcon(indicator, 'list-checks');
  }
  if (task.body.trim()) {
    const note = details.createSpan('ot-note-icon');
    const icon = note.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(icon, 'file-text');
    note.createSpan({ cls: 'ot-sr-only', text: 'Has notes' });
  }
  if (task.meta.repeat || task.meta.repeatSource) {
    const repeat = line.createSpan({
      cls: 'ot-repeat-indicator' + (task.meta.repeat ? ' is-template' : ''),
      attr: { 'aria-label': task.meta.repeat ? 'Repeating template' : 'Repeating copy' },
    });
    setIcon(repeat, 'repeat');
  }
  waitingIndicator(line, task.meta, page, enableWaiting);
  if (page !== 'today' && inToday(task.meta, today())) {
    const evening = inEvening(task.meta, today());
    const star = line.createSpan({ cls: 'ot-today-marker' + (evening ? ' is-evening' : '') });
    const icon = star.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(icon, evening ? 'moon' : 'star');
    star.createSpan({ cls: 'ot-sr-only', text: evening ? 'This Evening' : 'In Today' });
    line.insertBefore(star, line.querySelector('.ot-task-title'));
  }
  const deadline = task.meta.repeat?.deadline ? task.meta.repeat.next : task.meta.deadline;
  if (page === 'upcoming' && !deadline) return;
  if (
    (!task.meta.when ||
      ['anytime', 'someday'].includes(task.meta.when) ||
      isTodayWhen(task.meta.when, today())) &&
    !deadline
  )
    return;
  const dates = line.createSpan('ot-row-indicators');
  const current = today();
  const tomorrowKey = dayAfter(1);
  const label = (value) => {
    if (value === current) return 'Today';
    if (value === tomorrowKey) return 'Tomorrow';
    if (!validDate(value)) return String(value);
    const [y, m, d] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    }).format(new Date(y, m - 1, d, 12));
  };
  for (const [key, icon, name] of [
    ['when', 'calendar-days', 'When'],
    ['deadline', 'flag', 'Deadline'],
  ]) {
    const value = key === 'deadline' ? deadline : task.meta[key];
    if (
      !value ||
      (key === 'when' &&
        (page === 'upcoming' ||
          isTodayWhen(value, current) ||
          ['anytime', 'someday'].includes(value)))
    )
      continue;
    const item = dates.createSpan({ cls: `ot-row-date ot-row-${key}` });
    item.toggleClass(
      'is-overdue',
      key === 'deadline' && validDate(value) && value <= current && !isFinished(task.meta),
    );
    const glyph = item.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(glyph, icon);
    item.createSpan({ cls: 'ot-sr-only', text: `${name}: ` });
    const remaining = validDate(value) ? daysBetween(current, value) : null;
    const text =
      key !== 'deadline' || remaining === null
        ? label(value)
        : remaining === 0
          ? 'Today'
          : remaining > 0
            ? `${remaining} ${remaining === 1 ? 'day' : 'days'} left`
            : `${-remaining} ${remaining === -1 ? 'day' : 'days'} ago`;
    item.title = `${name}: ${label(value)}`;
    item.createEl('time', { text, attr: { datetime: value } });
  }
}

module.exports = { taskIndicators, waitingIndicator };
