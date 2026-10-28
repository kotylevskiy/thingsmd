const { parseYaml, stringifyYaml, Notice } = require('obsidian');
const { noteAccess } = require('./shared/note-access.cjs');
const { migrateFrontmatter } = require('./legacy-identifiers.cjs');

module.exports = async function migrateIdentifiers(plugin) {
  const { vault } = plugin.app;
  const notes = noteAccess(plugin.app);
  const failures = [];
  for (const file of vault.getMarkdownFiles()) {
    try {
      const disk = await vault.read(file);
      const before = await notes.read(file);
      const after = migrateFrontmatter(before, parseYaml, stringifyYaml);
      if (after === before) continue;
      if ((await vault.read(file)) !== disk) throw new Error('The file changed during migration.');
      await notes.write(file, before, after, { save: true });
    } catch (error) {
      failures.push(`${file.path}: ${error.message}`);
    }
  }
  if (failures.length)
    new Notice(
      `ThingsMD could not migrate some properties. Originals were preserved; reload to retry.\n${failures.join('\n')}`,
    );
};
