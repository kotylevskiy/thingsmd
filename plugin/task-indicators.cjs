const { setIcon } = require('obsidian');
const { today, dayAfter } = require('./local-date.cjs');
const { inToday, inEvening, isTodayWhen } = require('./model.cjs');
function taskIndicators(line, task, page) {
  if (task.meta.repeat || task.meta.repeatSource) {
    const repeat = line.createSpan({
      cls: 'ot-repeat-indicator' + (task.meta.repeat ? ' is-template' : ''),
      attr: { 'aria-label': task.meta.repeat ? 'Repeating template' : 'Repeating copy' },
    });
    setIcon(repeat, 'repeat');
    line.insertBefore(repeat, line.querySelector('.ot-task-title'));
  }
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
  if (page !== 'today' && inToday(task.meta, today())) {
    const evening = inEvening(task.meta, today());
    const star = line.createSpan({ cls: 'ot-today-marker' + (evening ? ' is-evening' : '') });
    const icon = star.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(icon, evening ? 'moon' : 'star');
    star.createSpan({ cls: 'ot-sr-only', text: evening ? 'This Evening' : 'In Today' });
    line.insertBefore(star, line.querySelector('.ot-task-title'));
  }
  if (page === 'upcoming') return;
  if (
    (!task.meta.when ||
      ['anytime', 'someday'].includes(task.meta.when) ||
      isTodayWhen(task.meta.when, today())) &&
    !task.meta.deadline
  )
    return;
  const dates = line.createSpan('ot-row-indicators');
  const current = today();
  const tomorrowKey = dayAfter(1);
  const label = (value) => {
    if (value === current) return 'Today';
    if (value === tomorrowKey) return 'Tomorrow';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value);
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
    const value = task.meta[key];
    if (
      !value ||
      (key === 'when' && (isTodayWhen(value, current) || ['anytime', 'someday'].includes(value)))
    )
      continue;
    const item = dates.createSpan({ cls: `ot-row-date ot-row-${key}` });
    item.toggleClass(
      'is-overdue',
      key === 'deadline' && value < current && task.meta.status !== 'done',
    );
    const glyph = item.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(glyph, icon);
    item.createSpan({ cls: 'ot-sr-only', text: `${name}: ` });
    item.createEl('time', { text: label(value), attr: { datetime: value } });
  }
}

module.exports = { taskIndicators };
