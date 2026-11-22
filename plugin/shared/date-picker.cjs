const { quietLabel } = require('./quiet-label.cjs');
const { dayKey, date, addDays, parseDate } = require('./local-date.cjs');
const { firstWeekday, calendarDays, dateSuggestions } = require('./date-picker-model.cjs');

function datePicker(
  pop,
  {
    kind,
    weekStartsOn,
    value,
    onSelect,
    onClose,
    setIcon,
    inline = false,
    allowClear = true,
    dateOnly = false,
    anchor = pop.ownerDocument.activeElement,
  },
) {
  const doc = pop.ownerDocument;
  const win = doc.defaultView;
  const mobile =
    doc.body.classList.contains('is-mobile') || win.matchMedia('(pointer: coarse)').matches;
  const now = new Date();
  const today = dayKey(now);
  const selected = value === 'today' || value === 'evening' ? today : parseDate(value || '');
  const initial = selected || today;
  const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
  const weekStart = weekStartsOn ?? firstWeekday(locale);
  const weekdaysFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const monthFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const shortMonthFormat = new Intl.DateTimeFormat(locale, { month: 'short' });
  const fullDateFormat = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const compactKeys = calendarDays(today, 28, weekStart);
  let compact = kind === 'when' && (!selected || compactKeys.slice(0, -1).includes(selected));
  let month = new Date(date(initial).getFullYear(), date(initial).getMonth(), 1, 12);
  let calendarStart = addDays(initial, -56);
  let visibleDate = initial,
    visibleOffset = 0;
  let focused = initial;
  let frame;
  const row = pop.closest('.ot-task');
  const title = kind === 'when' ? 'When' : kind === 'deadline' ? 'Deadline' : 'Date';
  pop.empty();
  pop.addClass('ot-date-picker');
  pop.toggleClass('is-mobile-picker', mobile);
  pop.setAttribute('aria-label', title);
  const events = new win.AbortController();
  let observer,
    resizeObserver,
    layer,
    closed = false;
  const dispose = () => {
    events.abort();
    observer?.disconnect();
    resizeObserver?.disconnect();
    win.cancelAnimationFrame(frame);
  };
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    dispose();
    pop.remove();
    layer?.close();
    layer?.remove();
    if (restoreFocus && !inline) {
      const target = mobile ? anchor : row?.querySelector('.ot-title-input') || anchor;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
    onClose?.();
  };
  pop.close = close;
  const choose = (key) => {
    onSelect(kind === 'when' && key === today ? 'today' : key);
    if (!inline) close();
  };
  const button = (parent, text, cls, action, label) => {
    const control = parent.createEl('button', {
      text,
      cls,
      attr: { type: 'button', ...(label ? { 'aria-label': label } : {}) },
    });
    control.onclick = action;
    return control;
  };
  const header = pop.createDiv('ot-date-header');
  header.createSpan({ text: title === 'When' ? 'When?' : title });
  button(header, 'Cancel', 'ot-date-cancel', () => close(), 'Cancel date selection');
  const search = pop.createDiv('ot-date-search');
  setIcon(search.createSpan('ot-date-glyph'), 'search');
  const input = search.createEl('input', {
    attr: {
      type: 'text',
      'aria-label': title === 'Date' ? 'Date' : `${title} date`,
      placeholder: 'Search',
      autocomplete: 'off',
      enterkeyhint: 'done',
    },
  });
  const clearQuery = button(
    search,
    '',
    'ot-date-clear',
    () => {
      input.value = '';
      searchDates();
      input.focus();
    },
    'Clear search',
  );
  setIcon(clearQuery, 'x');
  clearQuery.hidden = true;
  const result = pop.createDiv({ cls: 'ot-date-result', attr: { 'aria-live': 'polite' } });
  result.hidden = true;
  const body = pop.createDiv('ot-date-body');
  const shortcut = (parent, label, icon, key) => {
    const control = button(parent, '', 'ot-date-shortcut', () => choose(key), label);
    setIcon(control.createSpan(`ot-quick-icon ot-quick-${icon}`), icon);
    control.createSpan({ text: label });
    control.setAttribute('aria-pressed', String(key === value));
  };
  if (kind === 'when' && !dateOnly) {
    const quick = body.createDiv('ot-date-quick');
    shortcut(quick, 'Today', 'star', 'today');
    shortcut(quick, 'This Evening', 'moon', 'evening');
  }
  const calendar = body.createDiv('ot-calendar');
  const heading = calendar.createDiv('ot-calendar-heading');
  const monthLabel = heading.createSpan({
    cls: 'ot-calendar-month',
    attr: { 'aria-live': 'polite' },
  });
  const nav = heading.createDiv('ot-calendar-nav');
  setIcon(
    button(nav, '', '', () => changeMonth(-1), 'Previous month'),
    'chevron-left',
  );
  setIcon(
    button(nav, '', '', () => changeMonth(1), 'Next month'),
    'chevron-right',
  );
  const weekdays = calendar.createDiv({
    cls: 'ot-calendar-weekdays',
    attr: { 'aria-hidden': 'true' },
  });
  for (let i = 0; i < 7; i++)
    weekdays.createSpan({
      text: weekdaysFormat.format(new Date(2024, 0, 7 + weekStart + i, 12)),
    });
  const scroll = calendar.createDiv('ot-calendar-scroll');
  const grid = scroll.createDiv({
    cls: 'ot-calendar-grid',
    attr: { role: 'group', 'aria-label': 'Choose a date' },
  });
  const fullDate = (key) => fullDateFormat.format(date(key));
  function draw(visible = focused, offset = 0) {
    const restoreFocus = grid.contains(doc.activeElement);
    const focusedDay = doc.activeElement?.dataset.date;
    pop.toggleClass('is-compact-calendar', compact);
    heading.hidden = compact;
    showMonth(visible);
    grid.empty();
    // Expanded calendars scroll through weeks continuously across month boundaries.
    const days = compact ? compactKeys : calendarDays(calendarStart, 182, weekStart);
    if (!days.includes(focused)) focused = visible;
    for (let i = 0; i < days.length; i++) {
      const key = days[i];
      if (compact && key < today) {
        grid.createSpan('ot-calendar-blank');
        continue;
      }
      if (compact && i === days.length - 1) {
        setIcon(
          button(
            grid,
            '',
            'ot-calendar-expand',
            () => {
              compact = false;
              draw();
            },
            'Show full calendar',
          ),
          'chevron-right',
        );
        continue;
      }
      const day = date(key);
      const control = button(grid, '', 'ot-calendar-day', () => choose(key));
      quietLabel(control, fullDate(key));
      if (compact && key === today) setIcon(control, 'star');
      else {
        if (day.getDate() === 1)
          control.createSpan({
            cls: 'ot-calendar-boundary',
            text: shortMonthFormat.format(day),
          });
        control.createSpan({ text: String(day.getDate()) });
      }
      control.dataset.date = key;
      control.tabIndex = key === focused ? 0 : -1;
      control.toggleClass('is-past', key < today);
      control.toggleClass('is-month-start', day.getDate() === 1);
      control.toggleClass('is-today', key === today);
      control.toggleClass('is-picked', key === selected);
      control.setAttribute('aria-pressed', String(key === selected));
      if (key === today) control.setAttribute('aria-current', 'date');
      control.onkeydown = (event) => {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (!(event.key in offsets)) return;
        event.preventDefault();
        event.stopPropagation();
        focused = addDays(key, offsets[event.key]);
        if (!compact || focused < today || focused >= compactKeys.at(-1)) {
          compact = false;
          const moved = date(focused);
          month = new Date(moved.getFullYear(), moved.getMonth(), 1, 12);
          calendarStart = addDays(focused, -56);
        }
        draw();
        grid.querySelector(`[data-date="${focused}"]`)?.focus();
      };
    }
    if (!compact) {
      const day = grid.querySelector(`[data-date="${visible}"]`);
      if (day) scroll.scrollTop = day.offsetTop + offset;
      visibleDate = visible;
      visibleOffset = offset;
    }
    // Expanding or rebasing replaces the focused day/arrow. Keep focus inside
    // the picker so native note cards do not interpret that redraw as a blur.
    if (restoreFocus)
      (
        grid.querySelector(`[data-date="${focusedDay || visible}"]`) || grid.querySelector('button')
      )?.focus({ preventScroll: true });
    positionSoon();
  }
  scroll.onscroll = () => {
    if (compact || body.hidden || !scroll.clientHeight) return;
    const rowHeight = grid.querySelector('button').offsetHeight + 2;
    const keys = [...grid.querySelectorAll('[data-date]')];
    const first = keys[Math.floor(scroll.scrollTop / rowHeight) * 7]?.dataset.date;
    if (!first) return;
    visibleDate = first;
    visibleOffset = scroll.scrollTop % rowHeight;
    showMonth(first);
    if (scroll.scrollTop < 1 || scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) {
      // Rebase a bounded set of weeks, preserving the visible row. This lets
      // wheel/touch scrolling continue in either direction without a huge DOM.
      const offset = scroll.scrollTop % rowHeight;
      calendarStart = addDays(first, -56);
      draw(first, offset);
    }
  };
  function showMonth(key) {
    const visible = date(calendarDays(key, 7, weekStart).at(-1));
    month = new Date(visible.getFullYear(), visible.getMonth(), 1, 12);
    monthLabel.textContent = monthFormat.format(month);
  }
  function changeMonth(step) {
    compact = false;
    month = new Date(month.getFullYear(), month.getMonth() + step, 1, 12);
    focused = dayKey(month);
    calendarStart = addDays(focused, -56);
    draw();
  }
  if (kind === 'when' && !dateOnly) shortcut(body, 'Someday', 'archive', 'someday');
  if (allowClear && value && (kind !== 'when' || !['anytime', 'inbox'].includes(value))) {
    const bottom = body.createDiv('ot-date-bottom');
    button(
      bottom,
      'Clear',
      'ot-date-remove',
      () => choose(null),
      kind === 'when' ? 'Clear schedule' : kind === 'deadline' ? 'Remove deadline' : 'Clear date',
    );
  }
  const revealSearch = () => {
    search.hidden = false;
    reveal.hidden = true;
    input.focus();
    positionSoon();
  };
  const reveal = button(header, '', 'ot-date-reveal', revealSearch, 'Search dates');
  setIcon(reveal, 'search');
  search.hidden = mobile;
  reveal.hidden = !mobile;
  let pull;
  header.onpointerdown = (event) => {
    if (mobile && search.hidden && !event.target.closest('button'))
      pull = { x: event.clientX, y: event.clientY };
  };
  pop.onpointerup = (event) => {
    if (pull && event.clientY - pull.y > 40 && Math.abs(event.clientX - pull.x) < 30) {
      event.preventDefault();
      revealSearch();
    }
    pull = null;
  };
  pop.onpointercancel = () => {
    pull = null;
  };
  let candidates = [],
    matchIndex = 0;
  function searchDates() {
    const querying = !!input.value.trim();
    candidates = dateSuggestions(input.value, now, locale);
    matchIndex = 0;
    result.empty();
    result.hidden = !querying;
    body.hidden = querying;
    if (!querying && !compact) {
      const day = grid.querySelector(`[data-date="${visibleDate}"]`);
      if (day) scroll.scrollTop = day.offsetTop + visibleOffset;
    }
    clearQuery.hidden = !querying;
    input.setAttribute('aria-invalid', String(querying && !candidates.length));
    for (const [index, candidate] of candidates.entries()) {
      const control = button(result, '', 'ot-date-match', () => choose(candidate.date));
      control.createSpan({ text: candidate.label });
      control.createSpan({ text: fullDate(candidate.date), cls: 'ot-date-match-detail' });
      control.toggleClass('is-active', index === matchIndex);
    }
    if (querying && !candidates.length)
      result.createSpan({ text: 'No matching date', cls: 'ot-date-invalid' });
    positionSoon();
  }
  input.oninput = searchDates;
  input.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (candidates[matchIndex]) choose(candidates[matchIndex].date);
      else searchDates();
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!candidates.length) grid.querySelector('[tabindex="0"]')?.focus();
      else {
        matchIndex =
          (matchIndex + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) %
          candidates.length;
        result
          .querySelectorAll('.ot-date-match')
          .forEach((control, i) => control.toggleClass('is-active', i === matchIndex));
      }
    }
  };
  function position() {
    if (inline || !pop.isConnected) return;
    const viewport = win.visualViewport;
    const top = viewport?.offsetTop || 0,
      left = viewport?.offsetLeft || 0;
    const width = viewport?.width || win.innerWidth,
      height = viewport?.height || win.innerHeight;
    const bounds = (
      anchor?.closest?.('button') ||
      row ||
      pop.parentElement
    ).getBoundingClientRect();
    pop.style.maxHeight = `${height - 16}px`;
    pop.style.maxWidth = `${width - 16}px`;
    let x = mobile
      ? left + (width - pop.offsetWidth) / 2
      : Math.min(bounds.right - pop.offsetWidth, left + width - pop.offsetWidth - 8);
    let y = mobile
      ? top + Math.min(60, Math.max(8, (height - pop.offsetHeight) / 3))
      : bounds.bottom + 8 + pop.offsetHeight <= top + height
        ? bounds.bottom + 8
        : bounds.top - pop.offsetHeight - 8;
    if (!mobile && y < top + 8 && bounds.bottom + pop.offsetHeight + 8 > top + height) {
      if (bounds.left - pop.offsetWidth - 8 >= left + 8) x = bounds.left - pop.offsetWidth - 8;
      else if (bounds.right + pop.offsetWidth + 8 <= left + width - 8) x = bounds.right + 8;
      y = bounds.top;
    }
    pop.style.left = `${Math.max(left + 8, x)}px`;
    pop.style.top = `${Math.max(top + 8, Math.min(y, top + height - pop.offsetHeight - 8))}px`;
  }
  function positionSoon() {
    if (!inline) {
      win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(position);
    }
  }
  draw();
  if (!inline) {
    pop.setAttribute('popover', 'manual');
    if (typeof pop.showPopover === 'function') pop.showPopover();
    else {
      // Some embedded WebKit builds lack Popover API support. A dialog keeps
      // the same control in the top layer without clipping it to the editor.
      pop.removeAttribute('popover');
      layer = doc.createElement('dialog');
      layer.className = 'ot-date-layer';
      pop.before(layer);
      layer.append(pop);
      if (mobile) {
        pop.tabIndex = -1;
        pop.setAttribute('autofocus', '');
      }
      layer.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
      });
      layer.showModal();
    }
    for (const type of ['resize', 'scroll'])
      win.visualViewport?.addEventListener(type, positionSoon, { signal: events.signal });
    win.addEventListener('resize', positionSoon, { signal: events.signal });
    for (const type of ['pointerdown', 'mousedown', 'touchstart'])
      doc.addEventListener(
        type,
        (event) => {
          if (!pop.contains(event.target) && !anchor?.contains(event.target)) close(false);
        },
        { capture: true, signal: events.signal },
      );
    // Hosts also remove editors directly during navigation or plugin unload.
    observer = new win.MutationObserver(() => {
      if (!pop.isConnected) {
        dispose();
        layer?.remove();
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    resizeObserver = new win.ResizeObserver(positionSoon);
    resizeObserver.observe(pop);
    position();
  }
  if (mobile) {
    anchor?.blur();
    pop.tabIndex = -1;
    pop.focus({ preventScroll: true });
  } else input.focus({ preventScroll: true });
}
module.exports = { datePicker };
