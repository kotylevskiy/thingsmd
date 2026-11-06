const { setIcon, Notice } = require('obsidian');

// The disclosure is read-only: all versions remain available in native notes.
// Keep it inline so users can continue working without dismissing a modal.
module.exports = function renderTaskConflictNotice(parent, tasks, plugin) {
  if (!tasks.length) return;
  const notice = parent.createDiv({
    cls: 'ot-task-conflict-notice',
    attr: { role: 'region', 'aria-label': 'Task conflicts' },
  });
  const heading = notice.createDiv('ot-task-conflict-heading');
  setIcon(
    heading.createSpan({ cls: 'ot-task-conflict-icon', attr: { 'aria-hidden': 'true' } }),
    'triangle-alert',
  );
  const text = heading.createDiv('ot-task-conflict-text');
  text.createEl('strong', {
    text:
      tasks.length === 1
        ? 'Conflicting task copies found'
        : `Conflicting copies of ${tasks.length} tasks found`,
  });
  text.createDiv({
    cls: 'ot-task-conflict-description',
    text: 'Using one version per task. Other copies are preserved.',
  });
  const details = notice.createEl('details', { cls: 'ot-task-conflict-details' });
  details.createEl('summary', { text: 'Review copies' });
  for (const task of tasks) {
    const group = details.createDiv('ot-task-conflict-group');
    group.createDiv({ cls: 'ot-task-conflict-title', text: task.meta.title || 'Untitled task' });
    for (const version of [task, ...task.conflicts]) {
      const row = group.createDiv('ot-task-conflict-file');
      row.createSpan({
        cls: 'ot-task-conflict-label',
        text: version === task ? 'In use' : 'Extra copy',
      });
      const link = row.createEl('a', { text: version.file.path, attr: { href: '#' } });
      link.onclick = async (event) => {
        event.preventDefault();
        try {
          const file = plugin.app.vault.getAbstractFileByPath(version.file.path);
          if (!file) throw new Error('This file is no longer available.');
          const leaf = plugin.app.workspace.getLeaf('tab');
          await leaf.openFile(file);
          await plugin.app.workspace.revealLeaf(leaf);
        } catch (error) {
          new Notice(error.message);
        }
      };
    }
  }
  return notice;
};
