// A closing fence must use the same character, be at least as long, and
// contain only whitespace after its marker. Shorter fences are literal code.
function nextFence(fence, line) {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!marker) return fence;
  const [, run, tail] = marker;
  if (fence)
    return run[0] === fence[0] && run.length >= fence.length && !tail.trim() ? null : fence;
  if (run[0] === '`' && tail.includes('`')) return null;
  return run;
}
module.exports = { nextFence };
