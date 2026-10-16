import { mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
if (!process.env.THINGSMD_TEST_VAULT)
  throw new Error('Set THINGSMD_TEST_VAULT to an existing disposable Obsidian vault.');
const vault = resolve(process.env.THINGSMD_TEST_VAULT);
// Require an existing development vault; never create one by accident.
if (!(await stat(vault)).isDirectory()) throw new Error('Test vault must be a directory.');
const output = resolve(vault, '.obsidian/plugins/thingsmd');
await mkdir(output, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(new URL(`dist/${file}`, root), resolve(output, file));
console.log(`Deployed to ${output}`);
