import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { waitForAsync } from './wait-for-async.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
const { browser, page } = await browserFixture({
  browserType: webkit,
  pageOptions: { viewport: { width: 390, height: 844 }, hasTouch: true },
});
try {
  await page.evaluate(() => {
    document.body.classList.add('is-mobile');
    document.body.style.padding = '16px';
    window.record = {
      file: { path: 'ThingsMD/task.md' },
      meta: {
        type: 'thingsmd-task',
        id: 'task',
        title: 'Task',
        status: 'todo',
        custom: 'preserve',
        when: '2099-01-02',
        deadline: '2099-02-01',
      },
      body: 'Native body',
    };
    const containerEl = document.body.createDiv('view-content');
    containerEl.innerHTML =
      '<div class="markdown-source-view"><div class="cm-sizer"><div class="inline-title">Task</div><div class="metadata-container">Properties</div><div class="native-description" contenteditable="true">Native body</div></div></div>';
    const view = {
      containerEl,
      file: window.record.file,
      getMode: () => 'source',
      editor: { focus() {} },
    };
    window.controlsView = view;
    const plugin = {
      app: {},
      settings: { enableWaiting: true },
      renderTaskNotes() {
        throw Error('Task note must use native description');
      },
      patchTask: async (task, patch) => {
        for (const key of Object.keys(patch))
          if (
            JSON.stringify(task.meta[key] ?? null) !==
            JSON.stringify(window.record.meta[key] ?? null)
          )
            throw Error('Changed elsewhere');
        window.record = { ...window.record, meta: { ...window.record.meta, ...patch } };
        setTimeout(() => window.refreshControls(), 0);
        return structuredClone(window.record);
      },
      tasksChanged: () => setTimeout(() => window.refreshControls(), 0),
    };
    window.manager = window.loadPluginModule('./notes/task-note-controls.cjs')(plugin);
    window.refreshControls = () => {
      const live = new Set();
      window.manager.update(view, window.record.meta, live);
      window.manager.sweep(live);
    };
    window.refreshControls();
  });
  const root = page.getByRole('group', { name: 'Task controls' });
  await root.waitFor();
  assert.equal(await page.locator('.metadata-container').isVisible(), false);
  assert.equal(await root.locator('.ot-task-notes-preview').count(), 0);
  await root.getByRole('button', { name: 'Checklist', exact: true }).click();
  await root.getByLabel('Checklist text 1', { exact: true }).fill('First step');
  await waitForAsync(page, () => window.record.meta.checklist?.[0]?.text === 'First step');
  await root.getByRole('button', { name: 'Waiting For', exact: true }).evaluate((el) => {
    window.waitingControl = el;
  });
  await root.getByRole('button', { name: 'Waiting For', exact: true }).tap();
  await waitForAsync(page, () => window.record.meta.is_waiting === true);
  assert.equal(
    await page.evaluate(() => {
      window.refreshControls();
      return document.querySelector('.ot-waiting-toggle') === window.waitingControl;
    }),
    true,
    'Waiting saves keep the existing control in place',
  );
  // A command can restore the original metadata before a debounced host refresh.
  // The draft still needs reconciliation even when the last rendered snapshot matches.
  await root.evaluate(async (element) => {
    const refresh = window.refreshControls;
    window.refreshControls = () => {};
    try {
      const card = element._thingsmdCard;
      card.taskDraft.values.is_waiting = false;
      card.taskDraft.dirty = true;
      await card.flushTaskDraft();
      window.record.meta = { ...window.record.meta, is_waiting: true };
    } finally {
      window.refreshControls = refresh;
    }
    refresh();
  });
  assert.equal(
    await root
      .getByRole('button', { name: 'Waiting For', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator('.native-description').innerText(), 'Native body');
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [390, 440],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    const alignment = await root.evaluate((el) => {
      const icons = el.querySelector('.ot-card-icons').getBoundingClientRect();
      const fields = el.querySelector('.ot-task-fields').getBoundingClientRect();
      return {
        left: icons.left - el.getBoundingClientRect().left,
        afterChecklist: icons.top >= fields.bottom,
        beforeDates:
          icons.bottom <= el.querySelector('.ot-card-badges').getBoundingClientRect().top,
      };
    });
    assert.ok(
      Math.abs(alignment.left) < 2 && alignment.afterChecklist && alignment.beforeDates,
      JSON.stringify(alignment),
    );
    const geometry = await root.locator('.ot-card-icons button:visible').evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          label: button.getAttribute('aria-label'),
          left: r.left,
          right: r.right,
          width: innerWidth,
          clickable: !!hit && (hit === button || button.contains(hit)),
        };
      }),
    );
    for (const button of geometry) {
      assert.ok(button.left >= 0 && button.right <= button.width, JSON.stringify(button));
      assert.ok(button.clickable, JSON.stringify(button));
    }
  }
  // Recycled host DOM must not let an old task's controls act on navigation.
  await root.evaluate((element) => {
    window.controlsView.file = { path: 'Other.md' };
    element.querySelector('.ot-waiting-toggle').click();
  });
  assert.equal(await root.count(), 0);
  assert.equal(await page.evaluate(() => window.record.meta.is_waiting), true);
  await page.evaluate(() => window.manager.dispose());
  assert.equal(await root.count(), 0);
  assert.equal(await page.locator('.metadata-container').isVisible(), true);
  const reading = await page.evaluate(() => {
    const container = document.body.createDiv('ot-task-note-view');
    container.style.position = 'relative';
    container.innerHTML =
      '<div style="height:900px">Long checklist</div><div class="mod-frontmatter"><pre>Hidden properties</pre></div><p>Description</p>';
    const section = container.querySelector('.mod-frontmatter');
    const result = {
      offset: section.offsetTop,
      height: section.offsetHeight,
      properties: getComputedStyle(section.firstElementChild).display,
    };
    container.remove();
    return result;
  });
  assert.deepEqual(reading, { offset: 900, height: 0, properties: 'none' });
  console.log(
    'PASS WebKit mobile fixture: shared task controls, checklist/waiting saves, native description preservation, responsive action layout, Properties restoration.',
  );
} finally {
  await browser.close();
}
