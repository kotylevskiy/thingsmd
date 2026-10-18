import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
const { browser, page } = await browserFixture({
  browserType: webkit,
  pageOptions: { viewport: { width: 390, height: 844 }, hasTouch: true },
});
try {
  await page.evaluate(() => {
    window.loadPluginModule('obsidian').parseYaml = JSON.parse;
    window.loadPluginModule('obsidian').setIcon = (el, name) => {
      el.dataset.icon = name;
      el.innerHTML = '<svg width=24 height=24></svg>';
    };
    const split = document.body.createDiv('workspace-tabs');
    split.innerHTML =
      '<div class="workspace-tab-header-container"><div class="workspace-tab-header-container-inner"><div class="workspace-tab-header" aria-label="original tooltip"><div class="workspace-tab-header-inner-icon">original icon</div><div class="workspace-tab-header-inner-title">task-id</div></div></div></div><div class="workspace-tab-container"><div class="workspace-leaf"></div></div>';
    const containerEl = split.querySelector('.workspace-leaf').createDiv();
    containerEl.innerHTML =
      '<div class="inline-title" contenteditable="true">task-id</div><button>Body</button>';
    window.titleMeta = { type: 'thingsmd-task', id: 'task-id', title: 'Original' };
    const view = (window.titleView = {
      file: { path: 'ThingsMD/task-id.md' },
      containerEl,
      getMode: () => 'source',
      editor: { getValue: () => `---\n${JSON.stringify(window.titleMeta)}\n---\nBody` },
    });
    const plugin = {
      app: {
        workspace: {
          getLeavesOfType: () => [{ view }],
          on: (event, fn) => {
            window.refreshTitle = fn;
          },
          onLayoutReady: (fn) => fn(),
        },
        metadataCache: {
          getFileCache: () => {
            window.titleChecks = (window.titleChecks || 0) + 1;
            return { frontmatter: window.titleDiskMeta || window.titleMeta };
          },
          on() {},
        },
        vault: { on() {} },
      },
      patchTask: async (task, patch) => {
        window.titleWrites = (window.titleWrites || 0) + 1;
        if (task.meta.title !== window.titleMeta.title) throw Error('Changed elsewhere');
        window.titleMeta = { ...window.titleMeta, ...patch };
        return { meta: window.titleMeta };
      },
      registerEvent() {},
      registerDomEvent() {},
      register: (fn) => {
        window.unloadTitle = fn;
      },
    };
    window.loadPluginModule('./task-note-title.cjs')(plugin);
  });
  const heading = page.locator('.inline-title.ot-task-note-title');
  await heading.waitFor();
  const checks = await page.evaluate(() => {
    window.titleView.file = { path: 'ThingsMD/next-task.md' };
    window.titleDiskMeta = { type: 'thingsmd-task', id: 'next-task', title: 'Next task' };
    const checks = window.titleChecks;
    window.refreshTitle();
    return checks;
  });
  await page.waitForFunction((checks) => window.titleChecks > checks, checks);
  assert.equal(await heading.count(), 0, 'Do not render stale editor metadata for a new file');
  const projectChecks = await page.evaluate(() => {
    window.titleView.file = { path: 'Project.md' };
    window.titleDiskMeta = { type: 'thingsmd-project' };
    const checks = window.titleChecks;
    window.refreshTitle();
    return checks;
  });
  await page.waitForFunction((checks) => window.titleChecks > checks, projectChecks);
  assert.equal(await heading.count(), 0, 'Do not attach stale task controls to a project note');
  await page.evaluate(() => {
    window.titleView.file = { path: 'ThingsMD/next-task.md' };
    window.titleMeta = { type: 'thingsmd-task', id: 'next-task', title: 'Next task' };
    delete window.titleDiskMeta;
    window.refreshTitle();
  });
  await heading.getByText('Next task', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.titleView.file = { path: 'ThingsMD/task-id.md' };
    window.titleMeta = { type: 'thingsmd-task', id: 'task-id', title: 'Original' };
    window.refreshTitle();
  });
  await heading.getByText('Original', { exact: true }).waitFor();
  const tab = page.locator('.workspace-tab-header');
  assert.equal(await tab.getAttribute('aria-label'), null);
  assert.equal(
    await tab.getAttribute('aria-labelledby'),
    await page.locator('.workspace-tab-header-inner-title').getAttribute('id'),
  );
  for (const status of ['done', 'todo']) {
    const checkbox = page.getByRole('checkbox');
    if (status === 'done') await checkbox.tap();
    else await checkbox.press('Space');
    const icon = status === 'done' ? 'square-check' : 'square';
    await page.waitForFunction(
      (icon) =>
        document.querySelector('.ot-task-note-heading-icon')?.dataset.taskIcon === icon &&
        document.querySelector('.ot-task-note-tab-icon .ot-task-marker')?.checked ===
          (icon === 'square-check'),
      icon,
    );
    assert.equal(await heading.locator('*').count(), 0);
  }

  await page.evaluate(() => {
    window.titleMeta.repeat = { next: null };
    window.refreshTitle();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.ot-task-note-heading-icon')?.getAttribute('aria-disabled') ===
      'true',
  );
  const writes = await page.evaluate(() => window.titleWrites);
  await page.getByRole('checkbox').press('Space');
  await page.getByRole('checkbox').press('Enter');
  assert.equal(await page.evaluate(() => window.titleWrites), writes);
  await page.evaluate(() => {
    delete window.titleMeta.repeat;
    window.refreshTitle();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.ot-task-note-heading-icon')?.getAttribute('aria-disabled') ===
      'false',
  );

  await heading.fill('Plan <launch>');
  await heading.press('Enter');
  await page.waitForFunction(() => window.titleMeta.title === 'Plan <launch>');
  await page.waitForFunction(
    () =>
      document.querySelector('.workspace-tab-header-inner-title')?.textContent === 'Plan <launch>',
  );
  assert.equal(await heading.locator('*').count(), 0);
  await heading.fill('Cancel me');
  await heading.press('Escape');
  assert.equal(await heading.innerText(), 'Plan <launch>');
  await heading.fill('');
  await page.getByRole('button', { name: 'Body' }).click();
  await page.waitForFunction(() => window.titleMeta.title === '');
  assert.equal(
    await heading.evaluate((el) => getComputedStyle(el, '::before').content),
    '"Untitled task"',
  );
  await heading.fill('Keep draft');
  await page.evaluate(() => {
    window.titleMeta.title = 'External';
    window.refreshTitle();
  });
  await heading.press('Enter');
  await page.getByRole('alert').waitFor();
  assert.equal(await heading.innerText(), 'Keep draft');
  assert.equal(await page.evaluate(() => window.titleMeta.title), 'External');
  await page.evaluate(() => window.unloadTitle());
  assert.equal(await page.locator('.ot-task-note-title').count(), 0);
  assert.equal(await page.locator('.ot-task-note-tab-icon').count(), 0);
  assert.equal(await page.locator('.workspace-tab-header-inner-title').innerText(), 'task-id');
  assert.equal(await page.locator('.workspace-tab-header-inner-icon').innerText(), 'original icon');
  assert.equal(await tab.getAttribute('aria-label'), 'original tooltip');
  assert.equal(await tab.getAttribute('aria-labelledby'), null);
  assert.equal(await page.locator('.workspace-tab-header-inner-title').getAttribute('id'), null);
  assert.equal(await page.locator('.inline-title').innerText(), 'task-id');
  assert.equal(await page.locator('.inline-title').isVisible(), true);
  console.log(
    'PASS WebKit mobile fixture: editable title, safe text, save/cancel, empty title, conflict preservation and unload restoration.',
  );
} finally {
  await browser.close();
}
