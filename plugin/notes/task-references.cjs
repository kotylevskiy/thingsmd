const { nextFence } = require('../shared/markdown-fence.cjs');

// Only standalone task references outside frontmatter/code fences are movable.
function taskReferences(text) {
  const result = [];
  let offset = 0,
    fence = null,
    yaml = false;
  for (const [index, line] of text.split('\n').entries()) {
    const value = line.replace(/\r$/, '');
    if (index === 0 && value === '---') yaml = true;
    else if (yaml) {
      if (value === '---') yaml = false;
    } else {
      const previousFence = fence;
      fence = nextFence(fence, value);
      const match = !previousFence && !fence && value.match(/^!\[\[([^\]|#]+)\]\]$/);
      if (match)
        result.push({
          path: match[1].endsWith('.md') ? match[1] : match[1] + '.md',
          from: offset,
          to: Math.min(offset + line.length + 1, text.length),
        });
    }
    offset += line.length + 1;
  }
  return result;
}
function referenceRanges(text, path) {
  return taskReferences(text)
    .filter((reference) => reference.path === path)
    .map(({ from, to }) => ({ from, to }));
}
function removeReferences(text, path) {
  for (const range of referenceRanges(text, path).reverse())
    text = text.slice(0, range.from) + text.slice(range.to);
  return text;
}
function insertReference(text, path, offset = text.length, reposition = false) {
  const ranges = referenceRanges(text, path);
  if (ranges.length && !reposition) return text;
  offset = Math.max(0, Math.min(offset, text.length));
  if (reposition) {
    const removed = ranges.reduce(
      (sum, r) => sum + Math.max(0, Math.min(offset, r.to) - r.from),
      0,
    );
    text = removeReferences(text, path);
    offset -= removed;
  }
  let fence = null,
    yaml = false;
  const lines = text.slice(0, offset).split('\n');
  for (const [index, line] of lines.entries()) {
    const value = line.replace(/\r$/, '');
    if (index === 0 && value === '---') yaml = true;
    else if (yaml) {
      if (value === '---') yaml = false;
    } else fence = nextFence(fence, value);
  }
  if (yaml || fence || (offset === 0 && /^---\r?\n/.test(text)))
    throw new Error('Place the cursor in the note body, outside properties and code blocks.');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return (
    text.slice(0, offset) +
    (offset && text[offset - 1] !== '\n' ? newline : '') +
    `![[${path.replace(/\.md$/, '')}]]` +
    newline +
    text.slice(offset)
  );
}

module.exports = { taskReferences, referenceRanges, removeReferences, insertReference };
