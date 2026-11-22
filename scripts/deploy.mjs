import { testVault } from './test-vault.mjs';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const vault = await testVault();
const output = resolve(vault, '.obsidian/plugins/thingsmd');
await mkdir(output, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(new URL(`dist/${file}`, root), resolve(output, file));
console.log(`Deployed to ${output}`);
