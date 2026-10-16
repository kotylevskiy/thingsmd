import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
page.on('console', (message) => {
  if (message.type() === 'error') console.error(message.text());
});
page.on('pageerror', (error) => console.error(error.message));
try {
  await page.evaluate(async () => {
    await new Promise((resolve) => app.workspace.onLayoutReady(resolve));
    // Development harness only: Obsidian has no public plugin-management API.
    const id = 'thingsmd';
    if (app.plugins.getPlugin(id)) await app.plugins.disablePlugin(id);
    await app.plugins.loadManifests();
    await app.plugins.setEnable(true);
    await app.plugins.enablePluginAndSave(id);
    const plugin = app.plugins.getPlugin(id);
    if (!plugin) throw new Error('ThingsMD failed to load');
    await plugin.open();
  });
  await page.locator('.ot-paper h1').waitFor();
  console.log('ThingsMD opened in the test vault.');
} finally {
  await browser.close();
}
