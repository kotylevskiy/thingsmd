const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  referenceRanges,
  removeReferences,
  insertReference,
} = require('../plugin/task-references.cjs');
const path = '.thingsmd-storage/a.md';
test('task placement preserves prose and only removes live standalone references', () => {
  const text =
    '---\nexample: "![[.thingsmd-storage/a]]"\n---\nBefore\n![[.thingsmd-storage/a]]\n```md\n![[.thingsmd-storage/a]]\n```\nAfter\n';
  assert.equal(referenceRanges(text, path).length, 1);
  assert.equal(
    removeReferences(text, path),
    '---\nexample: "![[.thingsmd-storage/a]]"\n---\nBefore\n```md\n![[.thingsmd-storage/a]]\n```\nAfter\n',
  );
  assert.equal(
    insertReference('Before\nAfter\n', path, 7),
    'Before\n![[.thingsmd-storage/a]]\nAfter\n',
  );
  assert.equal(insertReference('Before', path), 'Before\n![[.thingsmd-storage/a]]\n');
  assert.equal(
    insertReference('Before\n![[.thingsmd-storage/a]]\n', path),
    'Before\n![[.thingsmd-storage/a]]\n',
  );
});
test('same-note cut/paste adjusts position and preserves CRLF', () => {
  const text = '![[.thingsmd-storage/a]]\r\nBefore\r\nAfter\r\n';
  const result = insertReference(text, path, text.indexOf('After'), true);
  assert.equal(result, 'Before\r\n![[.thingsmd-storage/a]]\r\nAfter\r\n');
  assert.equal(referenceRanges(result, path).length, 1);
});
test('pasting into frontmatter and fenced code is rejected without editing', () => {
  assert.throws(() => insertReference('---\ntitle: Note\n---\nBody\n', path, 8), /note body/);
  assert.throws(() => insertReference('---\ntitle: Note\n---\nBody\n', path, 0), /note body/);
  assert.throws(() => insertReference('```md\ncode\n```\n', path, 7), /code blocks/);
});
test('long fences preserve literal task examples during moves and reject insertion', () => {
  for (const marker of ['`', '~']) {
    const text =
      marker.repeat(4) +
      'markdown\n' +
      marker.repeat(3) +
      '\n![[.thingsmd-storage/a]]\n' +
      marker.repeat(4) +
      ' trailing text\n![[.thingsmd-storage/a]]\n' +
      marker.repeat(5) +
      '\n![[.thingsmd-storage/a]]\n';
    assert.equal(referenceRanges(text, path).length, 1);
    assert.equal(
      removeReferences(text, path),
      text.slice(0, text.lastIndexOf('![[.thingsmd-storage/a]]')),
    );
    assert.throws(
      () =>
        insertReference(text, '.thingsmd-storage/b.md', text.indexOf('![[.thingsmd-storage/a]]')),
      /code blocks/,
    );
    assert.throws(
      () =>
        insertReference(
          text,
          '.thingsmd-storage/b.md',
          text.lastIndexOf('![[.thingsmd-storage/a]]') - marker.repeat(5).length - 1,
        ),
      /code blocks/,
    );
  }
});
