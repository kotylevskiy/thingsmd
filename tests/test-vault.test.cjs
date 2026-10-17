const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, symlink, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

test('development tools reject real vault paths, unmarked directories and symlink escapes', async (t) => {
  const { testVault, markerName } = await import('../scripts/test-vault.mjs');
  const root = await mkdtemp(join(tmpdir(), 'thingsmd-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(testVault(root), /unmarked/);
  await writeFile(join(root, markerName), JSON.stringify({ disposable: false, version: 1 }));
  await assert.rejects(testVault(root), /Invalid/);
  await writeFile(join(root, markerName), JSON.stringify({ disposable: true, version: 1 }));
  const vault = await testVault(root);
  assert.ok(vault.endsWith(root.split('/').pop()));
  await assert.rejects(testVault(process.cwd()), /personal vaults are refused/);
  const alias = join(root, 'personal-vault');
  await symlink(process.cwd(), alias);
  await assert.rejects(testVault(alias), /personal vaults are refused/);
});
