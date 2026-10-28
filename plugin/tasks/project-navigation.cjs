const { Menu, Notice } = require('obsidian');
const { taskReferences } = require('../notes/task-references.cjs');
const { noteAccess } = require('../shared/note-access.cjs');
const mainWorkspaceLeaf = require('../workspace-leaf.cjs');

async function destinations(plugin, task) {
  return (await plugin.records()).filter(
    (record) =>
      record.meta.type === 'thingsmd-project' &&
      taskReferences(record.body).some((reference) => reference.path === task.file.path),
  );
}
async function open(plugin, task, project) {
  const file = plugin.app.vault.getAbstractFileByPath(project.file.path);
  if (!file) throw new Error('This project note is unavailable.');
  const text = await noteAccess(plugin.app).read(file);
  const reference = taskReferences(text).find((ref) => ref.path === task.file.path);
  if (!reference) throw new Error('This task is no longer in that project.');
  const line = text.slice(0, reference.from).split('\n').length - 1;
  const leaf = mainWorkspaceLeaf(plugin.app.workspace);
  await leaf.openFile(file, { eState: { line } });
  await plugin.app.workspace.revealLeaf(leaf);
}
async function show(plugin, task) {
  const generation = plugin.beginTaskMenu();
  const projects = await destinations(plugin, task);
  if (!projects.length) throw new Error('This task is no longer in a project note.');
  if (projects.length === 1) return open(plugin, task, projects[0]);
  const menu = new Menu();
  menu.setUseNativeMenu(false);
  for (const project of projects)
    menu.addItem((item) =>
      item
        .setTitle(project.file.path)
        .setIcon('file-text')
        .onClick(() => open(plugin, task, project).catch((error) => new Notice(error.message))),
    );
  plugin.presentTaskMenu(menu, { clientX: innerWidth / 2, clientY: innerHeight / 2 }, generation);
}
module.exports = { destinations, show };
