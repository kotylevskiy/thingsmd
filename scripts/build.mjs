import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
// Bundle each local module once and cache its exports, like CommonJS.
// Obsidian, Electron, and CodeMirror remain host-provided dependencies.
const modules = new Map();
async function collect(name) {
  if (modules.has(name)) return;
  const source = await readFile(new URL(`plugin/${name}`, root), 'utf8');
  modules.set(name, source);
  for (const match of source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) await collect(match[1]);
}
await collect('main.js');
const factories = [...modules]
  .map(
    ([name, source]) =>
      `${JSON.stringify('./' + name)}: (module, exports, require) => {\n${source}\n}`,
  )
  .join(',\n');
const bundled = `const hostRequire = require;
const factories = {${factories}};
const cache = Object.create(null);
function load(name) {
  if (!Object.hasOwn(factories, name)) return hostRequire(name);
  if (cache[name]) return cache[name].exports;
  const entry = cache[name] = { exports: {} };
  factories[name](entry, entry.exports, load);
  return entry.exports;
}
module.exports = load('./main.js');
`;
await writeFile(new URL('main.js', output), bundled);
await copyFile(new URL('plugin/styles.css', root), new URL('styles.css', output));
await copyFile(new URL('manifest.json', root), new URL('manifest.json', output));
console.log(`Built ${fileURLToPath(output)}`);
