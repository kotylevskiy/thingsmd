import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
const { browser, page } = await browserFixture();
try {
  await page.evaluate(() => {
    const Capture = window.loadPluginModule('./tasks/task-capture.cjs');
    window.savedTasks = [];
    window.plugin = {
      app: { workspace: {} },
      renderTaskNotes: window.renderTaskNotesFixture,
      captureDestination: async () => null,
      createTask: async (fields, id, body) => {
        if (window.failSave) throw Error('Simulated disk failure');
        const task = { meta: { ...fields, id: 'captured' }, body };
        window.savedTasks.push(task);
        return task;
      },
    };
    window.openCapture = () => {
      window.capture = new Capture(window.plugin, {});
      window.capture.open();
    };
  });
  for (const width of [390, 1100]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.openCapture());
    assert.equal(await page.locator('.modal-close-button').isVisible(), false);
    const title = page.getByLabel('Task title', { exact: true });
    const waiting = page.getByRole('button', { name: 'Waiting For', exact: true });
    assert.ok(
      await waiting.evaluate((el) => el.scrollWidth <= el.clientWidth),
      `Waiting icon fits the ${width}px capture toolbar`,
    );
    if (width === 390)
      assert.ok((await waiting.boundingBox()).height >= 44, 'Waiting has a mobile touch target');
    await title.fill('Waiting capture');
    await waiting.click();
    assert.equal(await waiting.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.modal').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.savedTasks.at(-1).meta.is_waiting), true);
    for (const action of ['Cancel', 'Escape', 'Control+Enter', 'Enter']) {
      const before = await page.evaluate(() => window.savedTasks.length);
      await page.evaluate(() => window.openCapture());
      await title.fill('Keyboard capture');
      await waiting.click();
      await waiting.click();
      assert.equal(await waiting.getAttribute('aria-pressed'), 'false');
      if (action === 'Cancel')
        await page.getByRole('button', { name: action, exact: true }).click();
      else await title.press(action);
      await page.locator('.modal').waitFor({ state: 'detached' });
      const expected = before + (action.includes('Enter') ? 1 : 0);
      assert.equal(await page.evaluate(() => window.savedTasks.length), expected);
    }
    await page.evaluate(() => {
      window.failSave = true;
      window.openCapture();
    });
    await title.fill('Retry me');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await title.inputValue(), 'Retry me');
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled(), true);
    await page.evaluate(() => {
      window.failSave = false;
    });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.modal').waitFor({ state: 'detached' });
  }
  await page.evaluate(() => {
    window.plugin.captureDestination = async () => 'Project.md';
    window.plugin.app.workspace.getLeavesOfType = () => [];
    window.plugin.transferTask = async () => {
      if (window.failPlacement) throw Error('Simulated placement failure');
    };
    window.plugin.taskRecords = async () => window.savedTasks;
    window.plugin.patchTask = async (task, fields, body) => {
      Object.assign(task.meta, fields);
      task.body = body;
      return task;
    };
    window.failPlacement = true;
    window.openCapture();
  });
  const beforePlacement = await page.evaluate(() => window.savedTasks.length);
  await page.getByLabel('Task title', { exact: true }).fill('Recover placement');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(() => window.savedTasks.length), beforePlacement + 1);
  await page.evaluate(() => {
    window.failPlacement = false;
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.modal').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => window.savedTasks.length),
    beforePlacement + 1,
    'Retrying placement must reuse the task already created',
  );
  // Exercise real MutationObserver delivery and production sidebar rendering.
  await page.evaluate(() => {
    const container = document.body.createDiv();
    const callbacks = [];
    const p = {
      settings: {},
      listLinks: new Set(),
      app: {
        workspace: {
          getLeavesOfType: () => [{ view: { containerEl: container } }],
          on: () => ({}),
          onLayoutReady() {},
        },
        vault: { on: () => ({}) },
      },
      records: async () => [],
      registerEvent() {},
      register: (callback) => callbacks.push(callback),
      registerDomEvent: (target, event, callback) => {
        target.addEventListener(event, callback);
        callbacks.push(() => target.removeEventListener(event, callback));
      },
    };
    window.sidebar = { p, container, callbacks };
    window.loadPluginModule('./sidebar.cjs')(p);
    p.mountListLinks();
    container.createDiv('nav-files-container');
  });
  await page.locator('.ot-list-links').waitFor();
  assert.equal(await page.locator('.ot-list-links').count(), 1);
  await page.evaluate(() => document.querySelector('.ot-list-links').remove());
  await page.locator('.ot-list-links').waitFor();
  await page.evaluate(() => {
    const { container } = window.sidebar;
    container.replaceChildren();
    container.createDiv('nav-files-container');
  });
  await page.locator('.ot-list-links').waitFor();
  assert.equal(await page.locator('.ot-list-links').count(), 1);
  await page.evaluate(() => window.sidebar.callbacks.forEach((callback) => callback()));
  // Render actual Inbox rows, process one, edit it again, and navigate away.
  await page.evaluate(async () => {
    const View = window.loadPluginModule('./lists/list-view.cjs');
    const tasks = [
      {
        meta: { type: 'thingsmd-task', id: 'a', title: 'Inbox fixture', status: 'todo' },
        body: '',
      },
    ];
    const p = {
      renderTaskNotes: window.renderTaskNotesFixture,
      settings: {},
      records: async () => tasks,
      mountListLinks() {},
    };
    const app = { workspace: { requestSaveLayout() {} } };
    const view = new View({ app, updateHeader() {} }, p);
    window.inbox = { tasks, view };
    await view.render();
    tasks[0].meta.when = 'today';
    await view.render();
  });
  await page.locator('.ot-inbox-moved').waitFor();
  await page.locator('.ot-inbox-moved .ot-task').dblclick();
  await page.getByLabel('Task title', { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { view } = window.inbox;
    await view.finishTask(false);
    await view.navigate('today');
    await view.navigate('inbox');
  });
  assert.equal(await page.locator('.ot-inbox-moved').count(), 0);
  console.log(
    'PASS: desktop/mobile capture controls, waiting toggle, keyboard save/cancel, save failure/retry, real sidebar DOM recovery, editable temporary Inbox rows and navigation reset.',
  );
} finally {
  await browser.close();
}
