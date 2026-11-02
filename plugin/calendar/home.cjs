const { SNAPSHOT } = require('./snapshot.cjs');
const { ensureFolder } = require('./vault-storage.cjs');
const LEGACY_ROOT = 'ThingsMD Calendars';
const calendarRoot = (home) => `${home}/Calendars`;

// Move only ThingsMD snapshot files. Leave unrelated files and conflicting copies intact.
async function moveCalendarHome(
  plugin,
  home,
  commit = async () => {},
  from = plugin.calendar.root,
) {
  const service = plugin.calendar;
  const to = calendarRoot(home);
  if (from === to) return commit();
  if (service.moving) throw new Error('A calendar folder change is already running.');
  service.moving = true;
  const vault = plugin.app.vault;
  const adapter = vault.adapter;
  const moved = [],
    folders = [];
  try {
    await Promise.allSettled([...service.pending.values()]);
    const entries = [];
    if (await adapter.exists(from)) {
      for (const folder of (await adapter.list(from)).folders) {
        const id = folder.slice(from.length + 1);
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) continue;
        folders.push(folder);
        for (const path of (await adapter.list(folder)).files) {
          if (!SNAPSHOT.test(path.slice(folder.length + 1))) continue;
          const filename = path.slice(folder.length + 1);
          let target = `${to}/${id}/${filename}`;
          if (await adapter.exists(target)) {
            if ((await adapter.read(path)) !== (await adapter.read(target)))
              throw new Error(
                `Calendar folder already contains ${target}. No calendars were moved.`,
              );
            // Sync can leave the same immutable snapshot in both homes. Give the
            // incoming copy a fresh name so neither copy is overwritten or deleted.
            do {
              const match = SNAPSHOT.exec(filename);
              target = `${to}/${id}/${match[1]}_${service.uuid()}${match[2] ? `_s-${match[2]}` : ''}.ics`;
            } while (await adapter.exists(target));
          }
          entries.push({ path, target });
        }
      }
    }
    for (const entry of entries) {
      await ensureFolder(vault, entry.target.slice(0, entry.target.lastIndexOf('/')));
      const file = vault.getAbstractFileByPath(entry.path);
      if (!file) throw new Error('A calendar snapshot changed during migration. Try again.');
      await vault.rename(file, entry.target);
      moved.push(entry);
    }
    await commit();
    service.root = to;
    const paths = new Map(moved.map(({ path, target }) => [path, target]));
    // Old asynchronous scans must never publish paths from the previous home.
    service.states = new Map(
      [...service.states].map(([id, state]) => [
        id,
        {
          ...state,
          snapshot: state.snapshot && {
            ...state.snapshot,
            path: paths.get(state.snapshot.path) || state.snapshot.path,
          },
        },
      ]),
    );
  } catch (error) {
    const failures = [];
    for (const entry of moved.reverse()) {
      try {
        if (await adapter.exists(entry.path))
          throw new Error(`Retained conflicting copy: ${entry.target}`);
        const file = vault.getAbstractFileByPath(entry.target);
        if (!file) throw new Error(`Calendar snapshot was moved externally: ${entry.target}`);
        await vault.rename(file, entry.path);
      } catch (failure) {
        failures.push(failure.message);
      }
    }
    throw new Error([error.message, ...failures].join('\n'));
  } finally {
    service.moving = false;
  }
  // Delete empty old folders only; never recursively delete a calendar directory.
  for (const folder of [...folders, from]) {
    try {
      if (!(await adapter.exists(folder))) continue;
      const children = await adapter.list(folder);
      if (!children.files.length && !children.folders.length) {
        await adapter.rmdir(folder, false);
      }
    } catch {
      /* Some adapters cannot remove folders nonrecursively. Retain empty folders
         rather than risk deleting a file that sync added since the check. */
    }
  }
  await service.reload();
}

module.exports = { calendarRoot, LEGACY_ROOT, moveCalendarHome };
