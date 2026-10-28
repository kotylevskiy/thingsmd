import assert from 'node:assert/strict';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
let id, originalCalendars;
try {
  id = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = await p.createTask({ title: `Lifecycle ${Date.now()}` });
    await p.showRepeat(task.meta.id);
    await p.openUpcomingMove({ id: task.meta.id });
    return task.meta.id;
  });
  await page.locator('.ot-move-modal').waitFor();
  await page.locator('.ot-repeat-modal').waitFor();
  await page.evaluate(() => app.plugins.disablePlugin('thingsmd'));
  assert.equal(await page.locator('.ot-move-modal, .ot-repeat-modal, .ot-list-links').count(), 0);
  await page.evaluate(async () => {
    await app.plugins.enablePlugin('thingsmd');
    await app.plugins.getPlugin('thingsmd').openList('inbox');
  });
  assert.equal(await page.locator('.ot-list-links').count(), 1);
  const meta = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta,
    id,
  );
  assert.equal(meta.repeat, undefined);
  assert.equal(meta.when, undefined);
  originalCalendars = await page.evaluate(async () => {
    const p = app.plugins.getPlugin('thingsmd');
    const original = p.settings.calendars;
    await p.updateSettings({
      calendars: [{ id: 'lifecycle-calendar', name: 'Lifecycle calendar', enabled: false }],
    });
    return original;
  });
  for (const kind of ['create', 'configure']) {
    await page.evaluate(() => {
      app.setting.open();
      app.setting.openTabById('thingsmd');
    });
    const settings = await settingsPage(page);
    await settings.bringToFront();
    await settings
      .getByRole('button', {
        name: kind === 'create' ? 'Add calendar' : 'Configure calendar',
        exact: true,
      })
      .click();
    assert.equal(
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').calendarDialogs.size),
      1,
    );
    await page.evaluate(() => app.plugins.disablePlugin('thingsmd'));
    for (const candidate of page.context().pages())
      if (candidate.url().startsWith('app://'))
        assert.equal(
          await candidate.locator('.ot-calendar-create, .ot-calendar-configure').count(),
          0,
        );
    await page.evaluate(async () => {
      app.setting.close();
      await app.plugins.enablePlugin('thingsmd');
    });
  }
  console.log(
    'PASS: plugin unload closes Move/Repeat/calendar dialogs and removes sidebar links; reload restores exactly one sidebar and preserves the untouched task.',
  );
} finally {
  await page.evaluate(
    async ({ id, originalCalendars }) => {
      if (!app.plugins.getPlugin('thingsmd')) await app.plugins.enablePlugin('thingsmd');
      const p = app.plugins.getPlugin('thingsmd');
      if (originalCalendars) await p.updateSettings({ calendars: originalCalendars });
      app.setting.close();
      const task = (await p.taskRecords()).find((t) => t.meta.id === id);
      if (task) await p.deleteTask(task.file);
    },
    { id, originalCalendars },
  );
  await browser.close();
}
