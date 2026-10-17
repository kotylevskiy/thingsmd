const test = require('node:test');
const assert = require('node:assert/strict');

test('UI auditing recognizes caught JavaScript errors in Safari and Chromium notices', async () => {
  const { runtimeErrorPattern } = await import('../scripts/runtime-notice-audit.mjs');
  for (const message of [
    "undefined is not an object (evaluating 'l.view.contentEl.contains')",
    "Cannot read properties of undefined (reading 'contains')",
    'leaf.view.navigate is not a function',
    'view is not defined',
    'TypeError: invalid assignment',
  ])
    assert.match(message, runtimeErrorPattern);
  for (const message of [
    'Task moved to Today.',
    'This task changed elsewhere. Your draft is still open.',
    'Injected disk failure',
    'Choose a date for a repeating task.',
  ])
    assert.doesNotMatch(message, runtimeErrorPattern);
});
