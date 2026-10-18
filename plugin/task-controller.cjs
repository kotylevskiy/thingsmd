// Resolve the shared editor without making commands depend on a particular host.
// Native task notes and embedded cards own their controller on the DOM root;
// list views expose theirs directly. Deferred views may not have one yet.
module.exports = (row, view) =>
  row.closest('.ot-task-note-controls,.ot-native')?._thingsmdCard ||
  view?.taskEditorController ||
  view;
