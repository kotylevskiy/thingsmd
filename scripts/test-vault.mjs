import { realpath, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export const markerName = '.thingsmd-test-vault.json';
// Both deployment and UI drivers must prove that a vault was explicitly prepared
// for disposable tests. Resolving symlinks prevents a temporary alias to real notes.
export async function testVault(path = process.env.THINGSMD_TEST_VAULT) {
  if (!path) throw new Error('Set THINGSMD_TEST_VAULT to a prepared disposable vault.');
  const vault = await realpath(path);
  const roots = await Promise.all(
    [tmpdir(), ...(process.platform === 'win32' ? [] : ['/tmp'])].map((root) => realpath(root)),
  );
  if (
    !roots.some((root) => {
      const child = relative(root, vault);
      return child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
    })
  )
    throw new Error(
      'Test vault must be inside a temporary directory; personal vaults are refused.',
    );
  let marker;
  try {
    marker = JSON.parse(await readFile(resolve(vault, markerName), 'utf8'));
  } catch {
    throw new Error('Test vault is unmarked. Create one with npm run dev:vault.');
  }
  if (marker.disposable !== true || marker.version !== 1)
    throw new Error('Invalid disposable-vault marker.');
  return vault;
}
