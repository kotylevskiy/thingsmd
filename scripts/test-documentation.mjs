import assert from 'node:assert/strict';

const { webkit } = await import(process.env.THINGSMD_RECORDING_PLAYWRIGHT ?? 'playwright-core');
const url = process.env.THINGSMD_DOCS_URL ?? 'http://127.0.0.1:4000/thingsmd/';
const browser = await webkit.launch();

async function checkAppearance(page, theme) {
  const images = page.locator('.documentation figure picture img');
  await images.evaluateAll((nodes) => {
    for (const img of nodes) img.loading = 'eager';
  });
  const suffix = theme === 'light' ? '-light' : '';
  await page.waitForFunction((suffix) => {
    const images = [...document.querySelectorAll('.documentation figure picture img')];
    return (
      images.length > 0 &&
      images.every((img) => {
        const name = img
          .getAttribute('src')
          .split('/')
          .pop()
          .replace(/\.png$/, '');
        return (
          img.complete && img.naturalWidth > 0 && img.currentSrc.endsWith(name + suffix + '.png')
        );
      })
    );
  }, suffix);
  assert.equal(await images.count(), 7);
  const sizes = await images.evaluateAll((nodes) =>
    nodes.map((img) => ({
      height: img.getBoundingClientRect().height,
      width: img.getBoundingClientRect().width,
      column: img.closest('figure').clientWidth,
      limit: Math.min(480, innerHeight * 0.65),
    })),
  );
  for (const { height, width, column, limit } of sizes) {
    assert.ok(height <= limit + 1);
    assert.ok(width <= column + 1);
  }
  const video = page.locator('.hero-demo video');
  assert.ok((await video.getAttribute('poster')).endsWith('/cover-screencast' + suffix + '.jpg'));
  assert.ok(
    (await video.locator('source').first().getAttribute('src')).endsWith(
      '/cover-screencast' + suffix + '.webm',
    ),
  );
}

try {
  for (const system of ['light', 'dark']) {
    const width = system === 'light' ? 390 : 1440;
    const page = await browser.newPage({ colorScheme: system, viewport: { width, height: 740 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://api.github.com/**', (route) => route.abort());
    await page.goto(url);
    assert.equal(await page.locator('.hero-demo video').evaluate((video) => video.paused), true);
    await checkAppearance(page, system);

    const links = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a[href^="#"]')];
      return anchors
        .map((a) => decodeURIComponent(a.hash.slice(1)))
        .filter((id) => !document.getElementById(id));
    });
    assert.deepEqual(links, []);

    const switcher = page.locator('.appearance-switcher');
    const other = system === 'light' ? 'dark' : 'light';
    await switcher.click();
    await checkAppearance(page, other);
    await page.reload();
    await checkAppearance(page, other);
    await switcher.click();
    await checkAppearance(page, system);
    await switcher.click();
    assert.equal(await page.locator('html').getAttribute('data-appearance'), null);
    await page.emulateMedia({ colorScheme: other });
    await checkAppearance(page, other);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      'Documentation screenshots, video selection, and anchors verified at',
      width,
      'px.',
    );
  }
} finally {
  await browser.close();
}
