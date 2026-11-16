const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLine, scan, baseline, restore } = require('../plugin/conversion/format.cjs');
function task(line, patch = {}, body = '') {
  const parsed = parseLine(line);
  assert.ok(parsed, line);
  const meta = { ...parsed.fields, created: parsed.fields.created || '2026-11-16T12:00:00Z' };
  return {
    meta: { ...meta, ...patch, conversion: { version: 1, line, baseline: baseline(meta) } },
    body,
  };
}
test('exact round trips retain unsupported and unknown metadata and list syntax', () => {
  for (const line of [
    '- [ ] #task Remove this task when done  [onCompletion:: delete]',
    '- [ ] #task do this after first and some other task  [dependsOn:: dcf64c,0h17ye]',
    '\t* [/] Custom status 🆔 first ⛔ other 🔺 🔁 every week 🏁 delete',
    '  12) [X] Finished (completion:: 2026-11-15) (custom field:: [[Some note]])',
    '> - [-] Cancelled ❌2026-11-14',
    '- [ ] #task Review (due:: 2099-03-20)  [start:: 2099-03-01] [scheduled:: 2099-03-10]',
    '- [ ] Literal `[due:: nonsense]` and `📅 nonsense`',
    '- [ ] A 🗓️2099-03-20',
    '- [ ] Task with [custom:: [nested] data] embedded metadata',
  ])
    assert.equal(restore(task(line)), line);
});
test('maps supported dates while preserving both start and scheduled fields', () => {
  const parsed = parseLine('- [ ] Work 🛫 2099-01-01 ⏳ 2099-01-05 📅 2099-01-10 ➕ 2026-11-16');
  assert.equal(parsed.fields.when, '2099-01-05');
  assert.equal(parsed.fields.deadline, '2099-01-10');
  assert.equal(parsed.fields.created, '2026-11-16');
  const result = restore(task(parsed.line, { when: '2099-01-06', deadline: '2099-01-11' }));
  assert.match(result, /🛫 2099-01-01 ⏳ 2099-01-06 📅 2099-01-11/);
});
test('edits only changed supported fields, preserving bracket style and unknown fields', () => {
  const line =
    '- [ ] Old title  (due:: 2099-01-01) [onCompletion:: delete] [id:: abc] [custom field:: keep]';
  const result = restore(
    task(line, {
      title: 'New title',
      deadline: '2099-01-02',
      status: 'done',
      completed: '2026-11-16T12:00:00Z',
    }),
  );
  assert.equal(
    result,
    '- [x] New title  (due:: 2099-01-02) [onCompletion:: delete] [id:: abc] [custom field:: keep] [completion:: 2026-11-16]',
  );
});
test('status changes remove obsolete completion dates; custom statuses survive unchanged', () => {
  assert.equal(
    restore(task('- [X] Done ✅ 2026-11-01', { status: 'todo', completed: null })),
    '- [ ] Done ',
  );
  assert.equal(restore(task('- [/] Doing')), '- [/] Doing');
});
test('rejects invalid dates, ambiguous fields, malformed metadata and empty titles', () => {
  for (const line of [
    '- [ ] Bad 📅 2026-02-30',
    '- [ ] Bad [due:: yesterday]',
    '- [ ] Bad 📅 2099-01-01 [due:: 2099-01-02]',
    '- [ ] Bad [due:: 2099-01-01',
    '- [ ] Bad [priority:: urgent]',
    '- [ ] Bad [onCompletion:: surprise]',
    '- [ ] Bad [dependsOn:: one,,two]',
    '- [ ] 📅 2099-01-01',
    '- [ ] Bad 📅 2099-01-01garbage',
  ])
    assert.equal(parseLine(line), null, line);
});
test('scans Markdown tasks including nested siblings while excluding examples', () => {
  const text =
    '---\n- [ ] YAML\n---\n# Note\n- [ ] Root\n    - [ ] Child\n        - [ ] Deep\n    - [ ] Sibling\n\nParagraph\n\n    - [ ] Code\n\n```md\n- [ ] Fenced\n```\n<!--\n- [ ] Comment\n-->\n> 1. [x] Quoted\n';
  assert.deepEqual(
    scan(text).tasks.map((t) => t.fields.title),
    ['Root', 'Child', 'Deep', 'Sibling', 'Quoted'],
  );
});
test('restores descriptions as indented Markdown without interpreting hierarchy', () => {
  assert.equal(
    restore(task('  * [ ] Work', {}, 'A paragraph\n\n- Detail\n')),
    '  * [ ] Work\n    A paragraph\n    \n    - Detail',
  );
});
test('CRLF offsets point at original task lines and preserve final newline choice', () => {
  const text = '# Note\r\n- [ ] First\r\n- [ ] Last';
  for (const item of scan(text).tasks) assert.equal(text.slice(item.from, item.to), item.line);
});

test('nested fenced and indented code samples are not imported', () => {
  const text =
    '- [ ] Parent\n  ```md\n  - [ ] Example\n  ```\n      - [ ] Indented code\n    - [ ] Child\n        - [ ] Deep\n    - [ ] Sibling\n';
  assert.deepEqual(
    scan(text).tasks.map((t) => t.fields.title),
    ['Parent', 'Child', 'Deep', 'Sibling'],
  );
});
test('inline comments and block IDs survive title and date changes', () => {
  const line = '- [ ] Original <!-- keep [due:: unknown] --> ^my-block';
  assert.equal(scan(line).tasks.length, 1);
  assert.equal(
    restore(task(line, { title: 'Updated', deadline: '2099-01-01' })),
    '- [ ] Updated <!-- keep [due:: unknown] --> 📅 2099-01-01 ^my-block',
  );
});
test('checklists added in ThingsMD are preserved below the restored description', () => {
  assert.equal(
    restore(task('- [ ] Task', { checklist: [{ text: 'Step', done: true }] }, 'Notes')),
    '- [ ] Task\n  Notes\n  \n  - [x] Step',
  );
});

test('comment markers in code do not hide later tasks', () => {
  assert.deepEqual(
    scan('```\n<!--\n```\n- [ ] One\n- [ ] Literal `<!--`\n- [ ] Two').tasks.map(
      (t) => t.fields.title,
    ),
    ['One', 'Literal `<!--`', 'Two'],
  );
});
test('Windows description line endings normalize once before note insertion', () => {
  assert.equal(
    restore(task('- [ ] Task', {}, 'First\r\nSecond\r\n')),
    '- [ ] Task\n  First\n  Second',
  );
});

test('reverse conversion refuses to discard new native-only task data', () => {
  for (const patch of [
    { is_waiting: true },
    { when: 'someday' },
    { evening: '2099-01-01' },
    { repeat: { next: '2099-01-01' } },
    { customProperty: 'keep me' },
  ])
    assert.throws(() => restore(task('- [ ] Original', patch)), /cannot be restored safely/);
});
