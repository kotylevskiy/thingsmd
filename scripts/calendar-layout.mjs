import assert from 'node:assert/strict';

// Measure rendered text, not just line boxes: font leading hid both alignment bugs.
export async function assertCalendarLayout(page, selector = '.ot-paper') {
  const layout = await page.locator(selector).evaluate((root) => {
    const heading = root.querySelector('.ot-list-heading');
    const range = document.createRange();
    range.selectNodeContents(heading.querySelector('.inline-title'));
    const title = range.getBoundingClientRect();
    const icon = heading.querySelector('svg').getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d');
    const dateOffsets = [...root.querySelectorAll('.ot-day-heading')].map((day) => {
      const number = day.querySelector('.ot-day-number');
      const style = getComputedStyle(number);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const ink = context.measureText(number.textContent);
      const baseline = document.createElement('span');
      baseline.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      number.append(baseline);
      const top = baseline.getBoundingClientRect().top - ink.actualBoundingBoxAscent;
      baseline.remove();
      const separator = day.querySelector('.ot-day-separator').getBoundingClientRect();
      const label = day.querySelector('.ot-day-name').getBoundingClientRect();
      return {
        top: top - separator.top,
        left: separator.left - label.left,
        numberGap: separator.left - number.getBoundingClientRect().right,
        right: separator.right - day.getBoundingClientRect().right,
      };
    });
    const gaps = [...root.querySelectorAll('.ot-calendar[data-calendar-date]:not(:empty)')]
      .filter((calendar) => calendar.nextElementSibling?.querySelector('.ot-task'))
      .map(
        (calendar) =>
          calendar.nextElementSibling.getBoundingClientRect().top -
          calendar.getBoundingClientRect().bottom,
      );
    const indents = [
      ...root.querySelectorAll('.ot-calendar[data-calendar-date]:not(:empty)'),
    ].flatMap((calendar) => {
      const task = calendar.nextElementSibling?.querySelector('.ot-task');
      const checkbox = task?.querySelector('input[type=checkbox]');
      if (!checkbox) return [];
      const badge = task.querySelector('.ot-project-badge');
      return [
        {
          event: calendar.getBoundingClientRect().left - checkbox.getBoundingClientRect().left,
          badge: badge
            ? badge.getBoundingClientRect().left -
              task.querySelector('.ot-task-title').getBoundingClientRect().left
            : 0,
        },
      ];
    });
    return {
      indents,
      titleOffset: (title.top + title.bottom - icon.top - icon.bottom) / 2,
      dateOffsets,
      gaps,
    };
  });
  assert.ok(
    Math.abs(layout.titleOffset) <= 2,
    `Title/icon centers differ: ${JSON.stringify(layout)}`,
  );
  assert.ok(layout.indents.length > 0);
  assert.ok(
    layout.indents.every((indent) => Math.abs(indent.event) < 1 && Math.abs(indent.badge) < 1),
    `Calendar markers, checkboxes and project labels align: ${JSON.stringify(layout)}`,
  );
  assert.ok(layout.dateOffsets.length > 0);
  assert.ok(
    layout.dateOffsets.every(
      (offset) =>
        Math.abs(offset.top) <= 2 &&
        Math.abs(offset.left) < 1 &&
        offset.numberGap >= 7 &&
        Math.abs(offset.right) < 1,
    ),
    `Separators start at weekday labels, clear the number, and align with its top: ${JSON.stringify(layout)}`,
  );
  assert.ok(layout.gaps.length > 0, 'Fixture includes calendar events followed by a task');
  assert.ok(
    layout.gaps.every((gap) => gap >= 0 && gap <= 4.1),
    `Compact calendar/task gaps: ${JSON.stringify(layout)}`,
  );
  return layout;
}
