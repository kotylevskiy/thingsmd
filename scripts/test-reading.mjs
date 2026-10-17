import { waitForAsync } from './wait-for-async.mjs';
import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.setDefaultTimeout(8000);
const fixture = `Reading test ${Date.now()}.md`;
let tasks = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const active = page.locator('.workspace-leaf.mod-active');
try {
  tasks = await page.evaluate(async (path) => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const a = await plugin.createTask({ title: 'Reading first' }),
      b = await plugin.createTask({ title: 'Reading second' });
    await app.vault.create(
      path,
      `# Reading test\n\nContext above.\n\n![[${a.file.path}]]\n\nContext between.\n\n![[${b.file.path}]]\n\nContext below.\n`,
    );
    await new Promise((r) => setTimeout(r, 250));
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: 'markdown',
      state: { file: path, mode: 'preview' },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return [a.file.path, b.file.path];
  }, fixture);
  await active.locator('.ot-reading-task').nth(1).waitFor();
  assert.equal(await active.locator('.internal-embed').count(), 0);
  const first = active.locator(`.ot-native[data-task-path="${tasks[0]}"]:visible`);
  await first.locator('.ot-task').dblclick();
  assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getMode()), 'preview');
  await first.locator('.ot-title-input').fill('Reading updated');
  await first.locator('.ot-title-input').press('Tab');
  assert.equal(
    await first.locator('.ot-task-notes').evaluate((e) => e === document.activeElement),
    true,
  );
  await first.locator('.ot-task-notes').fill('Notes saved from reading view.');
  await first.locator('.ot-title-input').focus();
  await first.locator('.ot-title-input').press('Enter');
  await first.locator('.is-expanded').waitFor({ state: 'hidden' });
  assert.equal(await first.locator('.ot-task').evaluate((e) => e === document.activeElement), true);
  await first.locator('.ot-task').press('Enter');
  await first.getByRole('button', { name: 'When', exact: true }).click();
  await first.getByRole('button', { name: /^Today/ }).click();
  await first.locator('.ot-title-input').press('Enter');
  await first.locator('.ot-today-marker').waitFor();
  await first.locator('.ot-task').press('ArrowDown');
  const second = active.locator(`.ot-native[data-task-path="${tasks[1]}"]:visible`);
  assert.equal(
    await second.locator('.ot-task').evaluate((e) => e === document.activeElement),
    true,
  );
  await second.locator('input[type=checkbox]').check();
  await second.locator('.is-done').waitFor();
  await second.locator('input[type=checkbox]').uncheck();
  await second.locator('.is-done').waitFor({ state: 'hidden' });
  const from = await second.boundingBox(),
    to = await first.boundingBox();
  await page.mouse.move(from.x + 100, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 100, to.y + 2, { steps: 12 });
  await page.locator('.ot-task-drop-marker').waitFor();
  await page.mouse.up();
  await waitForAsync(
    page,
    async ({ fixture, tasks }) => {
      const text = await app.vault.read(app.vault.getAbstractFileByPath(fixture));
      return text.indexOf(tasks[1]) < text.indexOf(tasks[0]);
    },
    { fixture, tasks },
  );
  const text = await page.evaluate(async (path) => app.vault.adapter.read(path), tasks[0]);
  assert.match(text, /title: Reading updated/);
  assert.match(text, /when: today/);
  assert.match(text, /Notes saved from reading view/);
  const prose = await page.evaluate(async (path) => app.vault.adapter.read(path), fixture);
  for (const line of ['Context above.', 'Context between.', 'Context below.'])
    assert.ok(prose.includes(line));
  await page.evaluate(async () => {
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    await leaf.setViewState({
      type: 'markdown',
      state: { ...leaf.view.getState(), mode: 'source', source: false },
    });
  });
  await first.locator('.ot-task-title').waitFor();
  assert.equal(await first.locator('.ot-task-title').innerText(), 'Reading updated');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Reading view shares task editing, Tab/Enter, Today picker, completion, arrow selection, pointer drag, persisted notes, and Live Preview state.',
  );
} catch (error) {
  await page.screenshot({ path: 'artifacts/reading-failure.png' });
  throw error;
} finally {
  await page.evaluate(
    async ({ fixture, tasks }) => {
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path === fixture) leaf.detach();
      for (const path of [fixture, ...tasks]) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.delete(file);
        else if (path?.startsWith('.thingsmd-storage/') && (await app.vault.adapter.exists(path)))
          await app.plugins.getPlugin('thingsmd').deleteTask(path);
      }
    },
    { fixture, tasks },
  );
  await browser.close();
}
