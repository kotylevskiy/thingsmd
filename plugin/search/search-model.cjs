const { isFinished } = require('../tasks/task-status.cjs');
const { isLogged, inList } = require('../tasks/model.cjs');
const { PAGES: LISTS, isListAvailable } = require('../lists/lists.cjs');
const { dayKey: vaultDay } = require('../shared/vault-time.cjs');
const listTitles = new Map(LISTS.map(([page, title]) => [page, title]));
function search(records, query, { broad = false, today, settings = {} } = {}) {
  const projects = records.filter((r) => r.meta.type === 'thingsmd-project');
  const normalized = query.toLocaleLowerCase();
  const words = normalized.trim().split(/\s+/).filter(Boolean);
  const matches = (value) => {
    const text = String(value).toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  };
  const results = [];
  for (const [page, title, icon] of LISTS) {
    if (!isListAvailable(page, settings)) continue;
    if (matches(title)) results.push({ kind: 'list', title, icon, page, context: 'List' });
  }
  const vaultToday = settings.timeZone ? vaultDay(new Date(), settings.timeZone) : today;
  const tasks = records.filter(
    (r) =>
      r.meta.type === 'thingsmd-task' &&
      !r.meta.deleted &&
      (broad || !isLogged(r.meta, vaultToday, settings.logbook, settings.timeZone)),
  );
  const linkedProjects = new Set(tasks.map((task) => task.meta.project));
  const referencedProjects = new Set(tasks.flatMap((task) => task.references || []));
  const projectTitles = new Map();
  const projectPaths = new Map();
  for (const p of projects) {
    const { path } = p.file;
    const { id, title } = p.meta;
    if (!projectTitles.has(path)) projectTitles.set(path, title);
    for (const key of new Set([path, id])) {
      if (!projectPaths.has(key)) projectPaths.set(key, []);
      projectPaths.get(key).push(path);
    }
    if (
      (referencedProjects.has(path) || linkedProjects.has(path) || linkedProjects.has(id)) &&
      matches(title)
    )
      results.push({
        kind: 'project',
        title: p.meta.title,
        icon: 'file-text',
        path: p.file.path,
        context: 'Project',
      });
  }
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
            vaultToday,
          ),
      ) || 'anytime';
    const refs = [
      ...new Set([...(t.references || []), ...(projectPaths.get(t.meta.project) || [])]),
    ];
    for (const path of refs.length ? refs : [null]) {
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
        context: [projectTitles.get(path), listTitles.get(page)].filter(Boolean).join(' · '),
      });
    }
  }
  const ranks = new Map();
  for (const { title } of results) {
    const key = title.toLocaleLowerCase();
    ranks.set(title, key === normalized ? 0 : key.startsWith(normalized) ? 1 : 2);
  }
  return results.sort(
    (a, b) => ranks.get(a.title) - ranks.get(b.title) || a.title.localeCompare(b.title),
  );
}
module.exports = { search };
