import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { markerName } from './test-vault.mjs';

// Always create a fresh vault. This command never marks or modifies an existing one.
const vault = await mkdtemp(join(tmpdir(), 'thingsmd-vault-'));
await mkdir(join(vault, '.obsidian'));
await writeFile(join(vault, markerName), JSON.stringify({ disposable: true, version: 1 }));
console.log(vault);
