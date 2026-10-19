const { taskReferences } = require('./task-references.cjs');

// A rendered standalone embed is one task, not editable bracket characters.
// Include the adjoining newline because that is where Live Preview leaves the
// caret after navigating out of a block widget. Source mode never calls this.
function deletionTarget(text, position, key) {
  if (!['Backspace', 'Delete'].includes(key)) return null;
  return (
    taskReferences(text).find((ref) => {
      const end = ref.to - (text[ref.to - 1] === '\n' ? 1 : 0);
      return key === 'Backspace'
        ? position > ref.from && position <= ref.to
        : (position >= ref.from && position < end) || position === ref.from - 1;
    }) || null
  );
}
module.exports = { deletionTarget };
