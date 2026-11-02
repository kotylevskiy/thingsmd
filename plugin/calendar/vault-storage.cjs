async function ensureFolder(vault, path) {
  let folder = '';
  for (const part of path.split('/')) {
    folder = folder ? `${folder}/${part}` : part;
    if (!(await vault.adapter.exists(folder))) {
      try {
        await vault.createFolder(folder);
      } catch (error) {
        // Another sync/create operation may have made the same directory.
        if (!(await vault.adapter.exists(folder))) throw error;
      }
    }
    if ((await vault.adapter.stat(folder))?.type !== 'folder')
      throw new Error(`${folder} is a file, not a folder.`);
  }
}

async function removeEmptyFolder(vault, path) {
  const adapter = vault.adapter;
  if (!(await adapter.exists(path))) return;
  const children = await adapter.list(path);
  if (children.files.length || children.folders.length) return;
  if (
    typeof adapter.fsPromises?.rmdir === 'function' &&
    typeof adapter.getFullPath === 'function' &&
    typeof adapter.queue === 'function' &&
    typeof adapter.reconcileInternalFile === 'function'
  ) {
    // Desktop's rmdir(path, false) currently calls Node's rm with recursive:false,
    // which rejects directories even when empty. Use the adapter's native rmdir
    // in its operation queue, then reconcile exactly as the public method does.
    // Native rmdir also rejects a folder populated by sync after our empty check.
    await adapter.queue(async () => {
      await adapter.fsPromises.rmdir(adapter.getFullPath(path));
      await adapter.reconcileInternalFile(path);
    });
  } else {
    // Mobile/other adapters implement their own nonrecursive directory removal.
    await adapter.rmdir(path, false);
  }
}

// Adapter boundary: the calendar service needs immutable files, not Obsidian's
// vault/file APIs. Conditional deletion preserves copies edited during sync.
function calendarVaultStorage(vault) {
  return {
    async list(folder) {
      if (!(await vault.adapter.exists(folder))) return [];
      return (await vault.adapter.list(folder)).files;
    },
    read: (path) => vault.adapter.read(path),
    async create(path, body) {
      await ensureFolder(vault, path.slice(0, path.lastIndexOf('/')));
      await vault.create(path, body);
    },
    async remove(path, expectedBody) {
      const file = vault.getAbstractFileByPath(path);
      if (!file) return;
      if (expectedBody !== undefined && (await vault.read(file)) !== expectedBody) return;
      if (vault.getAbstractFileByPath(path) === file) await vault.delete(file);
    },
  };
}
module.exports = { calendarVaultStorage, ensureFolder, removeEmptyFolder };
