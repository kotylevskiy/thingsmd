import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
export async function browserFixture({ browserType = chromium, pageOptions = {} } = {}) {
  const executablePath =
    browserType.name() !== 'chromium'
      ? undefined
      : process.env.THINGSMD_CHROME_PATH ||
        (process.platform === 'darwin'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : undefined);
  const browser = await browserType.launch({ executablePath, headless: true });
  const page = await browser.newPage(pageOptions);
  const sources = Object.fromEntries(
    await Promise.all(
      (await readdir(new URL('../plugin/', import.meta.url), { recursive: true }))
        .filter((f) => /\.(cjs|js)$/.test(f))
        .map(async (name) => [
          './' + name,
          await readFile(new URL('../plugin/' + name, import.meta.url), 'utf8'),
        ]),
    ),
  );
  // Bundle external parser dependencies for the same browser runtime as mobile.
  const parser = await build({
    entryPoints: [new URL('../plugin/calendar/parser.cjs', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
  });
  sources['./calendar/parser.cjs'] = parser.outputFiles[0].text;
  const css = await readFile(new URL('../plugin/styles.css', import.meta.url), 'utf8');
  await page.setContent(
    `<style>:root {--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--size-2-1:2px;--size-2-3:6px;--line-height-tight:1.3;--file-margins:16px;--font-text-size:16px;--file-line-width:700px;} *{box-sizing:border-box} body{margin:0}.modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}.modal{position:relative;display:flex;flex-direction:column;max-height:calc(100% - 40px);background:white;overflow:auto}.modal-close-button{display:block}${css}</style>`,
  );
  await page.evaluate((sources) => {
    const proto = HTMLElement.prototype;
    proto.createEl = function (tag, options = {}) {
      if (typeof options === 'string') options = { cls: options };
      const el = document.createElement(tag);
      if (options.cls) el.className = options.cls;
      if (options.text) el.textContent = options.text;
      for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
      this.append(el);
      return el;
    };
    proto.createDiv = function (options) {
      return this.createEl('div', options);
    };
    proto.createSpan = function (options) {
      return this.createEl('span', options);
    };
    proto.empty = function () {
      this.replaceChildren();
    };
    proto.addClass = function (...names) {
      this.classList.add(...names);
    };
    proto.removeClass = function (...names) {
      this.classList.remove(...names);
    };
    proto.toggleClass = function (name, on) {
      this.classList.toggle(name, on);
    };
    proto.hasClass = function (name) {
      return this.classList.contains(name);
    };
    proto.setText = function (text) {
      this.textContent = text;
    };
    class Modal {
      constructor(app) {
        this.app = app;
        this.containerEl = document.body.createDiv('modal-container');
        this.modalEl = this.containerEl.createDiv('modal');
        this.modalEl.createDiv('modal-close-button');
        this.modalEl.createDiv('modal-header-button').innerHTML = '<svg class="lucide-x"></svg>';
        this.contentEl = this.modalEl.createDiv('modal-content');
        this.keys = [];
        this.scope = { register: (mods, key, callback) => this.keys.push({ mods, key, callback }) };
      }
      open() {
        this.onOpen();
        this.keyHandler = (event) => {
          if (event.defaultPrevented) return;
          const binding = this.keys.find(
            ({ mods, key }) =>
              key === event.key &&
              Boolean(mods.includes('Mod')) === Boolean(event.ctrlKey || event.metaKey),
          );
          if (binding?.callback(event) === false) event.preventDefault();
        };
        document.addEventListener('keydown', this.keyHandler);
      }
      close() {
        document.removeEventListener('keydown', this.keyHandler);
        this.containerEl.remove();
        this.onClose();
      }
    }
    class ItemView {
      constructor(leaf) {
        this.leaf = leaf;
        this.app = leaf.app;
        this.contentEl = document.body.createDiv();
        this.titleEl = document.createElement('div');
      }
      async setState() {}
    }
    const host = {
      Modal,
      ItemView,
      Plugin: class {},
      Platform: {},
      Notice: class {
        constructor(message) {
          window.notices.push(message);
        }
      },
      setIcon: (el, icon) => {
        el.dataset.icon = icon;
      },
    };
    // Layout-only stand-in; native Markdown rendering/navigation is covered in Obsidian.
    window.renderTaskNotesFixture = (editor, fields) => {
      const preview = fields.createDiv({
        cls: 'ot-task-notes-preview markdown-rendered',
        attr: { tabindex: '0' },
      });
      preview.createSpan({ cls: 'ot-task-notes-placeholder', text: 'Notes' });
      return preview;
    };
    window.notices = [];
    const cache = {};
    window.loadPluginModule = (name) => {
      if (name === 'obsidian') return host;
      if (cache[name]) return cache[name].exports;
      const module = (cache[name] = { exports: {} });
      new Function('module', 'exports', 'require', sources[name])(
        module,
        module.exports,
        (request) =>
          window.loadPluginModule(
            request.startsWith('.')
              ? '.' + new URL(request, 'https://plugin.invalid/' + name.slice(2)).pathname
              : request,
          ),
      );
      return module.exports;
    };
  }, sources);
  return { browser, page };
}
