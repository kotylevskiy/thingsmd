// Old names are read only for migration. New records, UI, and events use ThingsMD.
const LEGACY_VIEW = 'things-project-view';
const types = { 'things-task': 'thingsmd-task', 'things-project': 'thingsmd-project' };
const canonicalType = (type) => (Object.hasOwn(types, type) ? types[type] : type);

function migrateFrontmatter(text, parseYaml, stringifyYaml) {
  const match = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!match) return text;
  if (!Object.keys(types).some((type) => match[2].includes(type))) return text;
  const meta = parseYaml(match[2]);
  if (!meta || canonicalType(meta.type) === meta.type) return text;
  const type = canonicalType(meta.type);
  // Preserve whitespace, comments, quoting, other properties, and the entire body.
  const line =
    /^(type|"type"|'type')([ \t]*:[ \t]*)(["']?)(things-task|things-project)\3([ \t]*(?:#[^\r\n]*)?)(\r?)$/m;
  let yaml = match[2].replace(
    line,
    (_, key, colon, quote, old, tail, cr) =>
      `${key}${colon}${quote}${canonicalType(old)}${quote}${tail}${cr}`,
  );
  if (yaml === match[2]) {
    // Flow-style YAML and tagged scalars need a structured rewrite.
    meta.type = type;
    yaml = stringifyYaml(meta).trimEnd();
    if (match[1].includes('\r\n')) yaml = yaml.replace(/\r?\n/g, '\r\n');
  }
  return match[1] + yaml + match[3] + text.slice(match[0].length);
}
module.exports = { LEGACY_VIEW, canonicalType, migrateFrontmatter };
