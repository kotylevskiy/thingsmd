const test = require('node:test');
const assert = require('node:assert/strict');
const { frontmatter, decode } = require('../plugin/markdown-document.cjs');
const parse = (text) => (text.trim() ? JSON.parse(text) : null);

test('document decoding preserves body bytes and supports empty properties and CRLF', () => {
  for (const newline of ['\n', '\r\n']) {
    const body = `First${newline}${newline}---${newline}Last${newline}`;
    for (const yaml of ['', `{"type":"thingsmd-task"}${newline}`]) {
      const header = `---${newline}${yaml}---${newline}`;
      const record = decode(header + body, parse);
      assert.equal(record.body, body);
      assert.equal(frontmatter(header + body).body, header.length);
      assert.equal(frontmatter(header + body).to, header.trimEnd().length);
    }
  }
});
test('body thematic breaks are not mistaken for properties', () => {
  for (const text of ['Paragraph\n---\n{}\n---\nText', '\n---\n{}\n---\n', '---\nUnclosed']) {
    assert.equal(frontmatter(text), null);
    assert.deepEqual(decode(text, parse), { meta: {}, body: text });
  }
});
test('non-mapping properties and malformed YAML fail before a write can normalize them away', () => {
  for (const yaml of ['[]', 'true', '42', '"text"', '{broken'])
    assert.throws(() => decode(`---\n${yaml}\n---\nBody`, parse));
});
