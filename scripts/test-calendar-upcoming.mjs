import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { dayAfter } from '../plugin/shared/local-date.cjs';
import { assertCalendarLayout } from './calendar-layout.mjs';

const id = `upcoming-calendar-${Date.now()}`;
const dates = Array.from({ length: 9 }, (_, i) => dayAfter(i));
const icsDate = (offset) => dates[offset].replaceAll('-', '');
let version = 1,
  status = 200,
  empty = false,
  requests = 0;
const event = (uid, properties) => ['BEGIN:VEVENT', `UID:${uid}`, ...properties, 'END:VEVENT'];
const source = () =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'COLOR:tomato',
    ...(!empty
      ? [
          ...event('today', [`DTSTART:${icsDate(0)}T100000`, 'SUMMARY:Today only']),
          ...event('all', [`DTSTART;VALUE=DATE:${icsDate(1)}`, 'SUMMARY:All-day appointment']),
          ...event('recurring', [
            `DTSTART:${icsDate(1)}T103000`,
            'DURATION:PT1H',
            'RRULE:FREQ=DAILY;COUNT=2',
            `SUMMARY:Appointment ${version}`,
          ]),
          ...event('recurring', [
            `RECURRENCE-ID:${icsDate(2)}T103000`,
            `DTSTART:${icsDate(3)}T120000`,
            'DURATION:PT1H',
            'SUMMARY:Moved appointment',
          ]),
          ...(version === 1
            ? event('trip', [
                `DTSTART;VALUE=DATE:${icsDate(1)}`,
                `DTEND;VALUE=DATE:${icsDate(3)}`,
                'SUMMARY:Two-day trip',
              ])
            : []),
          ...event('seventh', [`DTSTART:${icsDate(7)}T090000`, 'SUMMARY:Seventh-day appointment']),
          ...event('outside', [`DTSTART:${icsDate(8)}T090000`, 'SUMMARY:Outside week']),
        ]
      : []),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
const server = createServer((req, res) => {
  requests++;
  res.writeHead(status, { 'Content-Type': 'text/calendar' });
  res.end(status === 200 ? source() : '');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
const { browser, page } = await connectTestVault();
let previous, previousMobile, taskId;
async function emulateMobile(value) {
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) === value) return;
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && window.app.plugins?.getPlugin('thingsmd')?._loaded,
  );
}
const section = (offset) => page.locator(`.ot-section[data-date="${dates[offset]}"]`);
const titles = (offset) => section(offset).locator('.ot-calendar-title').allTextContents();
async function refreshFromPalette() {
  const before = requests;
  assert.equal(
    await page.evaluate(() => app.commands.executeCommandById('command-palette:open')),
    true,
  );
  const prompt = page.locator('.prompt');
  await prompt.locator('.prompt-input').fill('Refresh calendars');
  const command = prompt
    .locator('.suggestion-item')
    .filter({ hasText: /ThingsMD\s*Refresh calendars/ });
  await command.waitFor();
  assert.equal(await command.count(), 1);
  await command.click();
  await prompt.waitFor({ state: 'detached' });
  await waitForAsync(page, () => !app.plugins.getPlugin('thingsmd').calendar.pending.size);
  assert.ok(requests > before, 'Palette command refreshes even before the interval expires');
}
try {
  previousMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
  await emulateMobile(false);
  await page.evaluate(() => app.setting.close());
  await page.setViewportSize({ width: 1200, height: 900 });
  previous = await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.calendars);
  taskId = await page.evaluate(
    async ({ id, url, date }) => {
      const p = app.plugins.getPlugin('thingsmd');
      app.secretStorage.setSecret(`thingsmd-calendar-${id}`, url);
      await p.updateSettings({
        calendars: [
          { id, name: 'Upcoming test', secretName: `thingsmd-calendar-${id}`, enabled: true },
        ],
      });
      await p.calendar.refreshAll(true);
      const task = await p.createTask({ title: 'Upcoming calendar task', when: date });
      await p.openList('upcoming');
      return task.meta.id;
    },
    { id, url, date: dates[1] },
  );
  await section(1).locator('.ot-calendar-event').first().waitFor();
  assert.deepEqual(await titles(1), ['All-day appointment', 'Two-day trip', 'Appointment 1']);
  assert.deepEqual(await titles(2), ['Two-day trip']);
  assert.deepEqual(await titles(3), ['Moved appointment']);
  assert.deepEqual(await titles(7), ['Seventh-day appointment']);
  assert.equal(await section(4).locator('.ot-calendar').innerText(), '');
  assert.equal(
    await section(4)
      .locator('.ot-calendar')
      .evaluate((el) => el.getBoundingClientRect().height),
    0,
    'An empty feed has no layout height, including inherited date-picker padding',
  );
  assert.equal(await page.locator('.ot-calendar-empty').count(), 0);
  assert.equal(
    await page
      .locator('.ot-calendar-title')
      .filter({ hasText: /Today only|Outside week/ })
      .count(),
    0,
  );
  assert.equal(await page.getByRole('button', { name: 'Refresh calendars' }).count(), 0);
  assert.equal(await page.locator('.ot-calendar input, .ot-calendar [role=option]').count(), 0);
  assert.equal(
    await section(1).evaluate((el) => {
      const calendar = el.querySelector('.ot-calendar');
      const group = el.querySelector('.ot-group');
      return (
        getComputedStyle(calendar).backgroundColor === 'rgba(0, 0, 0, 0)' &&
        getComputedStyle(calendar).paddingTop === '0px' &&
        getComputedStyle(el.querySelector('.ot-day-heading')).borderBottomStyle === 'none' &&
        calendar.nextElementSibling === group &&
        calendar.getBoundingClientRect().bottom <= group.getBoundingClientRect().top
      );
    }),
    true,
  );
  await assertCalendarLayout(page);
  const requestCount = requests;
  await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.openList('today');
    await p.openList('upcoming');
  });
  assert.equal(requests, requestCount, 'Switching views respects the refresh interval');
  await page.getByRole('option', { name: 'Upcoming calendar task', exact: true }).dblclick();
  const input = page.locator('.ot-title-input');
  await input.fill('Upcoming draft survives refresh');
  version = 2;
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.refreshAll(true));
  await section(1).getByText('Appointment 2', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), 'Upcoming draft survives refresh');
  assert.equal(await input.evaluate((el) => el === document.activeElement), true);
  assert.deepEqual(await titles(2), [], 'Removed events disappear without replacing the editor');
  await input.press('Escape');
  await waitForAsync(
    page,
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .title === 'Upcoming draft survives refresh',
    taskId,
  );
  status = 503;
  await refreshFromPalette();
  await page.locator('.ot-calendar-status').filter({ hasText: 'HTTP 503' }).waitFor();
  assert.equal(await page.locator('.ot-calendar-status').count(), 1);
  assert.deepEqual(await titles(1), ['All-day appointment', 'Appointment 2']);
  for (const enabled of [false, true]) {
    await page.evaluate(async (enabled) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.updateSettings((s) => ({
        calendars: s.calendars.map((c) => ({ ...c, enabled, color: '#123456' })),
      }));
    }, enabled);
    await page.waitForFunction(
      (enabled) => !!document.querySelector('.ot-calendar-event') === enabled,
      enabled,
    );
    assert.equal(await page.getByRole('button', { name: 'Refresh calendars' }).count(), 0);
  }
  assert.equal(
    await section(1)
      .locator('.ot-calendar-time')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
    'rgb(18, 52, 86)',
  );
  status = 200;
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.refreshAll(true));
  await page.screenshot({ path: 'artifacts/calendar-upcoming-desktop.png' });
  await emulateMobile(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('upcoming'));
  await section(1).getByText('Appointment 2', { exact: true }).waitFor();
  assert.deepEqual(await titles(3), ['Moved appointment']);
  assert.equal(
    await page.locator('.ot-paper').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  assert.equal(
    await section(1)
      .locator('.ot-calendar')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  await refreshFromPalette();
  await assertCalendarLayout(page);
  await page.screenshot({ path: 'artifacts/calendar-upcoming-mobile.png' });
  empty = true;
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.refreshAll(true));
  assert.equal(await page.locator('.ot-calendar-event').count(), 0);
  assert.equal(await page.locator('.ot-calendar-empty').count(), 0);
  assert.equal(
    await page
      .getByRole('option', { name: 'Upcoming draft survives refresh', exact: true })
      .count(),
    1,
  );
  console.log(
    'PASS real Obsidian Upcoming: daily grouping, recurrence/moves, task-free days, draft-safe refresh, errors/cache, visibility/colors, empty feeds; command-palette refresh on desktop and mobile emulation.',
  );
} finally {
  await page.keyboard.press('Escape');
  if (previousMobile !== undefined) await emulateMobile(previousMobile);
  await page.evaluate(
    async ({ id, previous, taskId }) => {
      const p = app.plugins.getPlugin('thingsmd');
      if (previous) await p.updateSettings({ calendars: previous });
      const task = (await p.taskRecords()).find((t) => t.meta.id === taskId);
      if (task) await p.deleteTask(task.file);
      app.secretStorage.deleteSecret(`thingsmd-calendar-${id}`);
      const folder = app.vault.getAbstractFileByPath(
        `${app.plugins.getPlugin('thingsmd').settings.tasksFolder}/Calendars/${id}`,
      );
      if (folder) await app.vault.delete(folder, true);
      await p.openList('upcoming');
    },
    { id, previous, taskId },
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
