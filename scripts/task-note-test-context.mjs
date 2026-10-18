import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

// Each driver owns its fixtures and restores the host even after an assertion fails.
export async function taskNoteContext(label) {
  const { browser, page } = await connectTestVault();
  page.setDefaultTimeout(10000);
  const prefix = `Note ${label} ${Date.now()}`;
  const original = await page.evaluate(() => ({
    settings: { ...app.plugins.getPlugin('thingsmd').settings },
    properties: app.vault.getConfig('propertiesInDocument'),
    inlineTitle: app.vault.getConfig('showInlineTitle'),
    mobile: !!localStorage.getItem('EmulateMobile'),
    dark: document.body.classList.contains('theme-dark'),
  }));
  let touch,
    isMobile = original.mobile;
  const active = page.locator('.workspace-leaf.mod-active');
  const controls = () => active.locator('.ot-task-note-controls:visible');
  const heading = () =>
    active.locator('.ot-task-note-heading.is-inline .ot-task-note-title:visible');
  async function screen({ width, height, mobile = false, dark = false }) {
    if (isMobile !== mobile) {
      await touch?.detach();
      touch = null;
      const origin = await page.evaluate(() => performance.timeOrigin);
      await page.evaluate((value) => app.emulateMobile(value), mobile);
      await page.waitForFunction((origin) => performance.timeOrigin !== origin, origin);
      await page.waitForFunction(
        () => window.app?.workspace?.layoutReady && app.plugins?.getPlugin('thingsmd')?._loaded,
      );
      isMobile = mobile;
    }
    await page.setViewportSize({ width, height });
    await page.evaluate((dark) => {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
      document.body.classList.toggle('theme-dark', dark);
      document.body.classList.toggle('theme-light', !dark);
    }, dark);
    if (mobile && !touch) {
      touch = await page.context().newCDPSession(page);
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    }
  }
  async function touchPoint(control) {
    // Obsidian repositions its floating mobile bars after scrolling/focus. A
    // trial mouse click alone can return before that second layout has settled.
    await control.scrollIntoViewIfNeeded();
    return control.evaluate(async (el) => {
      // Minimal scrolling can leave the target under a mobile bar that is
      // still animating back after a modal closes. Aim in the viewport center.
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const start = performance.now();
      let stable = start,
        previous = '',
        scrolled = 0;
      while (performance.now() - start < 10000) {
        const r = el.getBoundingClientRect();
        const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        const position = JSON.stringify(point);
        const now = performance.now();
        if (!el.contains(hit) || position !== previous) stable = now;
        if (!el.contains(hit) && now - scrolled > 150) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          scrolled = now;
        }
        if (now - stable > 150) return point;
        previous = position;
        await new Promise(requestAnimationFrame);
      }
      throw Error(`Touch target did not settle: ${el.getAttribute('aria-label')}`);
    });
  }
  async function action(control, hold = 0) {
    // Trial click checks scrolling, occlusion and stability before a real touch.
    if (!isMobile) return control.click();
    await control.click({ trial: true });
    const point = await touchPoint(control);
    await control.evaluate((el, point) => {
      window.noteTouch = { label: el.getAttribute('aria-label') || el.textContent, point };
      document.addEventListener(
        'touchstart',
        (event) => {
          window.noteTouch.target = event.target.outerHTML.slice(0, 350);
          window.noteTouch.matched = el.contains(event.target);
          window.noteTouch.bounds = el.getBoundingClientRect().toJSON();
          window.noteTouch.viewport = {
            offsetTop: visualViewport?.offsetTop,
            height: visualViewport?.height,
            scale: visualViewport?.scale,
          };
        },
        { capture: true, once: true },
      );
    }, point);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    });
    if (hold) await page.waitForTimeout(hold);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(
      await page.evaluate(() => window.noteTouch.matched),
      'Touch must reach its intended control',
    );
  }
  async function contextMenu(control) {
    if (isMobile) await action(control, 600);
    else await control.click({ button: 'right' });
    await page.locator('.menu').waitFor();
  }
  async function drag(from, to) {
    await from.scrollIntoViewIfNeeded();
    await to.scrollIntoViewIfNeeded();
    const a = await from.boundingBox(),
      b = await to.boundingBox();
    const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const end = { x: start.x, y: b.y + b.height / 2 };
    if (isMobile) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    }
  }
  async function open(task, mode) {
    const stale = await page.evaluate(
      async ({ path, mode, id }) => {
        const p = app.plugins.getPlugin('thingsmd');
        const leaf = p.mainWorkspaceLeaf();
        await leaf.setViewState({
          type: 'markdown',
          state: {
            file: path,
            mode: mode === 'reading' ? 'preview' : 'source',
            source: mode === 'source',
          },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return [...leaf.view.containerEl.querySelectorAll('.ot-task-note-controls .ot-task')]
          .filter((el) => el.dataset.taskId !== id)
          .map((el) => {
            const card = el.closest('.ot-task-note-controls')._thingsmdCard;
            const before = JSON.stringify(card.taskDraft.values);
            // A host transition may precede its DOM/render events. Even in
            // that interval, the old controls must reject an interaction.
            el.querySelector('.ot-waiting-toggle').click();
            return {
              id: el.dataset.taskId,
              path: card.taskDraft.task.file.path,
              activePath: leaf.view.file.path,
              blocked: JSON.stringify(card.taskDraft.values) === before,
            };
          });
      },
      { path: task.file.path, mode, id: task.meta.id },
    );
    assert.ok(
      stale.every((entry) => entry.blocked),
      `Stale controls must be inert: ${JSON.stringify(stale)}`,
    );
    await controls().locator(`.ot-task[data-task-id="${task.meta.id}"]`).waitFor();
    await controls().getByRole('button', { name: 'When', exact: true }).waitFor();
    await heading().waitFor();
  }
  async function create(fields = {}, body = '## Notes\n\nBody **must survive**.\n') {
    return page.evaluate(
      async ({ prefix, fields, body }) => {
        const p = app.plugins.getPlugin('thingsmd');
        await p.updateSettings({
          enableWaiting: true,
          logbook: 'manually',
          trashRetention: 'never',
        });
        return p.createTask({ title: prefix, ...fields }, undefined, body);
      },
      { prefix, fields, body },
    );
  }
  const record = (id) =>
    page.evaluate(
      async (id) =>
        (await app.plugins.getPlugin('thingsmd').taskRecords()).find((t) => t.meta.id === id),
      id,
    );
  async function saved(id, key, expected) {
    await waitForAsync(
      page,
      async ({ id, key, expected }) => {
        const task = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
          (t) => t.meta.id === id,
        );
        return JSON.stringify(task?.meta[key] ?? null) === JSON.stringify(expected);
      },
      { id, key, expected },
    );
  }
  async function geometry() {
    for (const control of await controls().locator('.ot-card-icons button:visible').all()) {
      await control.click({ trial: true });
      if (isMobile) await touchPoint(control);
      const bounds = await control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          name: el.getAttribute('aria-label'),
          left: r.left,
          right: r.right,
          width: innerWidth,
          hit: !!hit && (hit === el || el.contains(hit)),
          obstruction: hit?.className,
        };
      });
      assert.ok(
        bounds.left >= 0 && bounds.right <= bounds.width && bounds.hit,
        JSON.stringify(bounds),
      );
    }
  }
  async function cleanup() {
    try {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.evaluate(
        async ({ prefix, original }) => {
          const p = app.plugins.getPlugin('thingsmd');
          app.setting.close();
          app.vault.setConfig('propertiesInDocument', original.properties);
          app.vault.setConfig('showInlineTitle', original.inlineTitle);
          const tasks = (await p.taskRecords()).filter((t) => t.meta.title?.startsWith(prefix));
          const paths = new Set(tasks.map((t) => t.file.path));
          for (const leaf of app.workspace.getLeavesOfType('markdown'))
            if (paths.has(leaf.view.file?.path) || leaf.view.file?.path.startsWith(prefix))
              leaf.detach();
          for (const task of tasks) await p.deleteTask(task.file);
          for (const file of app.vault.getMarkdownFiles())
            if (file.path.startsWith(prefix)) await app.vault.delete(file);
          await p.updateSettings(original.settings);
          await p.openList('inbox');
        },
        { prefix, original },
      );
      await touch?.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await touch?.detach();
      touch = null;
      await screen({ width: 1100, height: 850, mobile: original.mobile, dark: original.dark });
      await touch?.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await touch?.detach();
    } finally {
      await browser.close();
    }
  }
  return {
    page,
    prefix,
    active,
    controls,
    heading,
    screen,
    action,
    contextMenu,
    drag,
    open,
    create,
    record,
    saved,
    geometry,
    cleanup,
  };
}
