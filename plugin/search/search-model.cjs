const { isFinished } = require('../tasks/task-status.cjs');
const { isLogged, inList } = require('../tasks/model.cjs');
const { PAGES: LISTS, isListAvailable } = require('../lists/lists.cjs');
function search(records, query, { broad = false, today, settings = {} } = {}) {
  const projects = records.filter((r) => r.meta.type === 'thingsmd-project');
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (value) => words.every((w) => String(value).toLocaleLowerCase().includes(w));
  const results = [];
  for (const [page, title, icon] of LISTS) {
    if (!isListAvailable(page, settings)) continue;
    if (matches(title)) results.push({ kind: 'list', title, icon, page, context: 'List' });
  }
  const tasks = records.filter(
    (r) =>
      r.meta.type === 'thingsmd-task' &&
      !r.meta.deleted &&
      (broad ||
        !isLogged(
          r.meta,
          settings.timeZone ? undefined : today,
          settings.logbook,
          settings.timeZone,
        )),
  );
  for (const p of projects.filter((p) =>
    tasks.some(
      (t) =>
        t.references?.includes(p.file.path) ||
        t.meta.project === p.file.path ||
        t.meta.project === p.meta.id,
    ),
  ))
    if (matches(p.meta.title))
      results.push({
        kind: 'project',
        title: p.meta.title,
        icon: 'file-text',
        path: p.file.path,
        context: 'Project',
      });
  for (const t of tasks) {
    const text = [
      t.meta.title,
      ...(broad ? [t.body, ...(t.meta.checklist || []).map((c) => c.text)] : []),
    ].join('\n');
    if (!matches(text)) continue;
    const page =
      ['logbook', 'waiting', 'repeating', 'today', 'someday', 'upcoming', 'inbox', 'anytime'].find(
        (p) =>
          inList(
            t,
            p,
            today,
            settings.logbook,
            settings.captureDestination,
            settings.enableWaiting,
            settings.timeZone,
          ),
      ) || 'anytime';
    const refs = [
      ...new Set([
        ...(t.references || []),
        ...projects
          .filter((p) => p.file.path === t.meta.project || p.meta.id === t.meta.project)
          .map((p) => p.file.path),
      ]),
    ];
    for (const path of refs.length ? refs : [null]) {
      const project = projects.find((p) => p.file.path === path);
      results.push({
        kind: 'task',
        title: t.meta.title || 'New task',
        icon:
          t.meta.status === 'canceled'
            ? 'square-x'
            : isFinished(t.meta)
              ? 'circle-check'
              : 'square',
        id: t.meta.id,
        path,
        page,
        context: [project?.meta.title, LISTS.find((l) => l[0] === page)?.[1]]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }
  return results.sort((a, b) => {
    const rank = (r) =>
      r.title.toLocaleLowerCase() === query.toLocaleLowerCase()
        ? 0
        : r.title.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())
          ? 1
          : 2;
    return rank(a) - rank(b) || a.title.localeCompare(b.title);
  });
}
module.exports = { search };
