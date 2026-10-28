const { setIcon, Notice } = require('obsidian');
const { upcomingDays, upcomingDates, inEvening } = require('../tasks/model.cjs');
const { today, dayAfter } = require('../shared/local-date.cjs');
const { button } = require('../shared/dom.cjs');
const { renderProgress } = require('../tasks/project-progress.cjs');

// Render sections through the view's shared row/group commands. Selection,
// draft lifetime, refresh and navigation stay in the view controller.
module.exports = function renderListContents(view, paper, active, progress) {
  if (view.page === 'logbook') {
    const { logbookGroups } = require('./logbook-groups.cjs');
    const { systemLocale } = require('../shared/system-locale.cjs');
    for (const { key, title, tasks } of logbookGroups(active, {
      timeZone: view.plugin.settings.timeZone,
      locale: systemLocale(),
    })) {
      const section = paper.createEl('section', {
        cls: 'ot-section ot-logbook-section',
        attr: { 'data-period': key },
      });
      section.createEl('h2', { text: title });
      view.group(section, tasks, key);
    }
  } else if (view.page === 'upcoming') {
    const dates = upcomingDays(active, today());
    for (const date of dates) {
      const section = paper.createEl('section', {
        cls: 'ot-section',
        attr: { 'data-date': date },
      });
      const [y, m, d] = date.split('-').map(Number);
      const dayHeading = section.createEl('h2', { cls: 'ot-day-heading' });
      dayHeading.createSpan({ cls: 'ot-day-number', text: String(d) });
      dayHeading.createSpan({ cls: 'ot-day-separator', attr: { 'aria-hidden': 'true' } });
      dayHeading.createSpan({
        cls: 'ot-day-name',
        text:
          date === dayAfter(1)
            ? 'Tomorrow'
            : new Intl.DateTimeFormat('en', {
                weekday: 'long',
                ...(date > dayAfter(7)
                  ? {
                      month: 'short',
                      ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
                    }
                  : {}),
              }).format(new Date(y, m - 1, d, 12)),
      });
      if (date <= dayAfter(7))
        section.createDiv({ cls: 'ot-calendar', attr: { 'data-calendar-date': date } });
      view.group(
        section,
        active.filter((task) => upcomingDates(task.meta, today()).includes(date)),
        date,
      );
    }
  } else if (view.page === 'today') {
    const waiting =
      view.plugin.settings.enableWaiting !== false && view.plugin.settings.showWaitingInToday
        ? active.filter((task) => task.meta.is_waiting === true)
        : [];
    const regular = active.filter((task) => !waiting.includes(task));
    view.group(
      paper,
      regular.filter((task) => !inEvening(task.meta, today())),
      null,
    );
    const evening = regular.filter((task) => inEvening(task.meta, today()));
    if (evening.length) {
      const section = paper.createEl('section', { cls: 'ot-section ot-evening-section' });
      const h = section.createEl('h2');
      setIcon(h.createSpan({ cls: 'ot-evening-icon', attr: { 'aria-hidden': 'true' } }), 'moon');
      h.createSpan({ text: 'This Evening' });
      view.group(section, evening, 'evening');
    }
    if (waiting.length) {
      const section = paper.createEl('section', {
        cls: 'ot-section ot-evening-section ot-waiting-section',
      });
      const h = section.createEl('h2');
      setIcon(
        h.createSpan({ cls: 'ot-evening-icon', attr: { 'aria-hidden': 'true' } }),
        'thingsmd-paper-plane',
      );
      h.createSpan({ text: 'Waiting For' });
      view.group(section, waiting, 'waiting');
    }
  } else if (['anytime', 'someday', 'waiting', 'repeating'].includes(view.page)) {
    const groups = new Map();
    for (const task of active) {
      const key =
        task.references?.[0] ||
        view.projects.find(
          (p) => p.meta.id === task.meta.project || p.file.path === task.meta.project,
        )?.file.path ||
        '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
    view.group(paper, groups.get('') || [], null);
    groups.delete('');
    for (const [key, tasks] of groups) {
      const section = paper.createEl('section', { cls: 'ot-section' });
      const project = view.projects.find((p) => p.file.path === key || p.meta.id === key);
      const heading = section.createEl('h2');
      if (project) {
        const link = button(
          heading,
          '',
          async (event) => {
            if (view.taskDraft && !(await view.finishTask(false))) return;
            const file = view.app.vault.getAbstractFileByPath(project.file.path);
            if (!file) {
              new Notice('This note is no longer available.');
              return;
            }
            const leaf =
              event.metaKey || event.ctrlKey ? view.app.workspace.getLeaf('tab') : view.leaf;
            await leaf.openFile(file);
            view.app.workspace.setActiveLeaf(leaf, { focus: true });
          },
          'ot-project-link',
        );
        link.setAttribute('aria-label', `Open note: ${project.meta.title}`);
        if (progress.has(project.file.path)) renderProgress(link, progress.get(project.file.path));
        link.createSpan({ text: project.meta.title });
      } else heading.textContent = key;
      view.group(section, tasks, key);
    }
  } else view.group(paper, active, null);
  if (view.page === 'inbox') {
    const moved = view.inboxSession.update(
      view.tasks,
      active,
      today(),
      view.plugin.settings.logbook,
      view.plugin.settings.timeZone,
    );
    if (moved.length) {
      const section = paper.createEl('section', { cls: 'ot-section ot-inbox-moved' });
      section.createEl('h2', {
        text: `${moved.length} ${moved.length === 1 ? 'to-do was' : 'to-dos were'} moved out of the Inbox`,
      });
      const group = section.createDiv('ot-group');
      group.dataset.orderKey = 'inbox';
      for (const task of moved) view.taskRow(group, task);
    }
  }
};
