import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(10000);
const id = `note-controls-${Date.now()}`;
const project = `${id} project.md`;
let path, leafId;
const original = await page.evaluate(() => ({
  properties: app.vault.getConfig('propertiesInDocument'),
  waiting: app.plugins.getPlugin('thingsmd').settings.enableWaiting,
}));
const controls = () => page.locator('.workspace-leaf.mod-active .ot-task-note-controls:visible');
const saved = (predicate, args) => waitForAsync(page, predicate, { id, ...args });
try {
  ({ path, leafId } = await page.evaluate(
    async ({ id, project }) => {
      const p = app.plugins.getPlugin('thingsmd');
      await p.updateSettings({ enableWaiting: true });
      const t = await p.createTask(
        { title: 'Native task editor', custom: 'keep me' },
        id,
        '## Description\n\nPreserved paragraph.\n',
      );
      await app.vault.create(project, 'Project introduction.\n');
      const leaf = app.workspace.getLeaf('tab');
      await leaf.setViewState({
        type: 'markdown',
        state: { file: t.file.path, mode: 'source', source: false },
        active: true,
      });
      await app.workspace.revealLeaf(leaf);
      return { path: t.file.path, leafId: leaf.id };
    },
    { id, project },
  ));
  for (const mode of ['source', 'preview', 'raw']) {
    for (const properties of ['visible', 'source', 'hidden']) {
      console.log('Task note controls', { mode, properties });
      await page.evaluate(
        async ({ path, mode, properties }) => {
          app.vault.setConfig('propertiesInDocument', properties);
          await app.workspace.activeLeaf.setViewState({
            type: 'markdown',
            state: {
              file: path,
              mode: mode === 'preview' ? 'preview' : 'source',
              source: mode === 'raw',
            },
            active: true,
          });
        },
        { path, mode, properties },
      );
      await controls().getByRole('button', { name: 'When', exact: true }).waitFor();
      const layout = await controls().evaluate((root) => {
        const icons = root.querySelector('.ot-card-icons').getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        const heading = root
          .closest('.markdown-source-view, .markdown-preview-view')
          .querySelector('.ot-task-note-heading.is-inline')
          .getBoundingClientRect();
        const fields = root.querySelector('.ot-task-fields').getBoundingClientRect();
        return {
          left: icons.left - bounds.left,
          gap: icons.top - heading.bottom,
          afterChecklist: icons.top >= fields.bottom,
        };
      });
      assert.ok(Math.abs(layout.left) < 2, JSON.stringify(layout));
      assert.ok(layout.gap >= -1 && layout.gap <= 12, JSON.stringify(layout));
      assert.ok(layout.afterChecklist, JSON.stringify(layout));
      assert.equal(
        await page.locator('.workspace-leaf.mod-active .metadata-container:visible').count(),
        0,
      );
      assert.equal(
        await page
          .locator(
            '.workspace-leaf.mod-active .HyperMD-frontmatter:visible,.workspace-leaf.mod-active .mod-frontmatter:visible',
          )
          .count(),
        0,
      );
      await controls().getByRole('button', { name: 'Waiting For', exact: true }).click();
      await saved(
        async ({ id }) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)
            ?.meta.is_waiting === true,
      );
      assert.equal(
        await page.evaluate(() =>
          app.commands.commands['thingsmd:toggle-waiting'].checkCallback(false),
        ),
        true,
      );

      await saved(
        async ({ id }) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)
            ?.meta.is_waiting === false,
      );
      // Commands publish metadata before the native controls repaint. Do not
      // click the previous snapshot while switching the next properties mode.
      await page.waitForFunction(
        () =>
          document
            .querySelector('.workspace-leaf.mod-active .ot-task-note-controls .ot-waiting-toggle')
            ?.getAttribute('aria-pressed') === 'false',
      );
    }
  }
  await page.evaluate(
    async (path) =>
      app.workspace.activeLeaf.setViewState({
        type: 'markdown',
        state: { file: path, mode: 'source', source: false },
      }),
    path,
  );
  for (const [label, key, value] of [
    ['When', 'when', '2099-01-02'],
    ['Deadline', 'deadline', '2099-02-01'],
  ]) {
    await controls().getByRole('button', { name: label, exact: true }).click();
    const selected = value;
    await controls().getByLabel(`${label} date`, { exact: true }).fill(value);
    await controls().getByLabel(`${label} date`, { exact: true }).press('Enter');
    await saved(
      async ({ id, key, selected }) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta[
          key
        ] === selected,
      { key, selected },
    );
  }
  await controls().getByRole('button', { name: 'Checklist', exact: true }).click();
  await controls().getByLabel('Checklist text 1', { exact: true }).fill('First step');
  await saved(
    async ({ id }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .checklist?.[0]?.text === 'First step',
  );
  const order = await controls().evaluate((root) => {
    const checklist = root.querySelector('.ot-checklist').getBoundingClientRect();
    const icons = root.querySelector('.ot-card-icons').getBoundingClientRect();
    const dates = root.querySelector('.ot-card-badges').getBoundingClientRect();
    return {
      checklistBeforeIcons: checklist.bottom <= icons.top,
      iconsBeforeDates: icons.bottom <= dates.top,
    };
  });
  assert.ok(order.checklistBeforeIcons && order.iconsBeforeDates, JSON.stringify(order));
  // Write a native unsaved description, then update metadata through the controls.
  await page.evaluate(() => {
    const editor = app.workspace.activeLeaf.view.editor;
    const end = editor.offsetToPos(editor.getValue().length);
    editor.replaceRange('\nNative unsaved description\n', end);
    editor.setSelection(
      editor.offsetToPos(editor.getValue().indexOf('Native unsaved description')),
      editor.offsetToPos(editor.getValue().length - 1),
    );
    editor.focus();
  });
  await page.keyboard.press('Meta+b');
  await controls().getByRole('button', { name: 'Waiting For', exact: true }).click();
  await saved(
    async ({ id }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .is_waiting === true,
  );
  assert.ok(
    await page.evaluate(() =>
      app.workspace.activeLeaf.view.editor.getValue().includes('**Native unsaved description**'),
    ),
  );
  await page
    .locator('.workspace-leaf.mod-active .ot-task-note-heading.is-inline [role="checkbox"]')
    .click();
  await saved(
    async ({ id }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .status === 'done',
  );
  await controls().getByRole('button', { name: 'Move', exact: true }).click();
  await page
    .locator('.ot-move-modal')
    .getByRole('button', { name: project.slice(0, -3), exact: true })
    .click();
  await saved(
    async ({ path, project }) =>
      (await app.vault.read(app.vault.getFileByPath(project))).includes(path.slice(0, -3)),
    { path, project },
  );
  assert.equal(
    await page.evaluate(() => app.workspace.activeLeaf.view.file.path),
    path,
    'Move retains the task editor',
  );
  await controls().getByRole('button', { name: 'Repeat', exact: true }).click();
  await page.locator('.ot-repeat-modal').waitFor();
  await page.keyboard.press('Escape');
  const record = await page.evaluate(
    async (id) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
    id,
  );
  assert.equal(record.meta.custom, 'keep me');
  assert.ok(record.body.includes('Preserved paragraph.'));
  assert.ok(record.body.includes('**Native unsaved description**'));
  await page.screenshot({
    path: 'artifacts/task-note-controls-desktop.png',
  });
  // Hidden YAML cannot be selected/deleted through native description shortcuts.
  await page.evaluate(() => {
    const editor = app.workspace.activeLeaf.view.editor;
    editor.setCursor({ line: 0, ch: 0 });
    editor.focus();
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Replacement description');
  await page.evaluate(() => app.workspace.activeLeaf.view.save());
  await saved(async ({ id }) => {
    const task = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
      (t) => t.meta.id === id,
    );
    return task?.body === 'Replacement description' && task.meta.custom === 'keep me';
  });
  // Retain a conflicted checklist draft across navigation, without overwriting
  // the newer metadata or the native description.
  await controls().getByLabel('Checklist text 1', { exact: true }).focus();
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const card = [...p.taskNoteControllers].find((c) => c.taskDraft?.task.meta.id === id);
    card.taskDraft.values.checklist[0].text = 'Local checklist draft';
    const input = card.contentEl.querySelector('[aria-label="Checklist text 1"]');
    input.value = 'Local checklist draft';
    card.taskDraft.dirty = true;
    const current = (await p.taskRecords()).find((t) => t.meta.id === id);
    await p.patchTask(current, { checklist: [{ text: 'External checklist', done: false }] });
    await card.saveTaskDraft();
  }, id);
  await controls().getByRole('alert').waitFor();
  assert.equal(
    await controls().getByLabel('Checklist text 1', { exact: true }).inputValue(),
    'Local checklist draft',
  );
  await page.evaluate(
    async (project) => app.workspace.activeLeaf.openFile(app.vault.getFileByPath(project)),
    project,
  );
  await page.waitForFunction(
    () => !document.querySelector('.workspace-leaf.mod-active .ot-task-note-controls'),
  );
  await page.evaluate(
    async (path) => app.workspace.activeLeaf.openFile(app.vault.getFileByPath(path)),
    path,
  );
  await controls().getByRole('alert').waitFor();
  assert.equal(
    await controls().getByLabel('Checklist text 1', { exact: true }).inputValue(),
    'Local checklist draft',
  );
  await saved(
    async ({ id }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .checklist?.[0]?.text === 'External checklist',
  );
  await controls().getByRole('button', { name: 'Reload task', exact: true }).click();
  await waitForAsync(
    page,
    () =>
      document.querySelector(
        '.workspace-leaf.mod-active .ot-task-note-controls [aria-label="Checklist text 1"]',
      )?.value === 'External checklist',
  );
  // Keep repeat fixtures in the future so maintenance creates no extra copies.
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = (await p.taskRecords()).find((t) => t.meta.id === id);
    await p.patchTask(task, { when: '2099-01-02', deadline: '2099-02-01' });
  }, id);
  await controls().getByRole('button', { name: 'Repeat', exact: true }).click();
  await page.locator('.ot-repeat-modal').getByRole('button', { name: 'OK', exact: true }).click();
  await saved(
    async ({ id }) =>
      !!(await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .repeat,
  );
  await controls().getByRole('button', { name: 'Repeating rule', exact: true }).waitFor();
  assert.equal(await controls().getByLabel('Checklist item 1', { exact: true }).isDisabled(), true);
  await controls().getByRole('button', { name: 'Repeating rule', exact: true }).click();
  await page.getByText('Stop', { exact: true }).click();
  await saved(
    async ({ id }) =>
      !(await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .repeat,
  );
  // An ordinary note must retain Obsidian's Properties behavior.
  await page.evaluate(async (project) => {
    app.vault.setConfig('propertiesInDocument', 'visible');
    const f = app.vault.getFileByPath(project);
    await app.vault.process(f, (text) => '---\ncustom: normal note\n---\n' + text);
    await app.workspace.activeLeaf.openFile(f);
  }, project);
  await page.locator('.workspace-leaf.mod-active .metadata-container').waitFor();
  assert.equal(await controls().count(), 0);
  console.log(
    'PASS: task controls replace Properties in Live Preview, Source and Reading; native formatting/drafts, checklist, dates, waiting, completion, move, repeat, and ordinary notes.',
  );
} catch (error) {
  console.log(
    await page.evaluate(async (id) => {
      const p = app.plugins.getPlugin('thingsmd');
      const card = [...p.taskNoteControllers].find((c) => c.taskDraft?.task.meta.id === id);
      return {
        record: (await p.taskRecords()).find((t) => t.meta.id === id)?.meta,
        values: card?.taskDraft?.values,
        dirty: card?.taskDraft?.dirty,
        error: card?.taskDraft?.error,
        pressed: card?.contentEl.querySelector('.ot-waiting-toggle')?.getAttribute('aria-pressed'),
      };
    }, id),
  );
  throw error;
} finally {
  await page.evaluate(
    async ({ id, path, project, leafId, original }) => {
      app.vault.setConfig('propertiesInDocument', original.properties);
      const p = app.plugins.getPlugin('thingsmd');
      await p.updateSettings({ enableWaiting: original.waiting });
      app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.id === leafId) leaf.detach();
      });
      const copies = (await p.taskRecords()).filter((task) => task.meta.repeatSource === id);
      for (const target of [path, project, ...copies.map((task) => task.file.path)]) {
        const file = target && app.vault.getFileByPath(target);
        if (file) await app.vault.delete(file);
      }
    },
    { id, path, project, leafId, original },
  );
  await browser.close();
}
