const test = require('node:test');
const assert = require('node:assert/strict');

test('UI storage waits poll the resolved value of an async predicate', async () => {
  const { waitForAsync } = await import('../scripts/wait-for-async.mjs');
  let checks = 0;
  const page = { evaluate: (predicate, arg) => predicate(arg) };
  const result = await waitForAsync(page, async (limit) => ++checks >= limit, 3, { polling: 1 });
  assert.equal(result, true);
  assert.equal(checks, 3, 'A Promise resolving to false must not pass the wait');
});

test('an async condition that stays false fails within its timeout', async () => {
  const { waitForAsync } = await import('../scripts/wait-for-async.mjs');
  const page = { evaluate: (predicate) => predicate() };
  await assert.rejects(
    waitForAsync(page, async () => false, undefined, { timeout: 5, polling: 1 }),
    /Condition did not become true/,
  );
});

test('UI waits report predicate failures rather than swallowing them', async () => {
  const { waitForAsync } = await import('../scripts/wait-for-async.mjs');
  const page = {
    evaluate: async () => {
      throw new Error('Storage unavailable');
    },
  };
  await assert.rejects(
    waitForAsync(page, async () => true),
    /Storage unavailable/,
  );
});
