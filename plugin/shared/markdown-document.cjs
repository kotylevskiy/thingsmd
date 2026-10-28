// Markdown boundaries are shared by storage, note previews and editor protection.
// Keep the body byte-for-byte intact; only storage owns YAML serialization.
function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)^---[\t ]*(?:\r?\n|$)/m);
  if (match?.index !== 0) return null;
  return match ? { yaml: match[1], body: match[0].length, to: match[0].trimEnd().length } : null;
}
function decode(text, parseYaml) {
  const range = frontmatter(text);
  const meta = range ? (parseYaml(range.yaml) ?? {}) : {};
  if (typeof meta !== 'object' || Array.isArray(meta))
    throw new Error('Note properties must be a YAML mapping.');
  return { meta, body: range ? text.slice(range.body) : text };
}
module.exports = { frontmatter, decode };
