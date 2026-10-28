const { setIcon } = require('obsidian');
const { normalizeColor } = require('./color.cjs');
const { quietLabel } = require('../shared/quiet-label.cjs');
function renderCalendar(container, service) {
  container.empty();
  const { events, statuses } = service.today();
  if (!statuses.length) return;
  container.removeAttribute('aria-label');
  const refresh = container.createEl('button', {
    cls: 'ot-calendar-refresh',
    attr: { type: 'button' },
  });
  setIcon(refresh, 'refresh-cw');
  quietLabel(refresh, 'Refresh calendars');
  refresh.disabled = statuses.some((status) => status.refreshing);
  refresh.toggleClass('is-refreshing', refresh.disabled);
  refresh.setAttribute('aria-busy', String(refresh.disabled));
  refresh.onclick = () => void service.refreshAll(true);
  for (const status of statuses.filter((status) => status.error))
    container.createDiv({
      cls: 'ot-calendar-status',
      text: `${status.name}: ${status.error}${status.cached ? ' Showing cached events.' : ''}`,
      attr: { role: 'status' },
    });
  if (!events.length)
    container.createDiv({
      cls: 'ot-calendar-empty',
      text: statuses.some((s) => s.refreshing) ? 'Loading events…' : 'No events today',
    });
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const list = container.createEl('ul', { cls: 'ot-calendar-events' });
  quietLabel(list, 'Calendar events');
  for (const event of events) {
    const range = event.allDay
      ? 'All day'
      : `${time.format(event.start)}–${time.format(event.end)}`;
    const row = list.createEl('li', { cls: 'ot-calendar-event' });
    const color = normalizeColor(event.color);
    if (color) row.style.setProperty('--ot-calendar-color', color);
    const timeEl = row.createSpan({
      cls: `ot-calendar-time${event.allDay ? ' is-all-day' : ''}`,
      text: event.allDay ? '' : time.format(event.start),
    });
    quietLabel(timeEl, range);
    row.createSpan({ cls: 'ot-calendar-title', text: event.title });
  }
}
module.exports = { renderCalendar };
