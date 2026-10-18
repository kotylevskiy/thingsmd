import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';

const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = `Deferred tabs ${Date.now()}`;
const note = `${prefix}.md`;
const wasMobile = await page.evaluate(() => !!localStorage.getItem('EmulateMobile'));
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
let settings;
try {
  settings = await page.evaluate(() => ({ ...app.plugins.getPlugin('thingsmd').settings }));
  for (const mobile of [false, true]) {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1100, height: 850 });
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== mobile) {
      const origin = await page.evaluate(() => performance.timeOrigin);
      await page.evaluate((mobile) => app.emulateMobile(mobile), mobile);
      await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
      await ready();
    }
    const fixture = await page.evaluate(
      async ({ prefix, note }) => {
        const workspace = app.workspace,
          plugin = app.plugins.getPlugin('thingsmd');
        const dormant = workspace.getLeaf('tab');
        // Obsidian's own restore path creates a DeferredView for a hidden tab
        // when its saved state supplies the title and icon. No view is mocked.
        dormant.containerEl.style.display = 'none';
        await dormant.setViewState({
          type: 'thingsmd-project-view',
          state: { page: 'waiting' },
          title: 'Waiting For',
          icon: 'send-horizontal',
          active: false,
        });
        const live = workspace.getLeaf('tab');
        await live.setViewState({
          type: 'thingsmd-project-view',
          state: { page: 'today' },
          active: true,
        });
        const task = await plugin.createTask(
          { title: `${prefix} task`, when: 'today' },
          undefined,
          'Original notes',
        );
        await live.view.render();
        if (!app.vault.getAbstractFileByPath(note))
          await app.vault.create(note, `Before\n\n![[${task.file.path.slice(0, -3)}]]\n\nAfter\n`);
        else
          await app.vault.modify(
            app.vault.getAbstractFileByPath(note),
            `Before\n\n![[${task.file.path.slice(0, -3)}]]\n\nAfter\n`,
          );
        window.deferredTabFixture = { dormant, live };
        return {
          id: task.meta.id,
          deferred: dormant.isDeferred,
          content: !!dormant.view.contentEl,
          beforeLive:
            workspace.getLeavesOfType('thingsmd-project-view').indexOf(dormant) <
            workspace.getLeavesOfType('thingsmd-project-view').indexOf(live),
        };
      },
      { prefix, note },
    );
    assert.equal(fixture.deferred, true, 'Create a real deferred Obsidian tab');
    assert.equal(fixture.content, false, 'Reproduce the absent contentEl from the report');
    assert.equal(fixture.beforeLive, true, 'The unloaded view is scanned before the active view');
    const active = page.locator('.workspace-leaf.mod-active');
    for (const mode of ['list', 'source', 'preview']) {
      await page.evaluate(
        async ({ mode, note }) => {
          const { live } = window.deferredTabFixture;
          if (mode === 'list')
            await live.setViewState({
              type: 'thingsmd-project-view',
              state: { page: 'today' },
              active: true,
            });
          else {
            await live.openFile(app.vault.getAbstractFileByPath(note));
            await live.setViewState({
              type: 'markdown',
              state: { file: note, mode, source: false },
              active: true,
            });
          }
        },
        { mode, note },
      );
      const row = active.locator(`.ot-task[data-task-id="${fixture.id}"]:visible`).first();
      if (mobile) await row.click();
      else await row.dblclick();
      await row
        .getByLabel('Task title', { exact: true })
        .fill(`${prefix} Draft preserved in ${mode}, mobile=${mobile}`);
      await row.getByRole('button', { name: 'Move', exact: true }).click();
      const move = page.locator('.ot-move-modal');
      await move.getByRole('button', { name: 'Inbox', exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.deferredTabFixture.dormant.isDeferred),
        true,
        'Move does not eagerly load background tabs',
      );
      await page.keyboard.press('Escape');
      await move.waitFor({ state: 'detached' });
      await row.click({ button: 'right' });
      await page.locator('.menu').getByText('Move…', { exact: true }).click();
      await move.getByRole('button', { name: 'Today', exact: true }).click();
      await move.waitFor({ state: 'detached' });
      const saved = await page.evaluate(
        async (id) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
        fixture.id,
      );
      assert.equal(saved.meta.title, `${prefix} Draft preserved in ${mode}, mobile=${mobile}`);
      assert.equal(saved.meta.when, 'today');
      console.log(
        `PASS deferred tabs: Move button, context menu and saved draft in ${mode}, mobile=${mobile}`,
      );
    }
    await page.evaluate(async () => {
      const plugin = app.plugins.getPlugin('thingsmd');
      await plugin.updateSettings({ enableWaiting: false });
      if (!window.deferredTabFixture.dormant.isDeferred)
        throw new Error('Settings eagerly loaded a background tab');
      await window.deferredTabFixture.dormant.loadIfDeferred();
      if (window.deferredTabFixture.dormant.view.page !== 'anytime')
        throw new Error('Restored Waiting For did not resolve to Anytime');
      window.deferredTabFixture.dormant.detach();
      window.deferredTabFixture.live.detach();
      delete window.deferredTabFixture;
      await plugin.updateSettings({ enableWaiting: true });
    });
  }
} finally {
  await page.keyboard.press('Escape');
  await page.evaluate(
    async ({ prefix, note, settings }) => {
      if (window.deferredTabFixture) {
        window.deferredTabFixture.dormant.detach();
        window.deferredTabFixture.live.detach();
        delete window.deferredTabFixture;
      }
      const plugin = app.plugins.getPlugin('thingsmd');
      if (settings) await plugin.updateSettings(settings);
      await plugin.openList('inbox');
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
      for (const task of await plugin.taskRecords())
        if (task.meta.title.startsWith(prefix)) await plugin.deleteTask(task.file);
    },
    { prefix, note, settings },
  );
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== wasMobile) {
    const origin = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate((mobile) => app.emulateMobile(mobile), wasMobile);
    await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
    await ready();
  }
  await browser.close();
}
