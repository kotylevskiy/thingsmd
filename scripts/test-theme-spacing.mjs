import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { connectTestVault } from './obsidian-connection.mjs';
const { browser, page } = await connectTestVault();
try {
  await page.evaluate(() => {
    const css = getComputedStyle(document.body),
      names = [
        '--size-2-1',
        '--size-2-3',
        '--size-4-1',
        '--size-4-2',
        '--size-4-3',
        '--size-4-4',
        '--size-4-5',
        '--size-4-6',
        '--size-4-8',
        '--size-4-12',
      ];
    const style = document.createElement('style');
    style.id = 'ot-theme-spacing-audit';
    style.textContent =
      'body {' +
      names
        .map((name) => `${name}:${parseFloat(css.getPropertyValue(name)) * 1.25}px !important;`)
        .join('') +
      '}';
    document.head.appendChild(style);
  });
  for (const script of [
    'test-control-matrix.mjs',
    'test-dialog-controls.mjs',
    'test-task-menu.mjs',
  ]) {
    const result = spawnSync(process.execPath, ['scripts/' + script], { stdio: 'inherit' });
    assert.equal(result.status, 0, script);
  }
  for (const file of [
    'controls-checklist-fixed.png',
    'capture-controls-390.png',
    'capture-controls-800.png',
    'task-move-desktop.png',
    'task-move-mobile-width.png',
    'repeat-controls.png',
    'calendar-controls-390.png',
    'calendar-controls-800.png',
  ])
    copyFileSync('artifacts/' + file, 'artifacts/theme-spacing-' + file);
  console.log(
    'PASS: editor matrix, capture, calendar, repeat and Move with theme spacing increased by 25%.',
  );
} finally {
  await page.evaluate(() => document.getElementById('ot-theme-spacing-audit')?.remove());
  await browser.close();
}
