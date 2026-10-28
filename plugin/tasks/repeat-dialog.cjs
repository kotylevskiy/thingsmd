const { Modal, setIcon } = require('obsidian');
const { dayKey, date, daysBetween, validDate } = require('../shared/local-date.cjs');
const { validate, nextDate, patternOnDate } = require('./repeat-model.cjs');
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const { button, removeModalCloseButton } = require('../shared/dom.cjs');
const select = (parent, label, options, value, change) => {
  const el = parent.createEl('select', { attr: { 'aria-label': label } });
  for (const [key, text] of options) el.createEl('option', { text, attr: { value: String(key) } });
  el.value = String(value);
  el.onchange = () => change(el.value);
  return el;
};
// Edits a local rule; only OK asks the repeat service to persist it.
class RepeatDialog extends Modal {
  constructor(plugin, task) {
    super(plugin.app);
    this.plugin = plugin;
    this.task = task;
    const start = validDate(task.meta.when) ? task.meta.when : dayKey(new Date());
    const hasDeadline = validDate(task.meta.deadline),
      initial = hasDeadline ? task.meta.deadline : start;
    this.rule = JSON.parse(
      JSON.stringify(
        task.meta.repeat || {
          mode: 'regular',
          unit: 'week',
          interval: 1,
          anchor: initial,
          next: initial,
          on: [{ weekday: date(initial).getDay() }],
          end: null,
          deadline: hasDeadline,
          leadDays: hasDeadline ? Math.max(0, daysBetween(start, initial)) : 0,
        },
      ),
    );
    this.rule.anchor = this.rule.next || dayKey(new Date());
  }
  onOpen() {
    this.modalEl.addClass('ot-repeat-modal');
    this.setTitle('Repeat');
    removeModalCloseButton(this.modalEl);
    this.draw();
  }
  draw() {
    const root = this.contentEl,
      focused = root.contains(document.activeElement) ? document.activeElement : null,
      focusLabel = focused?.getAttribute('aria-label'),
      focusText = focused?.textContent;
    root.empty();
    const r = this.rule;
    const modes = root.createDiv('ot-repeat-modes');
    for (const [value, label] of [
      ['completion', 'After Completion'],
      ['regular', 'Regularly'],
    ]) {
      const b = button(modes, label, () => {
        r.mode = value;
        if (value === 'completion') r.end = null;
        this.draw();
      });
      b.setAttribute('aria-pressed', String(r.mode === value));
    }
    root.createEl('p', {
      cls: 'ot-repeat-explanation',
      text:
        r.mode === 'completion'
          ? 'A new copy appears after the previous to-do is completed.'
          : 'A new copy appears on schedule, whether or not the previous one is completed.',
    });
    const every = root.createDiv('ot-repeat-field');
    every.createSpan({ text: r.mode === 'completion' ? 'Repeat after' : 'Every' });
    const interval = every.createEl('input', {
      attr: { type: 'number', min: '1', max: '999', 'aria-label': 'Repeat interval' },
    });
    interval.value = r.interval;
    interval.oninput = () => {
      r.interval = Number(interval.value);
      for (const o of every.querySelector('select').options)
        o.textContent = o.value + (r.interval === 1 ? '' : 's');
      this.preview();
    };
    select(
      every,
      'Repeat unit',
      ['day', 'week', 'month', 'year'].map((unit) => [unit, unit + (r.interval === 1 ? '' : 's')]),
      r.unit,
      (value) => {
        r.unit = value;
        r.on = patternOnDate(value, r.anchor);
        this.draw();
      },
    );
    if (r.mode === 'regular' && r.unit !== 'day') {
      const patterns = root.createDiv('ot-repeat-patterns');
      for (const [index, p] of r.on.entries()) {
        const row = patterns.createDiv('ot-repeat-pattern');
        row.createSpan({ text: index ? 'and' : 'On' });
        if (r.unit === 'year')
          select(
            row,
            'Month ' + (index + 1),
            months.map((m, i) => [i + 1, m]),
            p.month,
            (v) => {
              p.month = Number(v);
              this.preview();
            },
          );
        if (r.unit !== 'week')
          select(
            row,
            'Day pattern ' + (index + 1),
            [
              ['date', 'day of month'],
              ['ordinal', 'weekday'],
            ],
            p.ordinal != null ? 'ordinal' : 'date',
            (v) => {
              if (v === 'ordinal') {
                delete p.day;
                p.ordinal = 1;
                p.weekday = 1;
              } else {
                delete p.ordinal;
                delete p.weekday;
                p.day = 1;
              }
              this.draw();
            },
          );
        if (r.unit === 'week' || p.ordinal != null) {
          if (r.unit !== 'week')
            select(
              row,
              'Week position ' + (index + 1),
              [
                [1, 'first'],
                [2, 'second'],
                [3, 'third'],
                [4, 'fourth'],
                [5, 'fifth'],
                [-1, 'last'],
              ],
              p.ordinal,
              (v) => {
                p.ordinal = Number(v);
                this.preview();
              },
            );
          select(
            row,
            'Weekday ' + (index + 1),
            [1, 2, 3, 4, 5, 6, 0].map((n) => [n, weekdays[n]]),
            p.weekday,
            (v) => {
              p.weekday = Number(v);
              this.preview();
            },
          );
        } else
          select(
            row,
            'Day of month ' + (index + 1),
            [...Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]), [-1, 'last day']],
            p.day,
            (v) => {
              p.day = Number(v);
              this.preview();
            },
          );
        if (r.on.length > 1) {
          const remove = button(row, '−', () => {
            r.on.splice(index, 1);
            this.draw();
          });
          remove.setAttribute('aria-label', 'Remove repeat day ' + (index + 1));
        }
      }
      button(
        patterns,
        '+ Add day',
        () => {
          r.on.push(
            r.unit === 'week'
              ? { weekday: 1 }
              : r.unit === 'month'
                ? { day: 1 }
                : { month: 1, day: 1 },
          );
          this.draw();
        },
        'ot-repeat-add',
      );
    }
    const waiting = r.mode === 'completion' && this.task.meta.repeat?.waitingFor;
    const next = root.createDiv('ot-repeat-field');
    next.createSpan({ text: 'Next' });
    if (waiting) next.createSpan({ text: 'After the current copy is completed' });
    else {
      this.dateButton(next, 'Next repeat date', r.anchor, (value) => {
        r.anchor = value;
        r.next = value;
      });
    }
    if (r.mode === 'regular') {
      const ends = root.createDiv('ot-repeat-field');
      ends.createSpan({ text: 'Ends' });
      select(
        ends,
        'Repeat ends',
        [
          ['never', 'Never'],
          ['date', 'On date'],
        ],
        r.end ? 'date' : 'never',
        (v) => {
          r.end = v === 'date' ? r.anchor : null;
          this.draw();
        },
      );
      if (r.end) {
        this.dateButton(ends, 'Repeat end date', r.end, (value) => {
          r.end = value;
        });
      }
    }
    const deadline = root.createEl('label', { cls: 'ot-repeat-deadline' }),
      check = deadline.createEl('input', {
        attr: { type: 'checkbox', 'aria-label': 'Add deadlines' },
      });
    check.checked = r.deadline;
    deadline.createSpan({ text: 'Add deadlines' });
    check.onchange = () => {
      r.deadline = check.checked;
      this.draw();
    };
    if (r.deadline) {
      const lead = root.createDiv('ot-repeat-field');
      lead.createSpan({ text: 'Start' });
      const n = lead.createEl('input', {
        attr: { type: 'number', min: '0', max: '3650', 'aria-label': 'Days earlier' },
      });
      n.value = r.leadDays;
      n.oninput = () => {
        r.leadDays = Number(n.value);
        this.preview();
      };
      lead.createSpan({ text: 'days earlier' });
    }
    this.previewEl = root.createDiv({ cls: 'ot-repeat-preview', attr: { 'aria-live': 'polite' } });
    this.preview();
    const actions = root.createDiv('ot-repeat-actions');
    button(actions, 'Cancel', () => this.close());
    const save = button(
      actions,
      'OK',
      async () => {
        try {
          validate(r);
          save.disabled = true;
          await this.plugin.repeating.configure(this.task, r);
          this.close();
        } catch (error) {
          save.disabled = false;
          this.previewEl.textContent = error.message;
          this.previewEl.setAttribute('role', 'alert');
        }
      },
      'mod-cta',
    );
    if (focused) {
      const controls = [...root.querySelectorAll('input,select,button')];
      (
        controls.find((el) =>
          focusLabel ? el.getAttribute('aria-label') === focusLabel : el.textContent === focusText,
        ) || controls[0]
      )?.focus();
    }
  }
  dateButton(parent, label, value, change) {
    const text = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date(value));
    const control = button(
      parent,
      text,
      () => {
        const existing = this.contentEl.querySelector('.ot-repeat-calendar');
        if (existing) {
          const same = existing.dataset.field === label;
          existing.remove();
          if (same) return;
        }
        const calendar = parent.createDiv('ot-repeat-calendar');
        calendar.dataset.field = label;
        require('../shared/date-picker.cjs').datePicker(calendar, {
          kind: 'date',
          value,
          setIcon,
          inline: true,
          allowClear: false,
          onSelect: (selected) => {
            change(selected);
            this.draw();
            this.contentEl.querySelector(`[aria-label="${label}"]`)?.focus();
          },
        });
      },
      'ot-repeat-date',
    );
    control.setAttribute('aria-label', label);
  }
  preview() {
    if (!this.previewEl) return;
    this.previewEl.removeAttribute('role');
    if (this.rule.mode === 'completion' && this.task.meta.repeat?.waitingFor) {
      this.previewEl.textContent =
        'The next date will be calculated when the current copy is completed.';
      return;
    }
    try {
      const r = this.rule;
      validate(r);
      let next = r.mode === 'completion' ? r.anchor : nextDate(r, r.anchor, true),
        dates = [];
      for (let i = 0; next && i < 4; i++) {
        dates.push(
          new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
            date(next),
          ),
        );
        next = nextDate(r, next);
      }
      this.previewEl.textContent =
        r.mode === 'completion'
          ? `First copy: ${dates[0]}. Further dates depend on completion.`
          : dates.join(' · ');
    } catch (error) {
      this.previewEl.textContent = error.message;
    }
  }
}
module.exports = RepeatDialog;
