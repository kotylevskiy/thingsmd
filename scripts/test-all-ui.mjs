import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const results = [];
const start = process.argv[2];
if (start && !(start in scripts)) throw new Error(`Unknown suite: ${start}`);
let running = !start;
// One renderer, one UI driver: never run these suites concurrently.
for (const [name, command] of Object.entries(scripts)) {
  if (!name.startsWith('test:') || name === 'test:all-ui') continue;
  if (name === start) running = true;
  if (!running) continue;
  console.log(`\nRunning ${name}`);
  const result = spawnSync(process.execPath, [command.replace(/^node /, '')], { stdio: 'inherit' });
  results.push({ name, passed: result.status === 0 });
  if (result.status !== 0 && !process.env.THINGSMD_CONTINUE_ON_FAILURE) break;
}
writeFileSync(
  new URL('../artifacts/control-regression-results.json', import.meta.url),
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
);
console.log(`\n${results.filter((r) => r.passed).length}/${results.length} live suites passed.`);
if (results.some((r) => !r.passed)) process.exitCode = 1;
