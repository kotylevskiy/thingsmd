import assert from 'node:assert/strict';
import { taskNoteContext } from './task-note-test-context.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const t = await taskNoteContext('matrix');
const { page, controls, heading, action, saved } = t;
const button = (name) => controls().getByRole('button', { name, exact: true });
const picker = () => page.locator('.ot-date-picker');
async function assertPanelFits(panel) {
  const bounds = await panel.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: innerWidth,
      overflow: el.scrollWidth > el.clientWidth + 1,
    };
  });
  assert.ok(
    bounds.left >= 0 && bounds.right <= bounds.viewport + 1 && !bounds.overflow,
    JSON.stringify(bounds),
  );
}
const screens = [
  { name: 'desktop', width: 1100, height: 850 },
  { name: 'small-phone', width: 320, height: 568, mobile: true },
  { name: 'phone', width: 390, height: 844, mobile: true, dark: true },
  { name: 'keyboard-height', width: 390, height: 440, mobile: true },
  { name: 'landscape', width: 844, height: 390, mobile: true, dark: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
];
async function dateInput(kind) {
  const input = picker().getByLabel(`${kind} date`, { exact: true });
  if (!(await input.isVisible()))
    await action(picker().getByLabel('Search dates', { exact: true }));
  return input;
}
try {
  for (const screen of screens.filter(
    (screen) => !process.env.THINGSMD_SCREEN || screen.name === process.env.THINGSMD_SCREEN,
  )) {
    await t.screen(screen);
    for (const mode of ['live', 'source', 'reading']) {
      console.log('Checking', screen.name, mode);
      const task = await t.create({ title: `${t.prefix} ${screen.name} ${mode}` });
      const id = task.meta.id;
      await t.open(task, mode);
      await t.geometry();
      // Run the complete workflow for each editor mode with mouse and touch.
      // Other widths exercise layout, overlays and hit targets without repeating writes.
      if (!['desktop', 'phone'].includes(screen.name)) {
        await page.evaluate(async (id) => {
          const p = app.plugins.getPlugin('thingsmd');
          const task = (await p.taskRecords()).find((task) => task.meta.id === id);
          await p.patchTask(task, {
            title: task.meta.title + ' long-title-'.repeat(12),
            checklist: [{ text: 'longword'.repeat(20), done: false }],
            when: '2099-05-20',
            deadline: '2099-06-02',
          });
        }, id);
        await controls().getByLabel('Checklist text 1', { exact: true }).waitFor();
        await t.geometry();
        await action(button('When'));
        await picker().waitFor();
        await assertPanelFits(picker());
        await action(picker().getByRole('button', { name: 'Cancel date selection', exact: true }));
        await action(button('Move'));
        await page.locator('.ot-move-modal').getByLabel('Find destination').waitFor();
        await assertPanelFits(page.locator('.ot-move-modal'));
        await page.keyboard.press('Escape');
        await action(button('Repeat'));
        await page.locator('.ot-repeat-modal').waitFor();
        await assertPanelFits(page.locator('.ot-repeat-modal'));
        await action(
          page.locator('.ot-repeat-modal').getByRole('button', { name: 'Cancel', exact: true }),
        );
        assert.equal((await t.record(id)).body, task.body);
        await page.screenshot({ path: `artifacts/task-note-matrix-${screen.name}-${mode}.png` });
        console.log('PASS task note layout:', screen.name, mode);
        continue;
      }
      const title = `${task.meta.title} ${'long-title-'.repeat(12)}`;
      await heading().fill(title);
      await heading().press('Enter');
      await saved(id, 'title', title);
      await heading().fill('Cancelled title');
      await heading().press('Escape');
      assert.equal(await heading().innerText(), title);
      const check = t.active.locator('.ot-task-note-heading.is-inline [role=checkbox]');
      await action(check);
      await saved(id, 'status', 'done');
      await check.press('Space');
      await saved(id, 'status', 'todo');
      await action(button('Checklist'));
      const first = controls().getByLabel('Checklist text 1', { exact: true });
      await first.fill('First ' + 'longword'.repeat(20));
      await first.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
      assert.equal(await controls().locator('.ot-checklist-row').count(), 1);
      await first.press('Enter');
      await controls().getByLabel('Checklist text 2', { exact: true }).fill('Second');
      await action(controls().getByLabel('Checklist item 2', { exact: true }));
      await controls()
        .getByRole('button', { name: 'Reorder checklist item 2', exact: true })
        .press('ArrowUp');
      assert.equal(
        await controls().getByLabel('Checklist text 1', { exact: true }).inputValue(),
        'Second',
      );
      await controls().getByLabel('Checklist text 2', { exact: true }).press('Enter');
      await controls().getByLabel('Checklist text 3', { exact: true }).press('Backspace');
      assert.equal(await controls().locator('.ot-checklist-row').count(), 2);
      await t.drag(
        controls().getByRole('button', { name: 'Reorder checklist item 1', exact: true }),
        controls().locator('.ot-checklist-row').nth(1),
      );
      assert.ok(
        (await controls().getByLabel('Checklist text 1', { exact: true }).inputValue()).startsWith(
          'First ',
        ),
      );
      await controls()
        .getByRole('button', { name: 'Reorder checklist item 2', exact: true })
        .press('ArrowUp');
      await action(button('Waiting For'));
      await saved(id, 'is_waiting', true);
      await action(button('Waiting For'));
      await saved(id, 'is_waiting', false);
      await action(button('When'));
      await action(picker().getByRole('button', { name: 'This Evening', exact: true }));
      await saved(id, 'when', 'today');
      assert.ok((await t.record(id)).meta.evening);
      await action(controls().getByRole('button', { name: 'This Evening', exact: true }));
      await action(picker().getByRole('button', { name: 'Someday', exact: true }));
      await saved(id, 'when', 'someday');
      await action(button('When'));
      const input = await dateInput('When');
      await input.fill('2026-02-31');
      await input.press('Enter');
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      await input.fill('2099-05-20');
      await input.press('Enter');
      await saved(id, 'when', '2099-05-20');
      await action(button('Deadline'));
      await (await dateInput('Deadline')).fill('2099-06-02');
      await (await dateInput('Deadline')).press('Enter');
      await saved(id, 'deadline', '2099-06-02');
      await action(button('When'));
      await action(picker().getByRole('button', { name: 'Clear schedule', exact: true }));
      await saved(id, 'when', 'anytime');
      await saved(id, 'deadline', '2099-06-02');
      await action(button('Deadline'));
      await action(picker().getByRole('button', { name: 'Remove deadline', exact: true }));
      await saved(id, 'deadline', null);
      await action(button('When'));
      if (screen.mobile)
        await action(picker().getByRole('button', { name: 'Cancel date selection', exact: true }));
      else await page.keyboard.press('Escape');
      await saved(id, 'when', 'anytime');
      await action(button('Repeat'));
      await action(
        page.locator('.ot-repeat-modal').getByRole('button', { name: 'Cancel', exact: true }),
      );
      await saved(id, 'repeat', null);
      const project = `${t.prefix} destination.md`;
      await page.evaluate(async (project) => {
        if (!app.vault.getFileByPath(project)) await app.vault.create(project, 'Before\n\nAfter\n');
      }, project);
      await action(button('Move'));
      const move = page.locator('.ot-move-modal');
      await move.getByLabel('Find destination').fill(t.prefix);
      await action(move.getByRole('button', { name: project.slice(0, -3), exact: true }));
      await saved(id, 'project', project);
      assert.equal(
        await page.evaluate(() => app.workspace.activeLeaf.view.file.path),
        task.file.path,
      );
      await action(button('Move'));
      await action(
        page.locator('.ot-move-modal').getByRole('button', { name: 'Inbox', exact: true }),
      );
      await saved(id, 'project', null);
      await waitForAsync(
        page,
        async ({ project, id }) =>
          !(await app.vault.read(app.vault.getFileByPath(project))).includes(id),
        { project, id },
      );
      assert.equal((await t.record(id)).body, task.body);
      assert.equal((await t.record(id)).meta.checklist[0].done, true);
      await page.evaluate(() =>
        app.plugins.getPlugin('thingsmd').updateSettings({ enableWaiting: false }),
      );
      await button('Waiting For').waitFor({ state: 'hidden' });
      await page.evaluate(() =>
        app.plugins.getPlugin('thingsmd').updateSettings({ enableWaiting: true }),
      );
      await button('Waiting For').waitFor();
      await page.evaluate(() => app.vault.setConfig('showInlineTitle', false));
      await action(button('Waiting For'));
      await saved(id, 'is_waiting', true);
      await page.evaluate(() => app.vault.setConfig('showInlineTitle', true));
      await heading().waitFor();
      await t.geometry();
      await page.screenshot({ path: `artifacts/task-note-matrix-${screen.name}-${mode}.png` });
      console.log('PASS task note controls:', screen.name, mode);
    }
  }
} catch (error) {
  console.error(error);
  console.log(
    await page.evaluate(() => ({
      popovers: [...document.querySelectorAll('.ot-popover')].map((el) =>
        el.outerHTML.slice(0, 1200),
      ),
      alerts: [...document.querySelectorAll('[role=alert]')].map((el) => el.textContent),
      focus: document.activeElement?.outerHTML.slice(0, 300),
      touch: window.noteTouch,
    })),
  );
  await page.screenshot({ path: 'artifacts/task-note-matrix-failure.png' });
  throw error;
} finally {
  await t.cleanup();
}
