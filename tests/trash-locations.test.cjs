const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  restoreReference,
  restoreLocations,
  captureLocations,
} = require('../plugin/tasks/trash-locations.cjs');

test('restore follows note context and retains intervening prose edits without duplicate references', () => {
  const location = { before: 'Before.\n\n', after: '\nAfter.\n' };
  const original = 'Before.\n\n![[tasks/a]]\n\nAfter.\n';
  assert.equal(restoreReference(original, 'tasks/a.md', location), original);
  assert.equal(
    restoreReference('New introduction.\nBefore.\n\n\nAfter.\nNew ending.', 'tasks/a.md', location),
    'New introduction.\nBefore.\n\n![[tasks/a]]\n\nAfter.\nNew ending.',
  );
});
function fixture() {
  const file = { path: 'Project.md', extension: 'md' };
  let text = 'Before.\n\n![[tasks/a]]\n\nAfter.\n';
  const plugin = {
    app: {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        getMarkdownFiles: () => [file],
        getAbstractFileByPath: () => file,
        read: async () => text,
        process: async (_, change) => {
          text = change(text);
        },
      },
    },
  };
  const task = { file: { path: 'tasks/a.md' }, meta: {} };
  return {
    plugin,
    task,
    read: () => text,
    write: (next) => {
      text = next;
    },
  };
}
test('trash captures placement and failed restore rolls back only its own note insertion', async () => {
  const f = fixture();
  f.task.meta.deletedFrom = await captureLocations(f.plugin, f.task);
  f.write('Before.\n\n\nAfter.\n');
  const before = f.read();
  await assert.rejects(
    restoreLocations(f.plugin, f.task, async () => {
      throw Error('Task conflict');
    }),
    /Task conflict/,
  );
  assert.equal(f.read(), before);
  await restoreLocations(f.plugin, f.task, async () => {});
  assert.equal(f.read(), 'Before.\n\n![[tasks/a]]\n\nAfter.\n');
});
test('rollback preserves an external edit made during a failing restore', async () => {
  const f = fixture();
  f.task.meta.deletedFrom = await captureLocations(f.plugin, f.task);
  f.write('Before.\n\n\nAfter.\n');
  await assert.rejects(
    restoreLocations(f.plugin, f.task, async () => {
      f.write(f.read() + 'External text.');
      throw Error('Task conflict');
    }),
    /Recovery needed/,
  );
  assert.ok(f.read().endsWith('External text.'));
});

test('a legacy deleted task can return to its recorded project without a placement snapshot', async () => {
  const f = fixture();
  f.task.meta.project = 'Project.md';
  f.task.meta.deletedFrom = [];
  f.write('Existing project prose.\n');
  await restoreLocations(f.plugin, f.task, async () => {});
  assert.equal(f.read(), 'Existing project prose.\n![[tasks/a]]\n');
});

test('renaming a note or folder updates saved placements without matching similar names', () => {
  const { renamedLocations } = require('../plugin/tasks/trash-locations.cjs');
  const meta = {
    project: 'Work/Project.md',
    deletedFrom: [
      { path: 'Work/Project.md', before: 'Keep context' },
      { path: 'Workshop/Other.md' },
    ],
  };
  assert.deepEqual(renamedLocations(meta, 'Work', 'Archive'), {
    project: 'Archive/Project.md',
    deletedFrom: [
      { path: 'Archive/Project.md', before: 'Keep context' },
      { path: 'Workshop/Other.md' },
    ],
  });
  assert.equal(meta.deletedFrom[0].path, 'Work/Project.md');
  assert.deepEqual(renamedLocations(meta, 'Elsewhere', 'Other'), {});
});
test('hand-edited malformed placement properties do not prevent Restore', async () => {
  for (const saved of ['invalid', [null, 17, { path: 10 }]]) {
    const f = fixture();
    f.task.meta.deletedFrom = saved;
    let restored = false;
    await restoreLocations(f.plugin, f.task, async () => {
      restored = true;
    });
    assert.equal(restored, true);
  }
});
