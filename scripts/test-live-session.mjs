import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault({ settings: { enableWaiting: true } });
page.setDefaultTimeout(8000);
const prefix = `Live session ${Date.now()}`;
const modal = page.locator('.ot-capture-modal');
const active = page.locator('.workspace-leaf.mod-active');
try {
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('inbox'));
  for (const width of [390, 1100]) {
    await page.evaluate(() => {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    });
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture());
    const title = modal.getByLabel('Task title', { exact: true });
    await title.fill(`${prefix} Waiting ${width}`);
    assert.equal(
      await modal.locator(':scope > .modal-close-button, :scope > .modal-header-button').count(),
      0,
      'Capture removes both legacy and current Obsidian header controls',
    );
    assert.equal(await modal.locator('svg.lucide-x:visible').count(), 0);
    const waiting = modal.getByRole('button', { name: 'Waiting For', exact: true });
    assert.equal(await waiting.locator('svg .ot-paper-plane').count(), 1);
    assert.equal((await waiting.innerText()).trim(), '');
    await waiting.click();
    assert.equal(await waiting.getAttribute('aria-pressed'), 'true');
    assert.equal(await modal.locator('.ot-waiting-marker').count(), 0);
    const beforeOutside = await page.evaluate(
      async () => (await app.plugins.getPlugin('thingsmd').taskRecords()).length,
    );
    const backdrop = page.locator('.modal-container').filter({ has: modal }).locator('.modal-bg');
    await backdrop.click({ position: { x: 5, y: 5 } });
    assert.equal(await modal.isVisible(), true);
    assert.equal(await title.inputValue(), `${prefix} Waiting ${width}`);
    assert.equal(await waiting.getAttribute('aria-pressed'), 'true');
    if (width === 390) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      const box = await backdrop.boundingBox();
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: box.x + 5, y: box.y + 5, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
      assert.equal(await modal.isVisible(), true);
      assert.equal(await title.inputValue(), `${prefix} Waiting ${width}`);
    }
    assert.equal(
      await page.evaluate(
        async () => (await app.plugins.getPlugin('thingsmd').taskRecords()).length,
      ),
      beforeOutside,
    );

    if (width === 390) assert.ok((await waiting.boundingBox()).height >= 44);
    await modal.getByRole('button', { name: 'Save', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(
        async (title) =>
          (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
            (t) => t.meta.title === title,
          )?.meta.is_waiting,
        `${prefix} Waiting ${width}`,
      ),
      true,
    );
    for (const action of ['Cancel', 'Escape', 'Meta+Enter']) {
      await page.evaluate(() => app.plugins.getPlugin('thingsmd').capture());
      const name = `${prefix} ${action} ${width}`;
      await title.fill(name);
      if (action === 'Cancel')
        await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
      else await title.press(action);
      await modal.waitFor({ state: 'hidden' });
      assert.equal(
        await page.evaluate(
          async (name) =>
            (await app.plugins.getPlugin('thingsmd').taskRecords()).some(
              (t) => t.meta.title === name,
            ),
          name,
        ),
        action === 'Meta+Enter',
      );
    }
  }
  const id = await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    const t = await p.createTask(
      { title: prefix + ' Письма в СерДизель должны быть доставлены', deadline: '2099-10-20' },
      undefined,
      'Notes',
    );
    await p.openList('inbox');
    return t.meta.id;
  }, prefix);
  const row = active.locator(`.ot-task[data-task-id="${id}"]`);
  await row.waitFor();
  await row.dblclick();
  await active.getByRole('button', { name: 'When', exact: true }).click();
  await active.getByRole('button', { name: /^Today/ }).click();
  await active.locator('.ot-title-input').press('Enter');
  await active.locator('.ot-inbox-moved').waitFor();
  await page.locator('.notice').filter({ hasText: 'moved to Today' }).last().waitFor();
  await row.dblclick();
  await active.locator('.ot-title-input').waitFor();
  await active.locator('.ot-title-input').press('Enter');
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('anytime'));
  for (const width of [320, 390, 430]) {
    await page.evaluate(() => {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    });
    await page.setViewportSize({ width, height: 844 });
    const check = await row.locator('input[type="checkbox"]').boundingBox();
    const title = await row.locator('.ot-task-title').boundingBox();
    if (check.x + check.width > title.x) {
      console.log(
        JSON.stringify({
          width,
          check,
          title,
          css: await row.locator('.ot-task-line').evaluate((el) => ({
            width: getComputedStyle(el).width,
            display: getComputedStyle(el).display,
            flexDirection: getComputedStyle(el).flexDirection,
            html: el.outerHTML,
          })),
        }),
      );
      await page.screenshot({ path: 'artifacts/live-mobile-layout-failure.png' });
    }
    assert.ok(check.x + check.width <= title.x);
    assert.ok(check.y >= title.y && check.y + check.height <= title.y + title.height + 1);
  }
  await page.evaluate(() => app.plugins.getPlugin('thingsmd').openList('inbox'));
  assert.equal(await active.locator('.ot-inbox-moved').count(), 0);
  await page.evaluate(() => {
    app.workspace
      .getLeavesOfType('file-explorer')[0]
      .view.containerEl.querySelector('.ot-list-links')
      .remove();
  });
  await page.locator('.ot-list-links').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('.ot-list-links').count(), 1);
  console.log(
    'PASS: real Obsidian capture Save/Cancel/Escape/Cmd+Enter, waiting persistence, notices, editable temporary Inbox section, phone row geometry, and sidebar recovery.',
  );
} catch (error) {
  console.error(
    'Live capture diagnostics:',
    await page.evaluate(() => {
      const modal = app.plugins.getPlugin('thingsmd').captureModal;
      return {
        width: innerWidth,
        capture: !!modal,
        connected: modal?.modalEl.isConnected,
        content: modal?.contentEl.innerHTML,
        dialogs: document.querySelectorAll('.modal').length,
      };
    }),
  );
  throw error;
} finally {
  await page.evaluate(async (prefix) => {
    const p = app.plugins.getPlugin('thingsmd');
    await p.captureModal?.close();
    for (const task of await p.taskRecords())
      if (task.meta.title?.startsWith(prefix)) await p.deleteTask(task.file);
    await p.openList('inbox');
  }, prefix);
  await browser.close();
}
