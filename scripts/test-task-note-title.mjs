import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const id = `title-edit-${Date.now()}`;
const project = `${id}.md`;
let path;
const initial = await page.evaluate(() => ({
  mobile: !!localStorage.getItem('EmulateMobile'),
  width: innerWidth,
  height: innerHeight,
}));
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
  );
const mobile = async (value) => {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((value) => app.emulateMobile(value), value);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await ready();
};
const heading = () =>
  page.locator('.workspace-leaf.mod-active .inline-title.ot-task-note-title:visible');
const savedTitle = (value) =>
  waitForAsync(
    page,
    async ({ id, value }) =>
      (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)?.meta
        .title === value,
    { id, value },
  );
try {
  path = await page.evaluate(
    async ({ id, project }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const t = await p.createTask({ title: 'Original title' }, id, '**Preserved body**\n');
      await app.vault.create(project, `Before\n![[${t.file.path}]]\nAfter\n`);
      return t.file.path;
    },
    { id, project },
  );
  for (const emulate of [false, true]) {
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== emulate)
      await mobile(emulate);
    await page.setViewportSize(
      emulate ? { width: 390, height: 844 } : { width: 1100, height: 850 },
    );
    for (const mode of ['source', 'preview']) {
      console.log('Checking task title', { mobile: emulate, mode });
      await page.evaluate(
        async ({ path, mode }) => {
          const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
          await leaf.setViewState({
            type: 'markdown',
            state: { file: path, mode, source: false },
            active: true,
          });
        },
        { path, mode },
      );
      await heading().waitFor();
      assert.equal(
        await heading().evaluate(
          (el) =>
            getComputedStyle(el).fontSize ===
            getComputedStyle(el.parentElement.nextElementSibling).fontSize,
        ),
        true,
        'Task title retains the native title size',
      );
      for (const status of ['done', 'todo']) {
        const checkbox = page.locator(
          '.workspace-leaf.mod-active .ot-task-note-heading.is-inline [role="checkbox"]',
        );
        if (status === 'done') await checkbox.click();
        else await checkbox.press('Space');
        await waitForAsync(
          page,
          async ({ id, status }) =>
            (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id)
              ?.meta.status === status,
          { id, status },
        );
        assert.equal(await checkbox.getAttribute('aria-checked'), String(status === 'done'));
        const marker =
          status === 'done' ? '.ot-task-marker:checked' : '.ot-task-marker:not(:checked)';
        await page
          .locator(`.workspace-leaf.mod-active .ot-task-note-heading.is-inline ${marker}`)
          .waitFor();
        await page
          .locator(`.workspace-tab-header.is-active .ot-task-note-tab-icon ${marker}`)
          .waitFor({ state: emulate ? 'attached' : 'visible' });
        assert.equal(
          await heading().locator('svg').count(),
          0,
          'Status icon stays outside the editable title',
        );
      }

      const value = `Task title ${emulate} ${mode}`;
      await heading().fill(value);
      await heading().press('Enter');
      await savedTitle(value);
      await waitForAsync(
        page,
        (value) =>
          document.querySelector(
            '.workspace-tab-header.is-active:has(.ot-task-note-tab-icon) .workspace-tab-header-inner-title',
          )?.textContent === value,
        value,
      );
      if (!emulate) {
        const tab = page.locator('.workspace-tab-header.is-active:has(.ot-task-note-tab-icon)');
        assert.equal(await tab.getAttribute('aria-label'), null);
        const captionId = await tab.locator('.workspace-tab-header-inner-title').getAttribute('id');
        assert.equal(await tab.getAttribute('aria-labelledby'), captionId);
        await tab.hover();
        await page.waitForTimeout(1000);
        assert.equal(await page.locator('.tooltip:visible').filter({ hasText: value }).count(), 0);
        await page.mouse.move(0, 0);
      }
      assert.equal(
        await page
          .locator(
            '.workspace-leaf.mod-active .ot-task-note-heading:not(.is-inline) .ot-task-note-heading-icon',
          )
          .count(),
        0,
      );
      assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file.path), path);
      await heading().fill('Canceled title');
      await heading().press('Escape');
      assert.equal(await heading().innerText(), value);
      const header = page.locator(
        '.workspace-leaf.mod-active .view-header-title.ot-task-note-title',
      );
      const blurTarget = emulate ? heading() : header;
      await blurTarget.fill(value + ' blur');
      await blurTarget.press('Tab');
      await savedTitle(value + ' blur');
    }
  }
  await page.evaluate(async (path) => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.setViewState({
      type: 'markdown',
      state: { file: path, mode: 'source', source: false },
      active: true,
    });
    leaf.view.editor.setValue(leaf.view.editor.getValue() + '\nUnsaved notes');
  }, path);
  await heading().fill('Notes retained');
  await heading().press('Enter');
  await savedTitle('Notes retained');
  // External changes must not be overwritten by a stale title draft.
  await heading().fill('Local title draft');
  await page.evaluate(async (id) => {
    const p = app.plugins.getPlugin('thingsmd');
    const task = (await p.taskRecords()).find((t) => t.meta.id === id);
    await p.patchTask(task, { title: 'External title' });
  }, id);
  await heading().press('Enter');
  await page.locator('.workspace-leaf.mod-active .ot-task-title-error').waitFor();
  assert.equal(await heading().innerText(), 'Local title draft');
  await savedTitle('External title');
  // Recycled headings must not discard a conflicting title draft.
  await page.evaluate(async (project) => {
    await app.workspace.activeLeaf.openFile(app.vault.getFileByPath(project));
  }, project);
  await page.waitForTimeout(150);
  await page.evaluate(async (path) => {
    await app.workspace.activeLeaf.openFile(app.vault.getFileByPath(path));
  }, path);
  await heading().waitFor();
  assert.equal(await heading().innerText(), 'Local title draft');
  await page.locator('.workspace-leaf.mod-active .ot-task-title-error').waitFor();

  await heading().press('Escape');
  await waitForAsync(
    page,
    () =>
      document.querySelector('.workspace-leaf.mod-active .inline-title.ot-task-note-title')
        ?.textContent === 'External title',
  );
  const result = await page.evaluate(
    async ({ id, project }) => {
      const p = app.plugins.getPlugin('thingsmd');
      const task = (await p.taskRecords()).find((t) => t.meta.id === id);
      return { task, project: await app.vault.read(app.vault.getFileByPath(project)) };
    },
    { id, project },
  );
  assert.equal(result.task.file.path, path);
  assert.equal(result.task.body, '**Preserved body**\n\nUnsaved notes');
  assert.equal(result.project, `Before\n![[${path}]]\nAfter\n`);
  await page.evaluate(async (project) => {
    await app.plugins
      .getPlugin('thingsmd')
      .mainWorkspaceLeaf()
      .openFile(app.vault.getFileByPath(project));
  }, project);
  await waitForAsync(
    page,
    () => !document.querySelector('.workspace-leaf.mod-active .ot-task-note-title'),
  );
  // Navigation removes stale editors synchronously; the native tab decoration
  // follows the host's debounced render lifecycle.
  await page.locator('.workspace-tab-header.is-active .ot-task-note-tab-icon').waitFor({
    state: 'detached',
  });
  for (const mode of ['source', 'preview']) {
    await page.evaluate(async (mode) => {
      const leaf = app.workspace.activeLeaf;
      await leaf.setViewState({
        type: 'markdown',
        state: { file: leaf.view.file.path, mode, source: false },
        active: true,
      });
    }, mode);
    await page
      .locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]:visible`)
      .first()
      .waitFor();
    assert.ok(
      (
        await page
          .locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]:visible`)
          .first()
          .innerText()
      ).includes('External title'),
    );
  }
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
  await page.locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${id}"]`).waitFor();
  console.log(
    'PASS: editable heading/breadcrumb, Enter/blur save, Escape cancel, conflicts preserve drafts, ID paths/body/links unchanged; lists, Live Preview, Reading and mobile emulation.',
  );
} finally {
  await page.waitForFunction(() => window.app?.workspace?.layoutReady);
  await page.evaluate(
    async ({ id, project, path }) => {
      const p = app.plugins.getPlugin('thingsmd');
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if ([path, project].includes(leaf.view.file?.path)) leaf.detach();
      const task = (await p.taskRecords()).find((t) => t.meta.id === id);
      if (task) await p.deleteTask(task.file);
      const file = app.vault.getFileByPath(project);
      if (file) await app.vault.delete(file);
      await p.open();
    },
    { id, project, path },
  );
  if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== initial.mobile)
    await mobile(initial.mobile);
  await page.setViewportSize({ width: initial.width, height: initial.height });
  await browser.close();
}
