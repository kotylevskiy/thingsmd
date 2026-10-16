const { referenceRanges } = require('./task-references.cjs');
function projectProgress(records) {
  const result = new Map(),
    tasks = records.filter(
      (t) => t.meta.type !== 'things-project' && !t.meta.deleted && !t.meta.repeat,
    );
  for (const note of records.filter((t) => t.meta.type === 'things-project')) {
    const seen = new Set();
    let total = 0,
      done = 0;
    for (const task of tasks) {
      if (seen.has(task.file.path) || !referenceRanges(note.body || '', task.file.path).length)
        continue;
      seen.add(task.file.path);
      total++;
      if (task.meta.status === 'done') done++;
    }
    if (total) result.set(note.file.path, { total, done });
  }
  return result;
}
function renderProgress(parent, progress) {
  const el = parent.ownerDocument.createElement('span');
  el.className = 'ot-project-progress';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${progress.done} of ${progress.total} tasks completed`);
  el.title = el.getAttribute('aria-label');
  const svg = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const shape = (tag, attrs) => {
    const node = parent.ownerDocument.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.appendChild(node);
  };
  shape('circle', {
    cx: 8,
    cy: 8,
    r: 6.5,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.5,
  });
  const fraction = Math.max(0, Math.min(1, progress.done / progress.total));
  if (fraction === 1) shape('circle', { cx: 8, cy: 8, r: 4.5, fill: 'currentColor' });
  else if (fraction > 0) {
    const angle = fraction * 2 * Math.PI,
      x = 8 + 4.5 * Math.sin(angle),
      y = 8 - 4.5 * Math.cos(angle);
    shape('path', {
      d: `M 8 8 L 8 3.5 A 4.5 4.5 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y} Z`,
      fill: 'currentColor',
    });
  }
  el.appendChild(svg);
  el.dataset.progress = `${progress.done}/${progress.total}`;
  parent.appendChild(el);
  return el;
}
function install(plugin) {
  let progress = new Map(),
    timer,
    disposed = false,
    running = false,
    again = false;
  const roots = new Map();
  const paint = () => {
    for (const root of roots.keys())
      for (const row of root.querySelectorAll('.nav-file-title[data-path]')) {
        const value = plugin.settings.showProjectProgress && progress.get(row.dataset.path),
          old = row.querySelector('.ot-project-progress');
        if (!value) {
          old?.remove();
          continue;
        }
        if (old?.dataset.progress === `${value.done}/${value.total}`) continue;
        old?.remove();
        const el = renderProgress(row, value);
        row.insertBefore(el, row.querySelector('.nav-file-title-content') || row.firstChild);
      }
  };
  const attach = () => {
    const current = new Set(
      plugin.app.workspace.getLeavesOfType('file-explorer').map((l) => l.view.containerEl),
    );
    for (const [root, observer] of roots)
      if (!current.has(root)) {
        observer.disconnect();
        root.querySelectorAll('.ot-project-progress').forEach((el) => el.remove());
        roots.delete(root);
      }
    for (const root of current)
      if (!roots.has(root)) {
        const observer = new MutationObserver(paint);
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-path'],
        });
        roots.set(root, observer);
      }
    paint();
  };
  const refresh = async () => {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      progress = plugin.settings.showProjectProgress
        ? projectProgress(await plugin.records())
        : new Map();
      if (!disposed) attach();
    } catch (error) {
      console.error('ThingsMD project progress:', error);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 100);
  };
  plugin.registerEvent(plugin.app.workspace.on('things-tasks-changed', schedule));
  plugin.registerEvent(plugin.app.workspace.on('layout-change', attach));
  for (const event of ['create', 'modify', 'delete', 'rename'])
    plugin.registerEvent(plugin.app.vault.on(event, schedule));
  plugin.app.workspace.onLayoutReady(() => {
    if (!disposed) {
      attach();
      schedule();
    }
  });
  plugin.register(() => {
    disposed = true;
    clearTimeout(timer);
    for (const [root, observer] of roots) {
      observer.disconnect();
      root.querySelectorAll('.ot-project-progress').forEach((el) => el.remove());
    }
    roots.clear();
  });
}
module.exports = { projectProgress, renderProgress, install };
