import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
const { webkit } = await import(process.env.THINGSMD_PLAYWRIGHT_MODULE || 'playwright-core');
const { browser, page } = await browserFixture({
  browserType: webkit,
  pageOptions: { viewport: { width: 390, height: 844 }, hasTouch: true },
});
try {
  await page.evaluate(async () => {
    const host = window.loadPluginModule('obsidian');
    host.Menu = class {
      constructor() {
        this.el = document.body.createDiv('menu');
      }
      setUseNativeMenu() {}
      addItem(callback) {
        const button = this.el.createEl('button');
        const item = {
          setTitle: (text) => {
            button.textContent = text;
            return item;
          },
          setIcon: () => item,
          onClick: (fn) => {
            button.onclick = fn;
            return item;
          },
        };
        callback(item);
        return this;
      }
      showAtMouseEvent() {}
      showAtPosition() {}
    };
    window.source =
      '- [ ] Parent\n    - [ ] Child [onCompletion:: delete]\n    - [ ] Invalid [due:: nonsense]\n';
    const file = { path: 'Note.md' };
    const view = { file, getMode: () => 'preview', containerEl: document.body };
    window.disposers = [];
    window.calls = [];
    const commands = new Map();
    const plugin = {
      settings: { tasksFolder: 'ThingsMD' },
      app: {
        vault: {
          getMarkdownFiles: () => [file],
          read: async () => window.source,
          getAbstractFileByPath: () => file,
          on() {},
        },
        workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => view, on() {} },
      },
      records: async () => [],
      planConversion: async (args) => args,
      runConversion: async (plan) => {
        window.calls.push(plan);
        return { skipped: 0 };
      },
      register: (fn) => window.disposers.push(fn),
      registerEvent() {},
      addCommand: (command) => commands.set(command.id, command),
      registerDomEvent: (target, type, fn, options) => {
        target.addEventListener(type, fn, options);
        window.disposers.push(() => target.removeEventListener(type, fn, options));
      },
      registerMarkdownPostProcessor: (fn) => {
        window.processor = fn;
      },
    };
    window.loadPluginModule('./conversion/ui.cjs')(plugin);
    const preview = document.body.createDiv('markdown-preview-view');
    preview.innerHTML =
      '<div class="el-ul"><ul><li class="task-list-item" data-line="0">Parent<ul><li class="task-list-item" data-line="1">Child</li><li class="task-list-item" data-line="2">Invalid</li></ul></li></ul></div>';
    window.processor(preview.firstElementChild, {
      sourcePath: 'Note.md',
      getSectionInfo: () => ({ text: window.source, lineStart: 0, lineEnd: 2 }),
    });
    const child = preview.querySelectorAll('li')[1];
    const selectChild = () => {
      const range = document.createRange();
      range.setStart(child.firstChild, 1);
      range.setEnd(child.firstChild, 3);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    window.runSelectionCommand = () => {
      document.querySelector('.menu')?.remove();
      selectChild();
      return commands.get('convert-selected-tasks').checkCallback(false);
    };
    selectChild();
    child.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  await page.getByRole('button', { name: 'Convert to ThingsMD format', exact: true }).click();
  const calls = await page.evaluate(() => window.calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ranges.length, 1, 'Selecting a nested child does not convert its parent');
  assert.equal(calls[0].ranges[0].from, 13);
  assert.equal(calls[0].direction, 'thingsmd');
  assert.equal(await page.evaluate(() => window.runSelectionCommand()), true);
  await page.getByRole('button', { name: 'Convert to ThingsMD format', exact: true }).tap();
  assert.deepEqual(await page.evaluate(() => window.calls), [calls[0], calls[0]]);
  assert.deepEqual(await page.evaluate(() => window.notices), []);
  assert.equal(
    await page.evaluate(() => {
      const { parseLine, baseline, restore } = window.loadPluginModule('./conversion/format.cjs');
      const line =
        '  - [ ] Task (due:: 2099-01-01) [onCompletion:: delete] [dependsOn:: first,second]';
      const parsed = parseLine(line);
      return (
        restore({
          meta: {
            ...parsed.fields,
            conversion: { version: 1, line, baseline: baseline(parsed.fields) },
          },
          body: '',
        }) === line
      );
    }),
    true,
  );
  await page.evaluate(() => window.disposers.forEach((dispose) => dispose()));
  console.log(
    'PASS: WebKit mobile selection mapping, nested/invalid task boundaries, silent conversion, and exact metadata round trip (mocked Obsidian host).',
  );
} finally {
  await browser.close();
}
