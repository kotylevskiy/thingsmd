// Navigation must never turn a sidebar pane into a task list or project note.
module.exports = function mainWorkspaceLeaf(workspace) {
  const isMain = (leaf) => leaf?.getRoot() === workspace.rootSplit;
  if (isMain(workspace.activeLeaf)) return workspace.activeLeaf;
  const recent = workspace.getMostRecentLeaf();
  if (isMain(recent)) return recent;
  let first;
  workspace.iterateAllLeaves((leaf) => {
    if (!first && isMain(leaf)) first = leaf;
  });
  return first || workspace.getLeaf('tab');
};
