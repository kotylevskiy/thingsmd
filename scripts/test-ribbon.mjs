import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(5000);
const prefix = `Ribbon ${Date.now()}`;
const note = `${prefix}.md`;
const capture = page.locator('.ot-capture-modal');
let settings;
try {
  settings = await page.evaluate(async (note) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const settings = { ...plugin.settings };
    await plugin.updateSettings({
      captureDestination: 'inbox',
      enableWaiting: true,
      trashRetention: 'never',
    });
    await app.vault.create(note, 'Ribbon project\n');
    return settings;
  }, note);
  const buttons = page.locator('.side-dock-ribbon-action');
  assert.equal(await buttons.locator('svg.thingsmd-task-search').count(), 1);
  for (const context of [
    'empty',
    'inbox',
    'today',
    'upcoming',
    'anytime',
    'waiting',
    'someday',
    'logbook',
    'trash',
    'repeating',
    'source',
    'preview',
    'sidebar',
  ]) {
    await page.evaluate(
      async ({ context, note }) => {
        const plugin = app.plugins.getPlugin('thingsmd');
        if (context === 'sidebar') {
          await plugin.openList('today');
          const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
          app.workspace.setActiveLeaf(leaf, { focus: true });
        } else if (['source', 'preview', 'empty'].includes(context)) {
          const leaf = plugin.mainWorkspaceLeaf();
          await leaf.setViewState(
            context === 'empty'
              ? { type: 'empty', active: true }
              : {
                  type: 'markdown',
                  state: { file: note, mode: context, source: false },
                  active: true,
                },
          );
          app.workspace.setActiveLeaf(leaf, { focus: true });
        } else await plugin.openList(context);
      },
      { context, note },
    );
    await page.locator('.side-dock-ribbon-action[aria-label="New task"]').click();
    await capture.waitFor();
    await capture.getByLabel('Task title', { exact: true }).fill(`${prefix} ${context}`);
    await capture.getByRole('button', { name: 'Save', exact: true }).click();
    await capture.waitFor({ state: 'detached' });
    const tasks = await page.evaluate(
      async (title) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
          (t) => t.meta.title === title,
        ),
      `${prefix} ${context}`,
    );
    assert.equal(tasks.length, 1, `Ribbon saves one task from ${context}`);
    const meta = tasks[0].meta;
    assert.equal(meta.status, 'todo');
    assert.ok(!meta.deleted && !meta.repeat, 'Capture never inherits archive or template status');
    if (['today', 'anytime', 'someday'].includes(context)) assert.equal(meta.when, context);
    if (context === 'sidebar') assert.equal(meta.when, 'today');
    if (context === 'waiting') assert.equal(meta.is_waiting, true);
    if (context === 'upcoming') assert.match(meta.when, /^\d{4}-\d{2}-\d{2}$/);
    if (['empty', 'inbox', 'logbook', 'trash', 'repeating'].includes(context))
      assert.ok(!meta.when, `${context} falls back to Inbox capture`);
    if (['source', 'preview'].includes(context)) assert.equal(tasks[0].meta.project, note);
    console.log(`PASS New task ribbon from ${context}`);
    await page.locator('.side-dock-ribbon-action[aria-label="Quick Find tasks"]').click();
    const search = page.locator('.ot-search-modal');
    await search.getByLabel('Quick Find', { exact: true }).fill(`${prefix} ${context}`);
    await search
      .locator('.ot-search-result')
      .filter({ hasText: `${prefix} ${context}` })
      .waitFor();
    await page.keyboard.press('Escape');
    await search.waitFor({ state: 'detached' });
  }
  for (const context of ['empty', 'logbook', 'trash', 'repeating']) {
    await page.evaluate(async (context) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      if (context === 'empty')
        await plugin.mainWorkspaceLeaf().setViewState({ type: 'empty', active: true });
      else await plugin.openList(context);
    }, context);
    assert.equal(
      await page.evaluate(() => app.commands.executeCommandById('thingsmd:capture')),
      true,
    );
    await capture.waitFor();
    await capture.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  console.log(
    'PASS both ribbon buttons across all lists, empty tab, notes and sidebar; New task command from empty/archive views.',
  );
} finally {
  await page.evaluate(
    async ({ prefix, note, settings }) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      plugin.captureModal?.close();
      for (const task of await plugin.taskRecords())
        if (task.meta.title?.startsWith(prefix)) await plugin.deleteTask(task.file);
      if (settings) await plugin.updateSettings(settings);
      await plugin.open();
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
    },
    { prefix, note, settings },
  );
  await browser.close();
}
