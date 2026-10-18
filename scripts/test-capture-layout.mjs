import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserFixture } from './browser-fixture.mjs';
import { connectTestVault } from './obsidian-connection.mjs';
import { waitForAsync } from './wait-for-async.mjs';

await mkdir('artifacts', { recursive: true });
const fixture = process.argv.includes('--fixture');
const browserType =
  process.env.THINGSMD_TEST_BROWSER === 'webkit'
    ? (await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core')).webkit
    : undefined;
const { browser, page } = fixture
  ? await browserFixture({ browserType })
  : await connectTestVault();
page.setDefaultTimeout(10000);
const prefix = `Capture keyboard ${Date.now()}`;
const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
let originalSettings, sidebarCollapsed;
const wasMobile = !fixture && (await page.evaluate(() => !!localStorage.getItem('EmulateMobile')));
const ready = () =>
  page.waitForFunction(
    () => window.app?.workspace?.layoutReady && app.plugins.getPlugin('thingsmd'),
    undefined,
    { timeout: 20000 },
  );
try {
  await page.setViewportSize({ width: 390, height: 844 });
  if (fixture) {
    await page.evaluate(() => {
      document.body.classList.add('is-mobile');
      document.body.style.setProperty('--safe-area-inset-top', '59px');
      window.captureSaved = [];
      const Capture = window.loadPluginModule('./task-capture.cjs');
      window.capturePlugin = {
        app: { workspace: {} },
        settings: { enableWaiting: true },
        renderTaskNotes: window.renderTaskNotesFixture,
        captureDestination: async () => null,
        createTask: async (fields, id, body) => {
          const task = { meta: fields, body };
          window.captureSaved.push(task);
          return task;
        },
        capture: (fields) => {
          window.capturePlugin.captureModal = new Capture(window.capturePlugin, fields);
          window.capturePlugin.captureModal.open();
        },
      };
    });
  } else {
    if (!wasMobile) await page.evaluate(() => app.emulateMobile(true));
    await ready();
    ({ originalSettings, sidebarCollapsed } = await page.evaluate(async () => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const originalSettings = { ...plugin.settings };
      const sidebarCollapsed = app.workspace.leftSplit.collapsed;
      await plugin.updateSettings({ enableWaiting: true });
      app.workspace.leftSplit.collapse();
      return { originalSettings, sidebarCollapsed };
    }));
  }
  // Model an overlay keyboard: the layout viewport stays full size while the
  // visible viewport shrinks/pans. A short browser window alone misses this bug.
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const viewport = new EventTarget();
    viewport.height = innerHeight;
    viewport.offsetTop = 0;
    const keyboard = document.body.createDiv();
    Object.assign(keyboard.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      background: '#333',
      zIndex: '999999',
      pointerEvents: 'auto',
    });
    window.captureViewportTest = {
      original,
      viewport,
      keyboard,
      dark: document.body.classList.contains('theme-dark'),
      light: document.body.classList.contains('theme-light'),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  const capture = page.locator('.ot-capture-modal');
  const cases = [
    { width: 390, height: 844, visible: 844, top: 0, lines: 4 },
    { width: 390, height: 844, visible: 500, top: 0, lines: 4 },
    { width: 320, height: 568, visible: 340, top: 0, lines: 30 },
    { width: 430, height: 932, visible: 440, top: 45, lines: 40 },
    { width: 844, height: 390, visible: 320, top: 0, lines: 20 },
  ];
  for (const [index, size] of cases.entries()) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.evaluate((index) => {
      const { viewport, keyboard } = window.captureViewportTest;
      viewport.height = innerHeight;
      viewport.offsetTop = 0;
      keyboard.style.top = `${innerHeight}px`;
      document.body.classList.toggle('theme-dark', index === 3);
      document.body.classList.toggle('theme-light', index !== 3);
    }, index);
    const title = `${prefix} ${index}`;
    await page.evaluate(
      ({ fixture, title }) => {
        const plugin = fixture ? window.capturePlugin : app.plugins.getPlugin('thingsmd');
        plugin.capture({ title, when: 'today', deadline: '2099-01-01' });
      },
      { fixture, title },
    );
    await capture.waitFor();
    await capture.getByText('Tab to edit description', { exact: true }).waitFor();
    assert.equal(
      await capture.getByLabel('Task title', { exact: true }).getAttribute('enterkeyhint'),
      'done',
    );
    assert.equal(await capture.locator('textarea.ot-task-notes').count(), 0);
    await capture.locator('.ot-task-notes-preview').waitFor();
    await page.evaluate(({ visible, top }) => {
      const { viewport, keyboard } = window.captureViewportTest;
      viewport.height = visible;
      viewport.offsetTop = top;
      keyboard.style.top = `${visible + top}px`;
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    }, size);
    for (let i = 0; i < size.lines; i++) {
      await capture.getByRole('button', { name: 'Checklist', exact: true }).click();
      await capture.getByLabel(`Checklist text ${i + 1}`, { exact: true }).fill(`Step ${i + 1}`);
    }
    await capture.getByLabel('Task title', { exact: true }).focus();
    const geometry = await capture.evaluate((modal) => {
      const { viewport } = window.captureViewportTest;
      const box = modal.getBoundingClientRect();
      const buttons = [
        ...modal.querySelectorAll('.ot-card-icons button,.ot-capture-actions button'),
      ];
      return {
        top: box.top,
        notesOffset: parseFloat(
          modal.parentElement.style.getPropertyValue('--ot-capture-notes-offset'),
        ),
        safeTop: Math.max(
          12,
          parseFloat(getComputedStyle(document.body).getPropertyValue('--safe-area-inset-top')) ||
            0,
        ),
        bottom: box.bottom,
        viewportTop: viewport.offsetTop,
        viewportBottom: viewport.offsetTop + viewport.height,
        hint: (() => {
          const hint = modal.querySelector('.ot-capture-hint');
          const r = hint.getBoundingClientRect();
          const cancel = modal.querySelector('.ot-capture-actions button').getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            cancelLeft: cancel.left,
          };
        })(),
        buttons: buttons.map((button) => {
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {
            label: button.getAttribute('aria-label') || button.textContent,
            top: r.top,
            bottom: r.bottom,
            height: r.height,
            clickable: !!hit && (hit === button || button.contains(hit)),
          };
        }),
      };
    });
    assert.ok(geometry.top >= size.top, JSON.stringify(geometry));
    assert.ok(geometry.hint.right <= geometry.hint.cancelLeft, JSON.stringify(geometry));
    assert.ok(
      geometry.hint.top >= geometry.top && geometry.hint.bottom <= geometry.bottom,
      JSON.stringify(geometry),
    );
    const inset = Math.min(geometry.notesOffset, Math.max(0, size.visible - 400));
    assert.ok(
      Math.abs(geometry.top - (size.top + geometry.safeTop + inset)) < 2,
      `Mobile capture shifts to the former Notes position when space permits: ${JSON.stringify(geometry)}`,
    );
    assert.ok(geometry.bottom <= geometry.viewportBottom + 1, JSON.stringify(geometry));
    for (const button of geometry.buttons) {
      assert.ok(button.top >= geometry.viewportTop, JSON.stringify(button));
      assert.ok(button.bottom <= geometry.viewportBottom, JSON.stringify(button));
      assert.ok(button.clickable, JSON.stringify(button));
    }
    const scrollable = await capture.locator('.ot-task-fields').evaluate((fields) => {
      const before = fields
        .closest('.ot-task-editor')
        .querySelector('.ot-card-footer')
        .getBoundingClientRect().top;
      fields.scrollTop = fields.scrollHeight;
      return {
        scrolls: fields.scrollHeight > fields.clientHeight && fields.scrollTop > 0,
        footerStayed:
          Math.abs(
            before -
              fields
                .closest('.ot-task-editor')
                .querySelector('.ot-card-footer')
                .getBoundingClientRect().top,
          ) < 1,
      };
    });
    if (size.lines > 4) assert.ok(scrollable.scrolls);
    assert.ok(scrollable.footerStayed);
    assert.equal(await capture.locator('.ot-task-notes-preview').isVisible(), false);
    assert.equal(
      await capture
        .locator('.ot-checklist-row')
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopWidth),
      '0px',
    );
    await capture.getByRole('button', { name: 'Waiting For', exact: true }).click();
    assert.equal(
      await capture
        .getByRole('button', { name: 'Waiting For', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.screenshot({
      path: `artifacts/capture-keyboard-${fixture ? browserType?.name() || 'chromium' : 'obsidian'}-${index}.png`,
    });
    // Cover Save while the keyboard is up, and keyboard dismissal without
    // rebuilding or losing this populated draft.
    if (index % 2 === 0) {
      await page.evaluate(() => {
        const { viewport, keyboard } = window.captureViewportTest;
        viewport.height = innerHeight;
        viewport.offsetTop = 0;
        keyboard.style.top = `${innerHeight}px`;
        viewport.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(() => {
        const container = document.querySelector('.ot-capture-container');
        return Math.abs(container.getBoundingClientRect().height - innerHeight) < 1;
      });
    }
    await capture.evaluate((modal) => {
      window.captureViewportTest.closedContainer = modal.closest('.ot-capture-container');
    });
    if (index % 2 === 0) await capture.getByRole('button', { name: 'Save', exact: true }).click();
    else await capture.getByLabel('Task title', { exact: true }).press('Enter');
    await capture.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => {
        const { viewport, closedContainer } = window.captureViewportTest;
        const before = closedContainer.style.cssText;
        viewport.height = 200;
        viewport.dispatchEvent(new Event('resize'));
        return closedContainer.style.cssText === before;
      }),
      true,
      'Closing capture removes its viewport listeners',
    );
    const saved = await page.evaluate(
      async ({ fixture, title }) => {
        const tasks = fixture
          ? window.captureSaved
          : await app.plugins.getPlugin('thingsmd').taskRecords();
        return tasks.filter((task) => task.meta.title === title);
      },
      { fixture, title },
    );
    assert.equal(saved.length, 1);
    assert.equal(saved[0].body, '');
    assert.equal(saved[0].meta.checklist.length, size.lines);
    assert.equal(saved[0].meta.is_waiting, true);
    console.log('PASS capture keyboard:', size);
  }
  if (!fixture) {
    await page.evaluate((title) => {
      const { viewport, keyboard } = window.captureViewportTest;
      viewport.height = innerHeight;
      viewport.offsetTop = 0;
      keyboard.style.top = `${innerHeight}px`;
      app.plugins.getPlugin('thingsmd').capture({ title });
    }, prefix + ' native notes');
    await capture.locator('.ot-task-notes-preview').click();
    await capture.waitFor({ state: 'hidden' });
    await waitForAsync(
      page,
      async (title) => {
        const p = app.plugins.getPlugin('thingsmd');
        const task = (await p.taskRecords()).find((t) => t.meta.title === title);
        const view = app.workspace.activeLeaf.view;
        return (
          task &&
          !p.taskNotesOpening &&
          view.file?.path === task.file.path &&
          view.getMode?.() === 'source'
        );
      },
      prefix + ' native notes',
    );
    console.log('PASS: mobile capture notes open the saved task in the native editor.');
  }
} finally {
  try {
    await page.evaluate(
      async ({ fixture, prefix, originalSettings, sidebarCollapsed }) => {
        const plugin = fixture ? window.capturePlugin : app.plugins.getPlugin('thingsmd');
        plugin?.captureModal?.close();
        if (window.captureViewportTest) {
          const { original, keyboard, dark, light } = window.captureViewportTest;
          if (original) Object.defineProperty(window, 'visualViewport', original);
          else delete window.visualViewport;
          keyboard.remove();
          document.body.classList.toggle('theme-dark', dark);
          document.body.classList.toggle('theme-light', light);
          delete window.captureViewportTest;
        }
        if (!fixture && originalSettings) {
          await plugin.updateSettings(originalSettings);
          if (!sidebarCollapsed) app.workspace.leftSplit.expand();
        }
        if (!fixture)
          for (const task of await plugin.taskRecords())
            if (task.meta.title?.startsWith(prefix)) await plugin.deleteTask(task.file);
      },
      { fixture, prefix, originalSettings, sidebarCollapsed },
    );
    if (!fixture && !wasMobile) {
      await page.evaluate(() => app.emulateMobile(false));
      await ready();
    }
  } finally {
    await page.setViewportSize(originalViewport);
    await browser.close();
  }
}
