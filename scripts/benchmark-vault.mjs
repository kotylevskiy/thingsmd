import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { connectTestVault } from './obsidian-connection.mjs';
import { testVault } from './test-vault.mjs';
import { waitForAsync } from './wait-for-async.mjs';

// Run against each deployed build in the same disposable Obsidian instance.
const taskCount = Number(process.argv[2] || 500);
const noteCount = Number(process.argv[3] || 2000);
const editorLines = Number(process.argv[4] || 3600);
if (
  !Number.isSafeInteger(taskCount) ||
  !Number.isSafeInteger(noteCount) ||
  taskCount < 1 ||
  noteCount < taskCount ||
  noteCount > 10000 ||
  !Number.isSafeInteger(editorLines) ||
  editorLines < 101 ||
  editorLines > 100000
)
  throw Error('Supply 1 to 10000 fixtures and an editor note with 101 to 100000 prose lines.');
const vault = await testVault();
const { browser, page } = await connectTestVault();
const prefix = 'ThingsMD benchmark ';
const taskPaths = [];
const created = [];
let noteFolder;
try {
  const folder = await page.evaluate(() => app.plugins.getPlugin('thingsmd').settings.tasksFolder);
  await mkdir(join(vault, folder), { recursive: true });
  const projectFolder = join(vault, prefix.trim());
  await mkdir(projectFolder);
  noteFolder = projectFolder;
  const prose = 'A line of ordinary project notes.\n'.repeat(24);
  const fixtures = [];
  for (let i = 0; i < noteCount; i++) {
    const path = `${folder}/${prefix}${i}.md`;
    if (i < taskCount) {
      taskPaths.push(path);
      const date = new Date();
      date.setDate(date.getDate() + 1 + (i % 75));
      const day = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
      fixtures.push([
        join(vault, path),
        `---\ntype: thingsmd-task\nid: benchmark-${i}\ntitle: Benchmark task ${i}\nstatus: todo\nwhen: ${day}\n---\nTask notes\n`,
      ]);
    }
    fixtures.push([
      join(noteFolder, `Project ${i}.md`),
      prose + (i < taskCount ? `![[${path}]]\n` : ''),
    ]);
  }
  const editorNote = `${prefix.trim()}/Editor.md`;
  fixtures.push([
    join(vault, editorNote),
    'A line of ordinary project notes.\n'.repeat(editorLines) +
      taskPaths
        .slice(0, 40)
        .map((path) => `![[${path}]]\n`)
        .join(''),
  ]);
  for (let offset = 0; offset < fixtures.length; offset += 32) {
    const results = await Promise.allSettled(
      fixtures.slice(offset, offset + 32).map(async ([path, text]) => {
        await writeFile(path, text, { flag: 'wx' });
        created.push(path);
      }),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  await waitForAsync(
    page,
    ({ prefix, taskCount, noteCount }) => {
      const files = app.vault.getMarkdownFiles();
      return (
        files.filter((f) => f.basename.startsWith(prefix)).length === taskCount &&
        files.filter((f) => f.path.startsWith(prefix.trim() + '/')).length === noteCount + 1
      );
    },
    { prefix, taskCount, noteCount },
    { timeout: 60000 },
  );
  const reloadMs = await page.evaluate(async () => {
    await app.plugins.disablePlugin('thingsmd');
    const start = performance.now();
    await app.plugins.enablePlugin('thingsmd');
    const plugin = app.plugins.getPlugin('thingsmd');
    await plugin.openList('upcoming');
    await plugin.records();
    return Number((performance.now() - start).toFixed(2));
  });
  await setTimeout(3500);
  const report = await page.evaluate(
    async ({ folder, prefix, editorNote, taskCount }) => {
      const plugin = app.plugins.getPlugin('thingsmd');
      const adapter = app.vault.adapter;
      const read = adapter.read;
      const list = adapter.list;
      let counts;
      const reset = () => (counts = { taskReads: 0, noteReads: 0, folderLists: 0 });
      reset();
      adapter.read = function (path, ...args) {
        if (path.startsWith(folder + '/' + prefix)) counts.taskReads++;
        else if (path.startsWith(prefix.trim() + '/')) counts.noteReads++;
        return read.call(this, path, ...args);
      };
      adapter.list = function (path, ...args) {
        if (path === folder) counts.folderLists++;
        return list.call(this, path, ...args);
      };
      const median = (samples) =>
        Number(samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(2));
      const measure = async (fn, runs) => {
        const samples = [];
        for (let i = 0; i < runs; i++) {
          const start = performance.now();
          await fn(i);
          samples.push(performance.now() - start);
        }
        return median(samples);
      };
      try {
        await new Promise((resolve) => setTimeout(resolve, 6500));
        const idle = { durationMs: 6500, ...counts };
        reset();
        const snapshotMs = await measure(
          () => Promise.all([plugin.records(), plugin.records(), plugin.records()]),
          5,
        );
        const snapshot = { medianMs: snapshotMs, runs: 5, ...counts };
        await plugin.openList('upcoming');
        const upcoming = app.workspace.activeLeaf.view;
        const upcomingMs = await measure(() => upcoming.render(), 7);
        const upcomingRows = upcoming.contentEl.querySelectorAll('.ot-task').length;
        if (upcoming.page !== 'upcoming' || upcomingRows !== taskCount) {
          const task = (await plugin.records()).find((record) => record.meta.id === 'benchmark-0');
          throw Error(
            `Expected ${taskCount} Upcoming rows, found ${upcomingRows} on ${upcoming.page}. First task: ${JSON.stringify(task?.meta)}`,
          );
        }
        await plugin.openSearch('Benchmark task 3');
        const search = plugin.searchModal;
        await search.refresh();
        const searchMs = await measure((i) => {
          search.input.value = i % 2 ? 'Benchmark task 3' : 'Benchmark task 7';
          search.draw();
        }, 20);
        const searchResults = search.results.length;
        search.close();
        const leaf = app.workspace.activeLeaf;
        await leaf.openFile(app.vault.getAbstractFileByPath(editorNote));
        await leaf.setViewState({
          type: 'markdown',
          state: { file: editorNote, mode: 'source', source: false },
        });
        const editor = leaf.view.editor;
        if (!leaf.view.containerEl.querySelector('.is-live-preview'))
          throw Error('Benchmark note did not open in Live Preview.');
        const editorMs = await measure((i) => {
          editor.replaceRange(
            i % 2 ? '' : 'a',
            { line: 100, ch: 2 },
            { line: 100, ch: 2 + (i % 2) },
          );
        }, 40);
        await plugin.openList('inbox');
        return {
          idle,
          snapshot,
          upcoming: { medianMs: upcomingMs, rows: upcomingRows },
          quickFind: { medianMs: searchMs, results: searchResults },
          livePreview: { medianMs: editorMs, edits: 40 },
        };
      } finally {
        adapter.read = read;
        adapter.list = list;
      }
    },
    { folder, prefix, editorNote, taskCount },
  );
  console.log(
    JSON.stringify(
      { taskCount, noteCount: noteCount + 1, editorLines, reloadMs, ...report },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await Promise.all(created.map((path) => rm(path, { force: true })));
  if (noteFolder) await rm(noteFolder, { recursive: true, force: true });
}
