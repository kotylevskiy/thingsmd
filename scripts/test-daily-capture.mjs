import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = `Daily capture ${Date.now()}`,
  folder = prefix;
let original;
const modal = page.locator('.ot-capture-modal'),
  title = modal.locator('.ot-title-input');
const capture = async (suffix) => {
  // Default-destination capture is separate from the current-project New task command.
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture());
  await title.fill(prefix + ' ' + suffix);
  await title.press('Enter');
};
try {
  original = await page.evaluate(
    async ({ folder }) => {
      const p = app.plugins.getPlugin('thingsmd'),
        daily = app.internalPlugins.getPluginById('daily-notes').instance;
      const original = { settings: { ...p.settings }, daily: { ...daily.options } };
      await app.vault.createFolder(folder);
      await app.vault.create(
        folder + '/Template.md',
        '# Daily {{date:YYYY-MM-DD}}\n\nTemplate content.\n',
      );
      daily.options = {
        ...daily.options,
        folder,
        format: 'YYYY/MM/YYYY-MM-DD',
        template: folder + '/Template.md',
      };
      const command = app.commands.commands['daily-notes'];
      command._captureOriginal = command.callback;
      command._captureCalls = 0;
      command.callback = async (...args) => {
        command._captureCalls++;
        return command._captureOriginal(...args);
      };
      await p.updateSettings({ captureDestination: 'daily-note' });
      return original;
    },
    { folder },
  );
  assert.equal(await page.locator('.ot-list-link[data-list="inbox"]').isVisible(), false);
  await capture('first');
  await modal.waitFor({ state: 'hidden' });
  const first = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd'),
      tasks = (await p.taskRecords()).filter((t) => t.meta.title.startsWith(prefix));
    const t = tasks[0];
    return {
      task: t,
      text: await app.vault.adapter.read(t.meta.project),
      calls: app.commands.commands['daily-notes']._captureCalls,
      settings: await p.loadData(),
    };
  }, prefix);
  assert.ok(first.task.meta.project.startsWith(folder + '/'));
  assert.match(first.text, /# Daily \d{4}-\d{2}-\d{2}/);
  assert.match(first.text, /Template content/);
  assert.ok(first.text.includes(first.task.meta.id));
  assert.equal(first.calls, 1);
  assert.equal(first.settings.captureDestination, 'daily-note');
  await capture('second');
  await modal.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => app.commands.commands['daily-notes']._captureCalls),
    1,
    'Existing daily note does not rerun creation command',
  );
  // Failed placement retains the draft and retries the same task rather than duplicating it.
  await page.evaluate(() => {
    const p = app.plugins.getPlugin('thingsmd');
    p._originalTransfer = p.transferTask;
    p.transferTask = async () => {
      p.transferTask = p._originalTransfer;
      throw new Error('Test placement failure');
    };
  });
  await capture('retry');
  await modal.getByRole('alert').waitFor();
  assert.equal(await title.inputValue(), prefix + ' retry');
  await title.press('Enter');
  await modal.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      async (prefix) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
          (t) => t.meta.title === prefix + ' retry',
        ).length,
      prefix,
    ),
    1,
  );
  // A missing configured folder must not create an orphan task or lose the draft.
  await page.evaluate(
    (folder) =>
      (app.internalPlugins.getPluginById('daily-notes').instance.options.folder =
        folder + '/missing'),
    folder,
  );
  await capture('bad folder');
  await modal.getByRole('alert').waitFor();
  assert.equal(
    await page.evaluate(
      async (prefix) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).filter(
          (t) => t.meta.title === prefix + ' bad folder',
        ).length,
      prefix,
    ),
    0,
  );
  await page.evaluate(
    (folder) => (app.internalPlugins.getPluginById('daily-notes').instance.options.folder = folder),
    folder,
  );
  await title.press('Enter');
  await modal.waitFor({ state: 'hidden' });
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
  const row = page
    .locator('.workspace-leaf.mod-active .ot-task')
    .filter({ hasText: prefix + ' first' });
  await row.click({ button: 'right' });
  await page.locator('.menu').getByText('Move…', { exact: true }).click();
  await page.locator('.ot-move-modal').getByLabel('Find destination').waitFor();
  assert.equal(
    await page
      .locator('.ot-move-modal')
      .getByRole('button', { name: 'Inbox', exact: true })
      .count(),
    0,
  );
  await page.keyboard.press('Escape');
  console.log(
    'PASS: saved capture destination, hidden Inbox, standard Daily notes command with configured folder/date/template, existing-note reuse, retry without duplicates, draft retention on failure, and Move destinations.',
  );
} finally {
  await page.evaluate(
    async ({ original, prefix, folder }) => {
      const p = app.plugins.getPlugin('thingsmd'),
        daily = app.internalPlugins.getPluginById('daily-notes').instance,
        command = app.commands.commands['daily-notes'];
      if (command._captureOriginal) {
        command.callback = command._captureOriginal;
        delete command._captureOriginal;
        delete command._captureCalls;
      }
      if (p._originalTransfer) {
        p.transferTask = p._originalTransfer;
        delete p._originalTransfer;
      }
      if (p.captureModal) {
        p.captureModal.card.taskDraft.values.title = '';
        p.captureModal.card.taskDraft.body = '';
        p.captureModal.card.taskDraft.values.checklist = [];
        await p.captureModal.close();
      }
      if (original) {
        daily.options = original.daily;
        await p.updateSettings(original.settings);
      }
      await p.open();
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path.startsWith(folder + '/')) leaf.detach();
      for (const t of await p.taskRecords())
        if (t.meta.title.startsWith(prefix)) await p.deleteTask(t.file);
      const f = app.vault.getAbstractFileByPath(folder);
      if (f) await app.vault.delete(f, true);
    },
    { original, prefix, folder },
  );
  await browser.close();
}
