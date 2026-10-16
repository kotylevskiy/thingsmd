import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
try {
  page.on('pageerror', (e) => console.error(e.message));
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('thingsmd');
    const task = await plugin.createTask({ title: 'Example task' });
    const note = `Task example ${Date.now()}.md`;
    const file = await app.vault.create(note, `# Task example\n\n![[${task.file.path}]]\n`);
    const leaf = app.plugins.getPlugin('thingsmd').mainWorkspaceLeaf();
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await leaf.openFile(file);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: note, mode: 'source', source: false },
    });
  });
  await page.locator('.workspace-leaf.mod-active .ot-native').first().waitFor();
  await page.screenshot({ path: 'artifacts/native-example.png' });
  console.log('Native note open; task widgets:', await page.locator('.ot-native').count());
} finally {
  await browser.close();
}
