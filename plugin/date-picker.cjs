const { dayKey, parseDate } = require('./local-date.cjs');
function datePicker(pop, { kind, value, onSelect, setIcon }) {
  const doc = pop.ownerDocument;
  const now = new Date();
  const today = dayKey(now);
  const initial = parseDate(value || '') || today;
  const [y, m] = initial.split('-').map(Number);
  let month = new Date(y, m - 1, 1, 12);
  let focused = initial;
  pop.empty();
  pop.addClass('ot-date-picker');
  pop.setAttribute('popover', 'manual');
  pop.showPopover();
  pop.setAttribute('aria-label', kind === 'when' ? 'When' : 'Deadline');
  const row = pop.closest('.ot-task');
  const close = () => {
    pop.remove();
    row.querySelector('.ot-title-input')?.focus({ preventScroll: true });
  };
  pop.close = close;
  const choose = (date) => {
    onSelect(kind === 'when' && date === today ? 'today' : date);
    close();
  };
  const makeButton = (parent, text, cls, action, label) => {
    const b = parent.createEl('button', {
      text,
      cls,
      attr: { type: 'button', ...(label ? { 'aria-label': label } : {}) },
    });
    b.onclick = action;
    return b;
  };
  const top = pop.createDiv('ot-date-search');
  const glyph = top.createSpan('ot-date-glyph');
  setIcon(glyph, kind === 'when' ? 'calendar-days' : 'flag');
  const input = top.createEl('input', {
    attr: {
      type: 'text',
      'aria-label': kind === 'when' ? 'When date' : 'Deadline date',
      placeholder: kind === 'when' ? 'When?' : 'Deadline?',
      autocomplete: 'off',
    },
  });
  const clear = makeButton(top, '', 'ot-date-clear', () => choose(null), 'Clear date');
  setIcon(clear, 'x');
  clear.hidden = !value;
  const result = pop.createDiv({ cls: 'ot-date-result', attr: { 'aria-live': 'polite' } });
  result.hidden = true;
  const quick = pop.createDiv('ot-date-quick');
  const option = (label, icon, offset) => {
    const target = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12));
    const b = makeButton(quick, '', 'ot-date-shortcut', () => choose(target));
    if (offset === 0 && kind === 'when')
      b.setAttribute(
        'aria-pressed',
        String(value === 'today' || (/^\d{4}-\d{2}-\d{2}$/.test(value || '') && value <= today)),
      );
    const i = b.createSpan(`ot-quick-icon ot-quick-${icon}`);
    setIcon(i, icon);
    b.createSpan({ text: label });
    b.createSpan({
      cls: 'ot-quick-hint',
      text: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12),
      ),
    });
  };
  option('Today', kind === 'when' ? 'star' : 'flag', 0);
  if (kind === 'when') {
    const b = makeButton(quick, '', 'ot-date-shortcut', () => choose('evening'));
    setIcon(b.createSpan('ot-quick-icon'), 'moon');
    b.createSpan({ text: 'This Evening' });
    b.setAttribute('aria-pressed', String(value === 'evening'));
  }
  option('Tomorrow', 'sunrise', 1);
  option('Next week', 'calendar-days', 7);
  if (kind === 'when')
    for (const [key, label, icon] of [
      ['anytime', 'Anytime', 'layers'],
      ['someday', 'Someday', 'archive'],
    ]) {
      const b = makeButton(quick, '', 'ot-date-shortcut', () => choose(key));
      const glyph = b.createSpan('ot-quick-icon');
      setIcon(glyph, icon);
      b.createSpan({ text: label });
      b.setAttribute('aria-pressed', String(value === key));
    }
  const calendar = pop.createDiv('ot-calendar');
  const heading = calendar.createDiv('ot-calendar-heading');
  const monthLabel = heading.createSpan({
    cls: 'ot-calendar-month',
    attr: { 'aria-live': 'polite' },
  });
  const nav = heading.createDiv('ot-calendar-nav');
  const previous = makeButton(nav, '', '', () => changeMonth(-1), 'Previous month');
  setIcon(previous, 'chevron-left');
  const next = makeButton(nav, '', '', () => changeMonth(1), 'Next month');
  setIcon(next, 'chevron-right');
  const weekdays = calendar.createDiv({
    cls: 'ot-calendar-weekdays',
    attr: { 'aria-hidden': 'true' },
  });
  for (let i = 0; i < 7; i++)
    weekdays.createSpan({
      text: new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(
        new Date(2024, 0, 1 + i),
      ),
    });
  const grid = calendar.createDiv({
    cls: 'ot-calendar-grid',
    attr: { role: 'group', 'aria-label': 'Choose a date' },
  });
  const fullDate = (key) => {
    const [a, b, c] = key.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(a, b - 1, c, 12));
  };
  function draw() {
    monthLabel.textContent = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
    }).format(month);
    grid.empty();
    const offset = (month.getDay() + 6) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset, 12);
    for (let i = 0; i < 42; i++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12);
      const key = dayKey(date);
      const b = makeButton(
        grid,
        String(date.getDate()),
        'ot-calendar-day',
        () => choose(key),
        fullDate(key),
      );
      b.dataset.date = key;
      b.tabIndex = key === focused ? 0 : -1;
      b.toggleClass('is-outside', date.getMonth() !== month.getMonth());
      b.toggleClass('is-today', key === today);
      b.toggleClass('is-picked', key === (value === 'today' ? today : value));
      b.setAttribute('aria-pressed', String(key === (value === 'today' ? today : value)));
      if (key === today) b.setAttribute('aria-current', 'date');
      b.onkeydown = (e) => {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (!(e.key in offsets)) return;
        e.preventDefault();
        e.stopPropagation();
        const moved = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate() + offsets[e.key],
          12,
        );
        focused = dayKey(moved);
        month = new Date(moved.getFullYear(), moved.getMonth(), 1, 12);
        draw();
        grid.querySelector(`[data-date="${focused}"]`).focus();
      };
    }
  }
  function changeMonth(step) {
    month = new Date(month.getFullYear(), month.getMonth() + step, 1, 12);
    focused = dayKey(month);
    draw();
  }
  draw();
  if (value) {
    const bottom = pop.createDiv('ot-date-bottom');
    makeButton(
      bottom,
      kind === 'when' ? 'Clear schedule' : 'Remove deadline',
      'ot-date-remove',
      () => choose(null),
    );
  }
  pop.createDiv({ cls: 'ot-date-help', text: 'Today, tomorrow, YYYY-MM-DD or DD.MM.YYYY' });
  input.oninput = () => {
    result.empty();
    result.hidden = !input.value.trim();
    const date = parseDate(input.value, now);
    if (date) makeButton(result, fullDate(date), 'ot-date-match', () => choose(date));
    else result.createSpan({ text: 'Enter a date, e.g. 24.10.2026', cls: 'ot-date-invalid' });
    input.setAttribute('aria-invalid', String(!!input.value && !date));
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const date = parseDate(input.value, now);
      if (date) choose(date);
      else input.oninput();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      grid.querySelector('[tabindex="0"]')?.focus();
    }
  };
  // Focus immediately: deferred positioning must not steal focus back from
  // a calendar day after the user has already started keyboard navigation.
  input.focus({ preventScroll: true });
  // Keep the popover within the editor viewport, including short windows.
  requestAnimationFrame(() => {
    if (!pop.isConnected) return;
    const bounds = row.getBoundingClientRect();
    const height = pop.offsetHeight;
    const win = doc.defaultView;
    pop.style.position = 'fixed';
    pop.style.bottom = 'auto';
    pop.style.right = 'auto';
    pop.style.maxHeight = `${win.innerHeight - 24}px`;
    pop.style.left = `${Math.max(8, Math.min(bounds.right - pop.offsetWidth, win.innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(bounds.bottom + height + 10 < win.innerHeight ? bounds.bottom - 8 : bounds.top - height + 12, win.innerHeight - height - 8))}px`;
  });
}
module.exports = { datePicker };
