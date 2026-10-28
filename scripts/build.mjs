import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
const notices = (
  await Promise.all(
    ['ical.js', 'moment', 'moment-timezone'].map(
      async (name) =>
        `${name}\n${await readFile(new URL(`node_modules/${name}/LICENSE`, root), 'utf8')}`,
    ),
  )
).join('\n\n');
await build({
  stdin: {
    contents: await readFile(new URL('plugin/main.js', root), 'utf8'),
    resolveDir: fileURLToPath(new URL('plugin/', root)),
    sourcefile: 'main.cjs',
    loader: 'js',
  },
  outfile: fileURLToPath(new URL('main.js', output)),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'electron', '@electron/remote', '@codemirror/*'],
  legalComments: 'inline',
  banner: { js: `/* Third-party licenses\n${notices}\n*/` },
});
await copyFile(new URL('plugin/styles.css', root), new URL('styles.css', output));
await copyFile(new URL('manifest.json', root), new URL('manifest.json', output));
await writeFile(
  new URL('THIRD_PARTY_NOTICES.md', output),
  'Sources: https://github.com/kewisch/ical.js and https://momentjs.com/. IANA timezone data is public domain. Versions are pinned in package-lock.json.\n\n' +
    notices,
);
console.log(`Built ${fileURLToPath(output)}`);
