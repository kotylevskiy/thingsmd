import assert from 'node:assert/strict';
import { connectTestVault, settingsPage as findSettingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const id = `folder-test-${Date.now()}`;
const project = `Folder test ${id}.md`;
const target = `Tasks test ${id}`;
let original;
const linkPreference = await page.evaluate(() => {
  const value = app.vault.getConfig('alwaysUpdateLinks');
  app.vault.setConfig('alwaysUpdateLinks', true);
  return value;
});
try {
  original = await page.evaluate(
    async ({ id, project }) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      plugin.publicMarkdownExperiment?.close();
      plugin.markdownExperiment?.close();
      const original = { ...plugin.settings };
      const adapter = app.vault.adapter;
      if (!(await adapter.exists('.thingsmd-storage'))) await adapter.mkdir('.thingsmd-storage');
      await adapter.write(
        `.thingsmd-storage/${id}.md`,
        `---\ntype: thingsmd-task\nid: ${id}\ntitle: Folder migration task\nstatus: todo\n---\n## Notes\n\n**Original body**\n`,
      );
      await app.vault.create(project, `# Project\n\nBefore\n![[.thingsmd-storage/${id}]]\nAfter\n`);
      await app.plugins.disablePlugin('thingsmd');
      await app.plugins.loadManifests();
      await app.plugins.enablePluginAndSave('thingsmd');
      await app.plugins.getPlugin('thingsmd').open();
      return original;
    },
    { id, project },
  );
  await waitForAsync(
    page,
    async ({ id, project }) => {
      const p = app.plugins.getPlugin('thingsmd');
      return (
        !!app.vault.getFileByPath(`${p.settings.tasksFolder}/${id}.md`) &&
        (await app.vault.read(app.vault.getFileByPath(project))).includes(
          `![[${p.settings.tasksFolder}/${id}]]`,
        ) &&
        !(await app.vault.adapter.exists(`.thingsmd-storage/${id}.md`))
      );
    },
    { id, project },
  );
  assert.equal(
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.tasksFolder),
    'ThingsMD',
  );
  const row = page.locator(`.nav-folder-title[data-path="ThingsMD"]`).first();
  await waitForAsync(
    page,
    () =>
      !!document
        .querySelector('.nav-folder-title[data-path="ThingsMD"]')
        ?.closest('.ot-task-folder-hidden'),
  );
  console.log('Checking explorer modes');
  for (const mode of ['normal', 'last', 'hidden']) {
    await page.evaluate(async (mode) => {
      await app.plugins.getPlugin('thingsmd').updateSettings({ tasksFolderDisplay: mode });
    }, mode);
    assert.equal(
      await row.evaluate((el) => getComputedStyle(el.closest('.nav-folder')).display === 'none'),
      mode === 'hidden',
    );
    if (mode === 'last')
      assert.equal(
        await row.evaluate((el) => getComputedStyle(el.closest('.nav-folder')).order),
        '1',
      );
  }
  await page.evaluate(() => {
    app.setting.open();
    app.setting.openTabById('thingsmd');
  });
  const settingsPage = await findSettingsPage(page);
  const tabOption = settingsPage.getByLabel('Open task notes in', { exact: true });
  await tabOption.selectOption('current');
  await waitForAsync(
    page,
    () => app.plugins.getPlugin('thingsmd').settings.taskNotesTab === 'current',
  );
  const folderInput = settingsPage.getByLabel('Tasks home folder', { exact: true });
  assert.equal(await settingsPage.getByRole('button', { name: 'Apply', exact: true }).count(), 0);
  for (const [folder, trigger] of [
    [target, 'Enter'],
    ['ThingsMD', 'Tab'],
    [target, 'Tab'],
  ]) {
    await folderInput.fill(folder);
    assert.notEqual(
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.tasksFolder),
      folder,
    );
    await folderInput.press(trigger);
    await waitForAsync(
      page,
      (folder) => app.plugins.getPlugin('thingsmd').settings.tasksFolder === folder,
      folder,
    );
    await waitForAsync(
      settingsPage,
      () => !document.querySelector('[aria-label="Tasks home folder"]').readOnly,
    );
    assert.equal(await folderInput.inputValue(), folder);
  }
  await page.evaluate(() => app.setting.close());
  await waitForAsync(
    page,
    async ({ id, target, project }) =>
      (await app.vault.read(app.vault.getFileByPath(project))).includes(`${target}/${id}`),
    { id, target, project },
  );
  // Task records must not appear a second time as projects.
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').records()).filter((r) => r.meta.id === id).length,
      id,
    ),
    1,
  );
  console.log('Checking native same-tab editing and navigation history');
  for (const mode of ['list', 'source', 'preview']) {
    await page.evaluate(
      async ({ mode, project, id }) => {
        const p = app.plugins.getPlugin('thingsmd');
        if (mode === 'list') {
          await p.openList('anytime');
          await p.mainWorkspaceLeaf().view.openTask(id);
        } else {
          const leaf = p.mainWorkspaceLeaf();
          await leaf.openFile(app.vault.getFileByPath(project));
          await leaf.setViewState({
            type: 'markdown',
            state: { file: project, mode, source: false },
            active: true,
          });
        }
      },
      { mode, project, id },
    );
    const card = page.locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]:visible`);
    if (mode !== 'list') await card.dblclick();
    await card
      .locator('.ot-task-notes-preview strong')
      .getByText('Original body', { exact: true })
      .waitFor();
    const previousLeaf = await page.evaluate(() => app.workspace.activeLeaf.id);
    for (const gesture of ['click']) {
      assert.equal(gesture, 'click');
      await card.locator('.ot-title-input').evaluate((el) => {
        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(event);
        if (event.defaultPrevented) throw Error('Cmd+Tab must remain unhandled');
      });
      await page.evaluate(() =>
        app.plugins.getPlugin('thingsmd').updateSettings({ taskNotesTab: 'new' }),
      );
      await card.locator('.ot-task-notes-preview').click();
      await waitForAsync(
        page,
        ({ target, id, previousLeaf }) =>
          !app.plugins.getPlugin('thingsmd').taskNotesOpening &&
          app.workspace.activeLeaf.id !== previousLeaf &&
          app.workspace.activeLeaf.view.file?.path === `${target}/${id}.md`,
        { target, id, previousLeaf },
      );
      await page.evaluate(async (previousLeaf) => {
        app.workspace.activeLeaf.detach();
        let original;
        app.workspace.iterateAllLeaves((leaf) => {
          if (leaf.id === previousLeaf) original = leaf;
        });
        await app.workspace.revealLeaf(original);
        app.workspace.setActiveLeaf(original, { focus: true });
      }, previousLeaf);
      await card.dblclick();
      await page.evaluate(() =>
        app.plugins.getPlugin('thingsmd').updateSettings({ taskNotesTab: 'current' }),
      );
      await card.locator('.ot-task-notes-preview').click({ modifiers: ['Meta'] });
      await waitForAsync(
        page,
        (previousLeaf) =>
          app.workspace.activeLeaf.id !== previousLeaf &&
          !app.plugins.getPlugin('thingsmd').taskNotesOpening,
        previousLeaf,
      );
      await page.evaluate(async (previousLeaf) => {
        app.workspace.activeLeaf.detach();
        let original;
        app.workspace.iterateAllLeaves((leaf) => {
          if (leaf.id === previousLeaf) original = leaf;
        });
        await app.workspace.revealLeaf(original);
        app.workspace.setActiveLeaf(original, { focus: true });
      }, previousLeaf);
      await card.dblclick();
    }
    await card.locator('.ot-title-input').focus();
    await page.keyboard.press('Tab');
    await waitForAsync(
      page,
      ({ target, id }) =>
        !app.plugins.getPlugin('thingsmd').taskNotesOpening &&
        app.workspace.activeLeaf?.view.file?.path === `${target}/${id}.md`,
      { target, id },
    );
    assert.equal(await page.evaluate(() => app.workspace.activeLeaf.id), previousLeaf);
    assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getMode()), 'source');
    if (mode === 'list') {
      await page.evaluate(() => {
        const editor = app.workspace.activeLeaf.view.editor;
        const offset = editor.getValue().length;
        editor.replaceRange('\nShortcut test\n', editor.offsetToPos(offset));
        editor.setSelection(editor.offsetToPos(offset + 1), editor.offsetToPos(offset + 14));
        editor.focus();
      });
      await page.keyboard.press('Meta+b');
      assert.equal(
        await page.evaluate(() =>
          app.workspace.activeLeaf.view.editor.getValue().includes('**Shortcut test**'),
        ),
        true,
        'Native Cmd+B formats the description',
      );
    }

    await page.evaluate(
      async ({ id, mode }) => {
        const view = app.workspace.activeLeaf.view;
        const text = view.editor.getValue();
        view.editor.setValue(text + `\nEdited from ${mode}\n`);
        // A metadata update must retain this unsaved native editor body.
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.id === id);
        await p.patchTask(task, { is_waiting: true });
        if (!view.editor.getValue().includes(`Edited from ${mode}`))
          throw Error('Draft overwritten');
        await view.save();
      },
      { id, mode },
    );
    await page.keyboard.press('Meta+Alt+ArrowLeft');
    await waitForAsync(
      page,
      ({ mode, project, previousLeaf }) => {
        const leaf = app.workspace.activeLeaf;
        return (
          leaf.id === previousLeaf &&
          (mode === 'list'
            ? leaf.view.page === 'anytime'
            : leaf.view.file?.path === project && leaf.view.getMode() === mode)
        );
      },
      { mode, project, previousLeaf },
    );
    await page.keyboard.press('Meta+Alt+ArrowRight');
    await waitForAsync(
      page,
      ({ target, id }) => app.workspace.activeLeaf.view.file?.path === `${target}/${id}.md`,
      { target, id },
    );
  }
  await page.evaluate(
    async ({ id, target }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.openList('anytime');
      const task = (await p.taskRecords()).find((t) => t.meta.id === id);
      await p.patchTask(task, { is_waiting: false });
      await p.changeTasksFolder('ThingsMD');
      // A destination collision must leave current storage unchanged.
      const text = await p.readTask(`ThingsMD/${id}.md`);
      await app.vault.create(`${target}/${id}.md`, text + '\nExternal content');
      let rejected = false;
      try {
        await p.changeTasksFolder(target);
      } catch {
        rejected = true;
      }
      if (!rejected || p.settings.tasksFolder !== 'ThingsMD')
        throw Error('Collision was not rejected');
      await app.vault.delete(app.vault.getFileByPath(`${target}/${id}.md`));
    },
    { id, target },
  );
  console.log(
    'Real Obsidian: migration, display modes, custom folder, collision safety, all three hosts, native-tab editing and unsaved buffer preservation passed.',
  );
} finally {
  await page.evaluate(
    async ({ id, project, target, original }) => {
      const p = app.plugins.getPlugin('thingsmd');
      if (!p) return;
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === project || leaf.view.file?.path.endsWith(`/${id}.md`))
          leaf.detach();
      for (const leaf of app.workspace.getLeavesOfType('thingsmd-project-view'))
        await leaf.view.finishTask?.();
      if (original?.tasksFolder && p.settings.tasksFolder !== original.tasksFolder)
        await p.changeTasksFolder(original.tasksFolder);
      for (const path of [project, `${p.settings.tasksFolder}/${id}.md`, `${target}/${id}.md`]) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file);
      }
      const folder = app.vault.getAbstractFileByPath(target);
      if (folder && !folder.children.length) await app.vault.delete(folder);
      if (original)
        await p.updateSettings({
          tasksFolderDisplay: original.tasksFolderDisplay || 'hidden',
          taskNotesTab: original.taskNotesTab,
        });
      await p.open();
    },
    { id, project, target, original },
  );
  await page.evaluate((value) => app.vault.setConfig('alwaysUpdateLinks', value), linkPreference);
  await browser.close();
}
