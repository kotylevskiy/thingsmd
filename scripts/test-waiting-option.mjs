import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { connectTestVault, settingsPage } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const fixture = process.argv.includes('--fixture');
const browserType =
  process.env.THINGSMD_TEST_BROWSER === 'webkit'
    ? (await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core')).webkit
    : undefined;
const { browser, page } = fixture
  ? await browserFixture({ browserType })
  : await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = `Waiting option ${Date.now()}`;
const active = page.locator('.workspace-leaf.mod-active');
const capture = page.locator('.ot-capture-modal');
const toggle = (root) => root.getByRole('button', { name: 'Waiting For', exact: true });
let state;
const wasMobile = !fixture && (await page.evaluate(() => !!localStorage.getItem('EmulateMobile')));
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
    undefined,
    { timeout: 20000 },
  );
async function emulateMobile(mobile) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate((mobile) => app.emulateMobile(mobile), mobile);
  await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
  await ready();
}
const enabled = (enableWaiting) =>
  page.evaluate(
    (enableWaiting) => app.plugins.getPlugin('thingsmd').updateSettings({ enableWaiting }),
    enableWaiting,
  );
try {
  if (fixture) {
    await page.evaluate(() => {
      const Capture = window.loadPluginModule('./task-capture.cjs');
      window.waitingOptionPlugin = {
        settings: { enableWaiting: true },
        app: { workspace: {} },
        captureDestination: async () => null,
        createTask: async (meta, id, body) => {
          window.waitingOptionSaved = { meta, body };
          return window.waitingOptionSaved;
        },
      };
      window.captureWaitingOption = (fields) => {
        const p = window.waitingOptionPlugin;
        p.captureModal = new Capture(p, fields);
        p.captureModal.open();
      };
    });
    for (const mobile of [false, true]) {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1100, height: 850 },
      );
      await page.evaluate((mobile) => document.body.classList.toggle('is-mobile', mobile), mobile);
      for (const enableWaiting of [true, false]) {
        await page.evaluate((value) => {
          window.waitingOptionPlugin.settings.enableWaiting = value;
          window.captureWaitingOption({ is_waiting: true });
        }, enableWaiting);
        assert.equal(await toggle(capture).isVisible(), enableWaiting);
        await capture.getByLabel('Task title', { exact: true }).fill(prefix);
        await page.evaluate(() => {
          window.waitingOptionPlugin.settings.enableWaiting = false;
          window.waitingOptionPlugin.captureModal.card.refreshSettings();
        });
        assert.equal(await toggle(capture).isVisible(), false);
        for (const name of ['When', 'Checklist', 'Deadline', 'Repeat'])
          assert.ok(await capture.getByRole('button', { name, exact: true }).isVisible());
        await capture.getByRole('button', { name: 'Save', exact: true }).click();
        assert.equal(await page.evaluate(() => window.waitingOptionSaved.meta.is_waiting), true);
      }
    }
    console.log(
      'PASS waiting option fixture: desktop/mobile controls, live hiding, draft preservation and saving existing waiting status while disabled.',
    );
  } else {
    if (wasMobile) {
      await emulateMobile(false);
    }
    await page.setViewportSize({ width: 1100, height: 850 });
    state = await page.evaluate(async (prefix) => {
      const p = app.plugins.getPlugin('thingsmd');
      const settings = { ...p.settings };
      await p.updateSettings({ enableWaiting: true, showWaitingInToday: true });
      const tasks = [];
      for (const [title, fields] of [
        ['unfiled', {}],
        ['actionable', { when: 'anytime' }],
        ['today', { when: 'today' }],
        ['evening', { when: 'evening' }],
        ['future', { when: '2099-04-01', deadline: '2099-04-05' }],
        ['someday', { when: 'someday' }],
      ])
        tasks.push(
          await p.createTask({ title: `${prefix} ${title}`, is_waiting: true, ...fields }),
        );
      const note = `${prefix}.md`;
      await app.vault.create(
        note,
        `Before tasks.\n![[${tasks[1].file.path}]]\n![[${tasks[2].file.path}]]\nAfter tasks.\n`,
      );
      await p.openList('waiting');
      return { settings, tasks, note };
    }, prefix);
    const row = (index) =>
      active.locator(`.ot-task[data-task-id="${state.tasks[index].meta.id}"]:visible`);
    await row(0).waitFor();
    await page.evaluate(() => {
      app.setting.open();
      app.setting.openTabById('thingsmd');
    });
    const settings = await settingsPage(page);
    assert.equal(
      await settings
        .getByLabel('Enable Waiting For', { exact: true })
        .evaluate((el) => el.classList.contains('is-enabled')),
      true,
    );
    await settings.getByLabel('Enable Waiting For', { exact: true }).click();
    await waitForAsync(
      page,
      async () => (await app.plugins.getPlugin('thingsmd').loadData()).enableWaiting === false,
    );
    await settings
      .getByLabel('Group waiting tasks in Today', { exact: true })
      .waitFor({ state: 'detached' });
    await page.evaluate(() => app.setting.close());
    await active.getByRole('heading', { name: 'Anytime', exact: true }).waitFor();
    assert.equal(await page.locator('.ot-list-link[data-list="waiting"]').isVisible(), false);
    assert.equal(
      await page.evaluate(() => app.commands.commands['thingsmd:show-waiting'].checkCallback(true)),
      false,
    );
    for (const [list, index] of [
      ['inbox', 0],
      ['anytime', 1],
      ['today', 2],
      ['today', 3],
      ['upcoming', 4],
      ['someday', 5],
    ]) {
      await page.evaluate((list) => app.plugins.getPlugin('thingsmd').openList(list), list);
      await row(index).waitFor();
      assert.equal(await row(index).locator('.ot-waiting-marker').count(), 0);
      assert.equal(await active.locator('.ot-waiting-section').count(), 0);
    }
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
    await row(1).click();
    assert.equal(
      await page.evaluate(() =>
        app.commands.commands['thingsmd:toggle-waiting'].checkCallback(false),
      ),
      false,
    );
    await row(1).click({ button: 'right' });
    await page.locator('.menu').waitFor();
    assert.equal(
      await page
        .locator('.menu')
        .getByText(/^(Stop Waiting|Mark as Waiting)$/)
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    await row(1).dblclick();
    assert.equal(await toggle(row(1)).isVisible(), false);
    await row(1).getByLabel('Task title', { exact: true }).fill(`${prefix} actionable edited`);
    await enabled(true);
    await toggle(row(1)).waitFor();
    await enabled(false);
    await toggle(row(1)).waitFor({ state: 'hidden' });
    assert.equal(
      await row(1).getByLabel('Task title', { exact: true }).inputValue(),
      `${prefix} actionable edited`,
    );
    await row(1).getByLabel('Task title', { exact: true }).press('Enter');
    await row(1).locator('.ot-title-input').waitFor({ state: 'detached' });
    await row(1).click();
    await page.evaluate(() => app.commands.executeCommandById('thingsmd:task-anytime'));
    await waitForAsync(
      page,
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id).meta
          .is_waiting === true,
      state.tasks[1].meta.id,
    );
    await page.evaluate(
      (id) =>
        app.plugins
          .getPlugin('thingsmd')
          .openTaskMove(
            document.querySelector(`.workspace-leaf.mod-active [data-task-id="${id}"]`),
          ),
      state.tasks[1].meta.id,
    );
    await page.locator('.ot-move-modal').waitFor();
    await page
      .locator('.ot-move-modal')
      .getByRole('button', { name: 'Anytime', exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator('.ot-move-modal')
        .getByRole('button', { name: 'Waiting For', exact: true })
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(
      (query) => app.plugins.getPlugin('thingsmd').openSearch(query),
      prefix + ' actionable',
    );
    await page.locator('.ot-search-result').first().waitFor();
    assert.doesNotMatch(
      await page.locator('.ot-search-context').first().innerText(),
      /Waiting For/,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture({ when: 'today' }));
    assert.equal(await toggle(capture).isVisible(), false);
    await capture.getByLabel('Task title', { exact: true }).fill(prefix + ' capture');
    await capture.getByRole('button', { name: 'Save', exact: true }).click();
    await capture.waitFor({ state: 'hidden' });
    for (const mode of ['source', 'preview']) {
      await page.evaluate(
        async ({ note, mode }) => {
          const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
          await leaf.openFile(app.vault.getAbstractFileByPath(note));
          await leaf.setViewState({
            type: 'markdown',
            state: { file: note, mode, source: false },
            active: true,
          });
        },
        { note: state.note, mode },
      );
      await row(1).waitFor();
      assert.equal(await row(1).locator('.ot-waiting-marker').count(), 0);
      await row(1).dblclick();
      assert.equal(await toggle(row(1)).isVisible(), false);
      await row(1).getByLabel('Task notes', { exact: true }).fill('Preserved task notes');
      await enabled(true);
      await toggle(row(1)).waitFor();
      await enabled(false);
      await toggle(row(1)).waitFor({ state: 'hidden' });
      assert.equal(
        await row(1).getByLabel('Task notes', { exact: true }).inputValue(),
        'Preserved task notes',
      );
      await row(1).getByLabel('Task title', { exact: true }).press('Enter');
      await row(1).locator('.ot-title-input').waitFor({ state: 'detached' });
      await enabled(true);
      await row(1).locator('.ot-waiting-marker').waitFor();
      await enabled(false);
      await row(1).locator('.ot-waiting-marker').waitFor({ state: 'detached' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await emulateMobile(true);
    assert.equal(
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.enableWaiting),
      false,
      'Disabled setting survives reload',
    );
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('waiting'));
    await active.getByRole('heading', { name: 'Anytime', exact: true }).waitFor();
    await row(1).waitFor();
    assert.equal(await row(1).locator('.ot-waiting-marker').count(), 0);
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture({}));
    assert.equal(await toggle(capture).isVisible(), false);
    await capture.getByRole('button', { name: 'Cancel', exact: true }).click();
    await enabled(true);
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('waiting'));
    for (let index = 0; index < state.tasks.length; index++) await row(index).waitFor();
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('today'));
    await active.locator('.ot-waiting-section').waitFor();
    await page.screenshot({ path: 'artifacts/waiting-option-mobile.png' });
    const retained = await page.evaluate(
      async ({ ids, note, prefix }) => {
        const p = app.plugins.getPlugin('thingsmd');
        const tasks = await p.taskRecords();
        return {
          flags: ids.map((id) => tasks.find((t) => t.meta.id === id).meta.is_waiting),
          capture: tasks.find((t) => t.meta.title === prefix + ' capture').meta.is_waiting,
          note: await app.vault.adapter.read(note),
        };
      },
      { ids: state.tasks.map((t) => t.meta.id), note: state.note, prefix },
    );
    assert.deepEqual(
      retained.flags,
      state.tasks.map(() => true),
    );
    assert.equal(retained.capture, false);
    assert.ok(
      retained.note.startsWith('Before tasks.\n') && retained.note.endsWith('After tasks.\n'),
    );
    console.log(
      'PASS waiting option: settings, list fallback/membership, commands, menus, Move, search, capture, live draft preservation, Live Preview/Reading repaint, mobile reload and restored waiting flags.',
    );
  }
} finally {
  if (fixture) await page.evaluate(() => window.waitingOptionPlugin?.captureModal?.close());
  else {
    await ready();
    await page.evaluate(
      async ({ state, prefix }) => {
        app.setting.close();
        const p = app.plugins.getPlugin('thingsmd');
        await p.captureModal?.close();
        await p.openList('inbox');
        for (const task of await p.taskRecords())
          if (task.meta.title?.startsWith(prefix)) await p.deleteTask(task.file);
        if (state) {
          const file = app.vault.getAbstractFileByPath(state.note);
          if (file) await app.vault.delete(file);
          await p.updateSettings(state.settings);
        }
      },
      { state, prefix },
    );
    if ((await page.evaluate(() => !!localStorage.getItem('EmulateMobile'))) !== wasMobile)
      await emulateMobile(wasMobile);
    await ready();
  }
  await browser.close();
}
