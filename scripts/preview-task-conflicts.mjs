// Deliberately leaves synthetic preview content in a marked disposable vault.
// Run after deploy/dev:open. This is a review demo, not the full UI test suite.
import assert from 'node:assert/strict';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const output = resolve('artifacts/task-conflicts');
await mkdir(output, { recursive: true });
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
let previousMobile;
const active = page.locator('.workspace-leaf.mod-active');
async function emulateMobile(value) {
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) === value) return;
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
}
try {
  previousMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
  await emulateMobile(false);
  const demo = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const marker = '.thingsmd-conflict-preview.json';
    if (await app.vault.adapter.exists(marker))
      return JSON.parse(await app.vault.adapter.read(marker));
    await plugin.updateSettings({ timeZone: 'Europe/Moscow', enableWaiting: true });
    const day = (offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const today = day(0),
      tomorrow = day(1);
    const tasks = [];
    const make = async (id, title, meta = {}, copyName, copyPatch = {}) => {
      const task = await plugin.createTask(
        { title, order: tasks.length * 1024, ...meta },
        `preview-${id}`,
        'Synthetic preview content. No personal vault data.\n',
      );
      const entry = { id: task.meta.id, path: task.file.path };
      if (copyName) {
        // JSON is a YAML subset and does not require Obsidian's plugin-only
        // module loader in the renderer's development harness.
        const text = `---\n${JSON.stringify({ ...task.meta, ...copyPatch })}\n---\nOffline preview notes retained for review.\n`;
        entry.copy = `${plugin.settings.tasksFolder}/${copyName}.md`;
        await app.vault.create(entry.copy, text);
      }
      tasks.push(entry);
      return task;
    };
    const launch = await make(
      'launch',
      'Review the launch plan',
      { when: today },
      'preview-launch (conflicted copy Laptop)',
      { title: 'Review the launch plan and budget' },
    );
    await make('demo', 'Prepare the customer demo', { when: today });
    await make(
      'follow-up',
      'Send the client follow-up',
      { when: today },
      'preview-follow-up.sync-conflict-20261106-Device',
      { when: tomorrow },
    );
    await make('feedback', 'Collect customer feedback', {}, 'preview-feedback (2)', {
      title: 'Collect customer feedback from the pilot',
    });
    await make('notes', 'Sort the workshop notes');
    await make(
      'update',
      'Share the launch update',
      { when: tomorrow },
      'preview-update_Desktop_20261106_Conflict',
      { when: today },
    );
    await make('someday', 'Explore a customer workshop', { when: 'someday' });
    const weekly = await make('weekly-copy', 'Weekly project review', { when: tomorrow });
    await make(
      'weekly',
      'Weekly project review',
      {
        repeat: {
          mode: 'completion',
          unit: 'week',
          interval: 1,
          anchor: today,
          next: null,
          on: [],
          end: null,
          deadline: false,
          leadDays: 0,
          epoch: 'preview',
          waitingFor: weekly.meta.id,
          lastCopy: weekly.meta.id,
          paused: false,
        },
      },
      'preview-weekly (another device)',
    );
    const project = 'Conflict preview.md';
    await app.vault.create(
      project,
      `# Conflict preview\n\nThis disposable note shows the same task in Live Preview and Reading view.\n\n![[${launch.file.path.slice(0, -3)}]]\n\nAll extra copies are preserved.\n`,
    );
    const data = { tasks, project, today, tomorrow };
    await app.vault.adapter.write(marker, JSON.stringify(data));
    return data;
  });

  // Serve a real local ICS fixture, so screenshots use the normal calendar path.
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ThingsMD Preview//EN',
    'UID:conflict-preview-calendar',
    'NAME:Preview meetings',
    ...[
      [demo.today, '103000', 'Design review'],
      [demo.today, '140000', 'Customer check-in'],
      [demo.tomorrow, '110000', 'Launch planning'],
    ].flatMap(([date, time, title], index) => [
      'BEGIN:VEVENT',
      `UID:preview-meeting-${index}`,
      `DTSTART:${date.replaceAll('-', '')}T${time}`,
      'DURATION:PT30M',
      `SUMMARY:${title}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  await writeFile(resolve(output, 'meetings.ics'), ics);
  const calendarUrl = 'http://127.0.0.1:9240/meetings.ics';
  let serving = await fetch(calendarUrl)
    .then((r) => r.ok)
    .catch(() => false);
  if (!serving) {
    const log = await open(resolve(output, 'calendar-server.log'), 'a');
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';
       createServer(async(req,res)=>{try{const body=await readFile(process.env.THINGSMD_PREVIEW_ICS);
       res.writeHead(200,{'Content-Type':'text/calendar'});res.end(body);}catch{res.writeHead(500);res.end();}}).listen(9240,'127.0.0.1');`,
      ],
      {
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, THINGSMD_PREVIEW_ICS: resolve(output, 'meetings.ics') },
      },
    );
    child.unref();
    await log.close();
    await writeFile(
      resolve(output, 'calendar-server.json'),
      JSON.stringify({ pid: child.pid, url: calendarUrl }),
    );
    for (let attempt = 0; attempt < 30 && !serving; attempt++) {
      await new Promise((done) => setTimeout(done, 100));
      serving = await fetch(calendarUrl)
        .then((r) => r.ok)
        .catch(() => false);
    }
    assert.ok(serving, 'Local preview calendar server started');
  }
  await page.evaluate(async (url) => {
    const p = app.plugins.getPlugin('thingsmd');
    app.secretStorage.setSecret('thingsmd-conflict-preview', url);
    await p.updateSettings({
      calendars: [
        {
          id: 'conflict-preview',
          name: 'Preview meetings',
          secretName: 'thingsmd-conflict-preview',
          enabled: true,
          refreshMinutes: 10080,
          color: '#7c6cdb',
        },
      ],
    });
    await p.calendar.refreshAll(true);
  }, calendarUrl);

  const before = await page.evaluate(async (tasks) => {
    const result = {};
    for (const task of tasks)
      if (task.copy) result[task.copy] = await app.vault.adapter.read(task.copy);
    return result;
  }, demo.tasks);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.mouse.move(0, 0);
  for (const list of ['today', 'inbox', 'upcoming', 'repeating', 'someday']) {
    await page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
    await active.locator('.ot-paper h1').waitFor();
    const notice = active.locator('.ot-paper > .ot-task-conflict-notice');
    if (list === 'someday') assert.equal(await notice.count(), 0);
    else {
      await notice.waitFor();
      assert.equal(await notice.count(), 1);
      assert.ok(
        await active.locator('.ot-paper').evaluate((el) => {
          const warning = el.querySelector('.ot-task-conflict-notice');
          const next = el.querySelector(
            '.ot-calendar, .ot-calendar-errors, .ot-group, .ot-section',
          );
          return !!(warning.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
        }),
        'Warning precedes calendar and task content',
      );
    }
    if (list === 'today') await active.locator('.ot-calendar-event').first().waitFor();
    await page.screenshot({ path: resolve(output, `${list}-desktop.png`) });
  }
  // Interactive check: canonical saves still work, and copies remain unchanged.
  await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = (await p.taskRecords()).find((t) => t.meta.id === 'preview-launch');
    await p.patchTask(task, { title: 'Review the launch plan — ready' });
    const fresh = (await p.taskRecords()).find((t) => t.meta.id === 'preview-launch');
    await p.patchTask(fresh, { title: 'Review the launch plan' });
  });
  for (const mode of ['source', 'preview']) {
    await page.evaluate(
      async ({ file, mode }) => {
        const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
        await leaf.setViewState({
          type: 'markdown',
          state: { file, mode, source: false },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
      },
      { file: demo.project, mode },
    );
    const card = active.locator('.ot-native:visible');
    await card.locator('.ot-task-conflict-notice').waitFor();
    await card
      .locator('.ot-task-title')
      .getByText('Review the launch plan', { exact: true })
      .waitFor();
    assert.equal(await card.locator('.ot-task').count(), 1);
    await page.screenshot({
      path: resolve(output, `${mode === 'source' ? 'live-preview' : 'reading'}-desktop.png`),
    });
  }
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  const disclosure = active.locator('.ot-task-conflict-details');
  await disclosure.locator('summary').click();
  await page.screenshot({ path: resolve(output, 'review-copies-desktop.png') });
  // Exercise an actual review link, then return without editing its document.
  const oldLeaf = await page.evaluate(() => app.workspace.activeLeaf.id);
  await disclosure.locator('a').first().click();
  await page.waitForFunction((id) => app.workspace.activeLeaf.id !== id, oldLeaf);
  await page.evaluate((id) => {
    const opened = app.workspace.activeLeaf;
    const original = app.workspace.getLeafById(id);
    app.workspace.setActiveLeaf(original, { focus: true });
    opened.detach();
  }, oldLeaf);

  await emulateMobile(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await active.locator('.ot-task-conflict-notice').waitFor();
  await active.locator('.ot-calendar-event').first().waitFor();
  assert.ok(
    await active
      .locator('.ot-task-conflict-notice')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await page.screenshot({ path: resolve(output, 'today-mobile.png') });
  await active.locator('.ot-task-conflict-details summary').click();
  assert.ok(
    await active
      .locator('.ot-task-conflict-notice')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await page.screenshot({ path: resolve(output, 'review-copies-mobile.png') });
  await emulateMobile(previousMobile);
  await waitForAsync(
    page,
    async (before) => {
      for (const [path, text] of Object.entries(before))
        if ((await app.vault.adapter.read(path)) !== text) return false;
      return true;
    },
    before,
  );
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
  await writeFile(
    resolve(output, 'preview.json'),
    JSON.stringify(
      {
        vault: process.env.THINGSMD_TEST_VAULT,
        debugUrl: process.env.THINGSMD_DEBUG_URL,
        checks: [
          'one selected version per ID',
          'affected-list notices',
          'unaffected list has no notice',
          'notice before meetings',
          'selected-version writes',
          'extra copies preserved',
          'Live Preview and Reading cards',
          'review link',
          'mobile layout',
        ],
        demo,
      },
      null,
      2,
    ),
  );
  console.log(`Preview ready in ${process.env.THINGSMD_TEST_VAULT}. Screenshots: ${output}`);
} finally {
  if (previousMobile !== undefined) await emulateMobile(previousMobile);
  await browser.close();
}
