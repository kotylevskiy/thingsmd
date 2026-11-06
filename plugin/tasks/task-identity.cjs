// Elect one document per task identity without recognizing a sync provider's
// filename convention. A fixed comparison makes equal file sets agree on every
// device. Selection never merges, renames or deletes the other versions.
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const filename = (task) => task.file.path.split('/').pop();
function compareVersions(a, b) {
  const aName = filename(a),
    bName = filename(b);
  const expected = `${a.meta.id}.md`;
  return (
    Number(bName === expected) - Number(aName === expected) ||
    aName.length - bName.length ||
    compareText(aName, bName) ||
    compareText(a.file.path, b.file.path)
  );
}
function selectTaskVersions(records) {
  const groups = new Map();
  for (const task of records) {
    // Missing/malformed IDs do not establish a shared identity.
    const key = typeof task.meta.id === 'string' && task.meta.id.trim() ? task.meta.id : task;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  return [...groups.values()].map((versions) => {
    if (versions.length === 1) return versions[0];
    const [selected, ...conflicts] = [...versions].sort(compareVersions);
    return { ...selected, conflicts };
  });
}

// A view also needs to explain copies that used to appear here, even when the
// selected version now belongs to another list (for example Done vs Today).
function conflictsMatching(tasks, matches) {
  return tasks.filter((task) => task.conflicts?.length && [task, ...task.conflicts].some(matches));
}
module.exports = { selectTaskVersions, conflictsMatching };
