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
  // Closing the last note can remove its tab group before Obsidian creates
  // an empty replacement. Create in the root explicitly during that gap.
  return first || workspace.createLeafInParent(workspace.rootSplit, 0);
};
