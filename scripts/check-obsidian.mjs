import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connectTestVault } from './obsidian-connection.mjs';

const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
const { browser, page } = await connectTestVault();
try {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.workspace').waitFor({ state: 'visible' });
  const state = await page.evaluate(() => ({
    vault: window.app.vault.getName(),
    vaultPath: window.app.vault.adapter.getBasePath(),
    activeFile: window.app.workspace.getActiveFile()?.path ?? null,
  }));
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}obsidian-test-vault.png` });
  console.log(
    JSON.stringify(
      {
        title: await page.title(),
        ...state,
        screenshot: `${output}obsidian-test-vault.png`,
        errorsDuringCheck: errors,
      },
      null,
      2,
    ),
  );
} finally {
  // Disconnect from the existing app without closing its windows.
  await browser.close();
}
