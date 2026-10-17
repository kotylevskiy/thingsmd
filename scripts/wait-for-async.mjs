import { setTimeout } from 'node:timers/promises';

// Playwright's waitForFunction treats a Promise as truthy without polling its
// resolved value. Await each disk/storage check before deciding it has passed.
export async function waitForAsync(page, predicate, arg, { timeout = 8000, polling = 50 } = {}) {
  const deadline = performance.now() + timeout;
  while (true) {
    const result = await page.evaluate(predicate, arg);
    if (result) return result;
    const remaining = deadline - performance.now();
    if (remaining <= 0)
      throw new Error(`Condition did not become true within ${timeout}ms: ${predicate}`);
    await setTimeout(Math.min(polling, remaining));
  }
}
