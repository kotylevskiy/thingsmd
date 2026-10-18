import assert from 'node:assert/strict';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
const path = `Sidebar navigation ${Date.now()}.md`;
try {
  const result = await page.evaluate(async (path) => {
    const workspace = app.workspace;
    const plugin = app.plugins.getPlugin('thingsmd');
    const sidebar = workspace.getLeavesOfType('file-explorer')[0];
    if (!sidebar) throw Error('File explorer must be present before this test');
    const original = sidebar.view;
    workspace.setActiveLeaf(sidebar, { focus: true });
    await plugin.openList('today');
    const listInMain = workspace.activeLeaf.getRoot() === workspace.rootSplit;
    const project = await app.vault.create(path, 'Sidebar navigation fixture.\n');
    workspace.setActiveLeaf(sidebar, { focus: true });
    await plugin.revealSearchResult({ kind: 'project', path: project.path });
    const projectInMain = workspace.activeLeaf.getRoot() === workspace.rootSplit;
    await plugin.openList('inbox');
    return { listInMain, projectInMain, preserved: sidebar.view === original };
  }, path);
  assert.deepEqual(result, { listInMain: true, projectInMain: true, preserved: true });
  await page.screenshot({ path: 'artifacts/sidebar-navigation-verified.png' });
  console.log(
    'PASS: opening lists and search projects from sidebar focus preserves the file explorer.',
  );
} finally {
  await page.evaluate(async (path) => {
    const file = app.vault.getFileByPath(path);
    if (file) await app.vault.delete(file);
  }, path);
  await browser.close();
}
