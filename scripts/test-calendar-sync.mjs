import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { testVault } from './test-vault.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { newSource } from '../plugin/calendar/identity.cjs';

const vault = await testVault();
const settingsPath = join(vault, '.obsidian/plugins/thingsmd/data.json');
const originalText = await readFile(settingsPath, 'utf8');
const original = JSON.parse(originalText);
if (original.calendars?.length)
  throw new Error('Calendar sync test requires an idle disposable vault.');
const now = new Date();
const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
const feed = (uid, title = `Source ${uid.toUpperCase()} event`) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `UID:calendar-${uid}`,
    'BEGIN:VEVENT',
    `UID:event-${uid}`,
    `DTSTART;VALUE=DATE:${day}`,
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
let holdNext = false,
  release;
const requests = [];
const server = createServer((req, res) => {
  const uid = req.url.slice(1);
  requests.push(uid);
  const send = (title) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end(feed(uid, title));
  };
  if (uid === 'a' && holdNext) {
    holdNext = false;
    release = () => send('Obsolete in-flight response');
  } else send();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { browser, page } = await connectTestVault();
const fixtures = [];
let previousMobile;
async function emulateMobile(value) {
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) === value) return;
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
}
async function receive(calendar) {
  const data = JSON.parse(await readFile(settingsPath, 'utf8'));
  await writeFile(settingsPath, JSON.stringify({ ...data, calendars: [calendar] }));
}
async function receiveCache(root, calendar, uid) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}_${randomUUID()}_s-${calendar.source.generation}.ics`;
  await writeFile(join(vault, root, calendar.id, name), feed(uid));
}

try {
  previousMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
  for (const mobile of [false, true]) {
    await emulateMobile(mobile);
    await page.bringToFront();
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 });
    const id = `sync-${Date.now()}`;
    const a = {
      id,
      name: 'Calendar sync fixture',
      secretName: id,
      enabled: true,
      source: await newSource(`${base}/a`, 'calendar-a'),
    };
    const b = { ...a, source: await newSource(`${base}/b`, 'calendar-b', randomUUID(), ['']) };
    const c = {
      ...a,
      name: 'Remotely updated calendar',
      source: await newSource(`${base}/c`, 'calendar-c', randomUUID(), ['', b.source.generation]),
    };
    const entry = { id };
    fixtures.push(entry);
    entry.root = await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.root);
    entry.task = await page.evaluate(
      async ({ a, url }) => {
        const p = app.plugins.getPlugin('thingsmd');
        app.secretStorage.setSecret(a.secretName, url);
        await p.updateSettings({ calendars: [a] });
        await p.calendar.refreshAll(true);
        const task = await p.createTask({ title: 'Sync draft fixture', when: 'today' });
        await p.openList('today');
        window.__thingsmdSyncInstance = p;
        return task.file.path;
      },
      { a, url: `${base}/a` },
    );
    const root = await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.root);
    entry.root = root;
    await page.getByRole('option', { name: 'Sync draft fixture', exact: true }).dblclick();
    const draft = page.locator('.ot-title-input');
    await draft.fill('Draft survives synced settings');
    holdNext = true;
    release = undefined;
    await page.evaluate(() => {
      window.__thingsmdSyncRequest = app.plugins.getPlugin('thingsmd').calendar.refreshAll(true);
    });
    const deadline = Date.now() + 8000;
    while (!release && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(release, 'Old-source request is in flight');
    await receiveCache(root, b, 'b');
    await receive(b);
    await waitForAsync(
      page,
      (generation) =>
        app.plugins.getPlugin('thingsmd').settings.calendars[0]?.source.generation === generation,
      b.source.generation,
    );
    assert.equal(
      await page.evaluate(
        () => app.plugins.getPlugin('thingsmd') === window.__thingsmdSyncInstance,
      ),
      true,
      'External settings apply without reloading the plugin',
    );
    assert.equal(await draft.inputValue(), 'Draft survives synced settings');
    assert.equal(await draft.evaluate((el) => el === document.activeElement), true);
    release();
    release = undefined;
    await page.evaluate(() => window.__thingsmdSyncRequest);
    await waitForAsync(page, () => !app.plugins.getPlugin('thingsmd').calendar.pending.size);
    await page.locator('.ot-calendar-title').filter({ hasText: 'Source B event' }).waitFor();
    assert.equal(await page.evaluate((id) => app.secretStorage.getSecret(id), id), `${base}/a`);
    assert.match(
      await page.evaluate(
        () => app.plugins.getPlugin('thingsmd').calendar.today().statuses[0].error,
      ),
      /does not match/,
    );
    assert.equal(
      await page.evaluate(() =>
        app.plugins
          .getPlugin('thingsmd')
          .calendar.today()
          .events.some((e) => e.title === 'Obsolete in-flight response'),
      ),
      false,
    );
    await draft.press('Escape');
    await waitForAsync(
      page,
      async (path) =>
        (await app.vault.adapter.read(path)).includes('Draft survives synced settings'),
      entry.task,
    );

    // An immediate local edit must read the new disk binding, even before polling runs.
    await receiveCache(root, c, 'c');
    await receive(c);
    await page.evaluate(() =>
      app.plugins.getPlugin('thingsmd').updateSettings((settings) => ({
        calendars: settings.calendars.map((calendar) => ({ ...calendar, color: 'tomato' })),
      })),
    );
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
    assert.equal(saved.calendars[0].source.generation, c.source.generation);
    assert.equal(saved.calendars[0].color, 'tomato');
    await waitForAsync(page, () => !app.plugins.getPlugin('thingsmd').calendar.pending.size);
    await page.locator('.ot-calendar-title').filter({ hasText: 'Source C event' }).waitFor();
    const goodText = await readFile(settingsPath, 'utf8');
    await writeFile(settingsPath, '{');
    const requestCount = requests.length;
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.refreshAll(true));
    assert.equal(requests.length, requestCount, 'Incomplete settings prevent network refresh');
    assert.equal(
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendar.today().events[0].title),
      'Source C event',
    );
    assert.match(
      await page.evaluate(
        () => app.plugins.getPlugin('thingsmd').calendar.today().statuses[0].error,
      ),
      /temporarily unavailable/,
    );
    await writeFile(settingsPath, goodText);
    await waitForAsync(page, () => !app.plugins.getPlugin('thingsmd').calendar.settingsError);
    // Reconnect through the actual Save URL flow. A raw SecretStorage edit can
    // race the recovery download and intentionally invalidate that old request;
    // the UI transaction waits for it and then refreshes with the new link.
    await page.evaluate(() => {
      app.setting.open();
      app.setting.openTabById('thingsmd');
    });
    const settings = await settingsPage(page);
    await settings.bringToFront();
    await settings.getByRole('button', { name: 'Configure calendar', exact: true }).click();
    const dialog = settings.locator('.ot-calendar-configure');
    await dialog.getByLabel('Subscription URL', { exact: true }).fill(`${base}/c`);
    await dialog.getByRole('button', { name: 'Save URL', exact: true }).click();
    await dialog.getByText('The subscription URL is saved securely on this device.').waitFor();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.evaluate(() => app.setting.close());
    await page.bringToFront();
    assert.equal(
      await page.evaluate(
        () => app.plugins.getPlugin('thingsmd').calendar.today().statuses[0].error,
      ),
      '',
    );
    await page.screenshot({ path: `artifacts/calendar-sync-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.evaluate(async ({ id, task, root }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.updateSettings({ calendars: [] });
      app.secretStorage.deleteSecret(id);
      for (const path of [task, `${root}/${id}`]) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file, true);
      }
    }, entry);
    await writeFile(settingsPath, originalText);
  }
  console.log(
    'PASS real Obsidian desktop/mobile emulation: external settings apply without restart, stale in-flight responses are discarded, local edits preserve synced sources, partial sync pauses refresh, local secrets and task drafts are preserved.',
  );
} finally {
  release?.();
  await writeFile(settingsPath, originalText);
  if (previousMobile !== undefined) await emulateMobile(previousMobile);
  await page.evaluate(async (entries) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.syncCalendarSettings();
    for (const leaf of app.workspace.getLeavesOfType('thingsmd-project-view'))
      await leaf.view.finishTask?.();
    for (const { id, task, root } of entries) {
      app.secretStorage.deleteSecret(id);
      for (const path of [task, root && `${root}/${id}`]) {
        const file = path && app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file, true);
      }
    }
    delete window.__thingsmdSyncInstance;
    delete window.__thingsmdSyncRequest;
    await p.open();
  }, fixtures);
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
