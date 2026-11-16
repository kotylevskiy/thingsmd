const { nextFence } = require('../shared/markdown-fence.cjs');
const { taskReferences } = require('../notes/task-references.cjs');

// Only standalone task cards can become checkbox list items without rewriting
// surrounding prose. Keep the file when another kind of live link still needs it.
function hasOtherLinks(text, path, sourcePath, resolve, allowPlacements = true) {
  const placements = allowPlacements ? taskReferences(text) : [];
  let offset = 0,
    fence = null;
  for (const line of text.split('\n')) {
    const value = line.replace(/\r$/, '');
    const previous = fence;
    fence = nextFence(fence, value);
    if (!previous && !fence) {
      // Mask inline code without changing offsets.
      const visible = value.replace(/(`+).*?\1/g, (code) => ' '.repeat(code.length));
      const pattern = /!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|\[[^\]]*\]\(([^\s)]+)\)/g;
      for (const match of visible.matchAll(pattern)) {
        let target;
        try {
          target = decodeURIComponent(match[1] || match[2]);
        } catch {
          continue;
        }
        const resolved =
          resolve?.(target, sourcePath)?.path || (target.endsWith('.md') ? target : target + '.md');
        if (resolved !== path) continue;
        const position = offset + match.index;
        if (
          !placements.some((ref) => ref.path === path && position >= ref.from && position < ref.to)
        )
          return true;
      }
    }
    offset += line.length + 1;
  }
  return false;
}
module.exports = { hasOtherLinks };
