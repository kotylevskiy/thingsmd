const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { canonicalType, migrateFrontmatter } = require('../plugin/legacy-identifiers.cjs');

// Historical identifiers deliberately remain in migration fixtures only.
const oldTask = 'things-task',
  oldProject = 'things-project';
test('property migration preserves quoted YAML, comments, CRLF and Markdown examples', () => {
  for (const old of [oldTask, oldProject]) {
    const before = `---\r\n"type": '${old}' # keep\r\ntitle: Example\r\n---\r\nBody\r\n\`type: ${old}\`\r\n`;
    const after = migrateFrontmatter(
      before,
      () => ({ type: old }),
      () => assert.fail('Must preserve YAML'),
    );
    assert.equal(after, before.replace(`'${old}'`, `'${canonicalType(old)}'`));
    assert.equal(
      migrateFrontmatter(after, () => ({ type: canonicalType(old) })),
      after,
    );
  }
});
test('flow-style metadata migrates without changing other values or the body', () => {
  const before = `---\n${JSON.stringify({ type: oldTask, title: oldTask, tags: ['work'] })}\n---\nBody\n`;
  const after = migrateFrontmatter(before, JSON.parse, JSON.stringify);
  assert.equal(after, before.replace(`"type":"${oldTask}"`, '"type":"thingsmd-task"'));
});
test('ordinary text and unrelated property values are not renamed', () => {
  const before = `---\n${JSON.stringify({ type: 'example', title: oldTask })}\n---\n${oldTask}`;
  assert.equal(migrateFrontmatter(before, JSON.parse, JSON.stringify), before);
  assert.equal(migrateFrontmatter(oldTask, JSON.parse, JSON.stringify), oldTask);
});
function fixture({ draft = false, conflict = false } = {}) {
  const filename = require.resolve('../plugin/identifier-migration.cjs');
  const localRequire = createRequire(filename);
  const module = { exports: {} },
    notices = [];
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: (name) =>
      name === 'obsidian'
        ? {
            parseYaml: JSON.parse,
            stringifyYaml: JSON.stringify,
            Notice: class {
              constructor(message) {
                notices.push(message);
              }
            },
          }
        : localRequire(name),
  });
  const file = { path: 'ThingsMD/task.md' };
  let disk = `---\n{"type":"${oldTask}","title":"Task"}\n---\nSaved body`,
    buffer = disk + '\nUnsaved text',
    reads = 0;
  const view = {
    file,
    getMode: () => 'source',
    editor: {
      getValue: () => buffer,
      offsetToPos: (ch) => ({ line: 0, ch }),
      replaceRange: (next, from, to) => {
        buffer = buffer.slice(0, from.ch) + next + buffer.slice(to.ch);
      },
    },
    save: async () => {
      disk = buffer;
    },
  };
  const plugin = {
    app: {
      workspace: { getLeavesOfType: () => (draft ? [{ view }] : []) },
      vault: {
        getMarkdownFiles: () => [file],
        read: async () => {
          if (conflict && ++reads === 3) disk += '\nExternal change';
          return disk;
        },
        process: async (file, change) => {
          disk = change(disk);
        },
      },
    },
  };
  return { run: () => module.exports(plugin), disk: () => disk, buffer: () => buffer, notices };
}
test('migration keeps and saves unsaved native editor text', async () => {
  const f = fixture({ draft: true });
  await f.run();
  assert.ok(f.disk().includes('thingsmd-task'));
  assert.ok(f.disk().endsWith('Unsaved text'));
  assert.equal(f.disk(), f.buffer());
  assert.deepEqual(f.notices, []);
});
test('migration refuses external changes and retries safely on the next load', async () => {
  const f = fixture({ conflict: true });
  await f.run();
  assert.ok(f.disk().includes(oldTask));
  assert.ok(f.disk().endsWith('External change'));
  assert.equal(f.notices.length, 1);
  await f.run();
  assert.ok(f.disk().includes('thingsmd-task'));
  assert.ok(f.disk().endsWith('External change'));
});
