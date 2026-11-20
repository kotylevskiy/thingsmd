const { Menu, Notice, MarkdownView } = require('obsidian');
const { scan } = require('./format.cjs');
const { taskReferences } = require('../notes/task-references.cjs');
const { noteAccess } = require('../shared/note-access.cjs');

const { labels, report } = require('./presentation.cjs');

function editorRanges(editor) {
  return editor
    .listSelections()
    .map(({ anchor, head }) => {
      const start = editor.posToOffset(anchor),
        end = editor.posToOffset(head);
      return { from: Math.min(start, end), to: Math.max(start, end) };
    })
    .filter(({ from, to }) => from !== to);
}

module.exports = function installConversionUI(plugin) {
  const app = plugin.app;
  plugin.convertTaskToInline = async (task, path) =>
    report(
      await plugin.runConversion(
        await plugin.planConversion({ direction: 'inline', path, taskPath: task.file.path }),
      ),
    );
  const cache = new Map(),
    eligible = new Set(),
    rendered = new WeakMap(),
    sections = new WeakMap();
  let timer,
    disposed = false,
    version = 0;
  async function refresh() {
    const current = ++version;
    const tasks = await plugin.taskRecords();
    const entries = [];
    for (const file of app.vault.getMarkdownFiles())
      if (!file.path.startsWith(plugin.settings.tasksFolder + '/'))
        entries.push([file.path, await noteAccess(app).read(file)]);
    if (disposed || current !== version) return;
    cache.clear();
    eligible.clear();
    for (const task of tasks)
      if (task.meta.conversion?.version === 1 && !task.conflicts?.length && !task.meta.deleted)
        eligible.add(task.file.path);
    for (const [path, text] of entries) cache.set(path, available(text));
  }
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh().catch(console.error), 100);
  };
  for (const event of ['create', 'modify', 'delete', 'rename'])
    plugin.registerEvent(app.vault.on(event, schedule));
  plugin.registerEvent(app.workspace.on('thingsmd-tasks-changed', schedule));
  void refresh().catch(console.error);
  const available = (text, ranges) => {
    const touches = (item) => !ranges || ranges.some((r) => item.from < r.to && item.to > r.from);
    return {
      thingsmd: scan(text).tasks.some(touches),
      inline: taskReferences(text).some((ref) => eligible.has(ref.path) && touches(ref)),
    };
  };
  const run = async (direction, path, text, ranges) => {
    try {
      report(
        await plugin.runConversion(
          await plugin.planConversion({ direction, path, ranges, expected: text }),
        ),
      );
    } catch (error) {
      new Notice(error.message);
    }
  };
  const supported = (file) => file && !file.path.startsWith(plugin.settings.tasksFolder + '/');
  function choicesFor(file, text, ranges) {
    if (!supported(file)) return {};
    return text === undefined ? cache.get(file.path) || {} : available(text, ranges);
  }
  function addItems(menu, file, text, ranges, choices = choicesFor(file, text, ranges)) {
    for (const direction of ['thingsmd', 'inline'])
      if (choices[direction])
        menu.addItem((item) =>
          item
            .setTitle(`${ranges ? 'Convert to' : 'Convert all tasks to'} ${labels[direction]}`)
            .setIcon('refresh-cw')
            .onClick(() => run(direction, file.path, text, ranges)),
        );
    return choices.thingsmd || choices.inline;
  }
  const textFor = (file) => {
    const view = app.workspace
      .getLeavesOfType('markdown')
      .find(({ view }) => view.file?.path === file?.path && view.getMode() === 'source')?.view;
    return view?.editor.getValue();
  };
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => addItems(menu, file, textFor(file))),
  );
  plugin.registerEvent(
    app.workspace.on('editor-menu', (menu, editor, view) => {
      const ranges = editorRanges(editor);
      if (ranges.length) addItems(menu, view.file, editor.getValue(), ranges);
    }),
  );
  for (const direction of ['thingsmd', 'inline'])
    plugin.addCommand({
      id: `convert-note-to-${direction}`,
      name: `Convert all tasks to ${labels[direction]}`,
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file,
          text = textFor(file);
        if (!choicesFor(file, text)[direction]) return false;
        if (!checking) void run(direction, file.path, text);
        return true;
      },
    });
  // Keep source offsets on rendered task elements, not on a global note cache.
  // Selection touches whole items; ordinary prose between them is never edited.
  plugin.registerMarkdownPostProcessor((element, context) => {
    if (element.closest('.ot-native,.ot-task-notes-preview,.ot-task-notes-render,.cm-editor'))
      return;
    const info = context.getSectionInfo(element);
    if (!info) return;
    sections.set(element, { ...info, path: context.sourcePath });
    const parsed = scan(info.text).tasks;
    for (const node of element.querySelectorAll('li.task-list-item')) {
      const number = info.lineStart + Number(node.dataset.line);
      const task = parsed.find((task) => task.number === number);
      if (task)
        rendered.set(node, {
          path: context.sourcePath,
          text: info.text,
          from: task.from,
          to: task.to,
        });
    }
  }, 200);
  function readingRange(preview) {
    const selection = preview?.ownerDocument.getSelection();
    if (!preview || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (preview.contains(range.commonAncestorContainer)) return range;
  }
  function readingSelection(preview, range = readingRange(preview)) {
    if (!range || range.collapsed || !preview?.contains(range.commonAncestorContainer)) return;
    const matches = [...preview.querySelectorAll('li.task-list-item,.ot-native')]
      .filter((node) =>
        [...node.childNodes].some(
          (child) => !['UL', 'OL'].includes(child.nodeName) && range.intersectsNode(child),
        ),
      )
      .map((node) => {
        if (rendered.has(node)) return rendered.get(node);
        if (!node.classList.contains('ot-native')) return null;
        let element = node;
        while (element && !sections.has(element)) element = element.parentElement;
        const info = sections.get(element);
        const number = Number(node.dataset.sourceLine);
        if (!info || !Number.isInteger(number) || number < info.lineStart || number > info.lineEnd)
          return null;
        const lines = info.text.split('\n');
        const from = lines.slice(0, number).reduce((sum, line) => sum + line.length + 1, 0);
        return { path: info.path, text: info.text, from, to: from + lines[number].length };
      })
      .filter(Boolean);
    if (
      !matches.length ||
      matches.some((item) => item.path !== matches[0].path || item.text !== matches[0].text)
    )
      return;
    return { path: matches[0].path, text: matches[0].text, ranges: matches };
  }
  const previewFor = (view) => view.containerEl.querySelector('.markdown-preview-view');
  let lastReadingRange, promptSelection;
  plugin.registerDomEvent(document, 'selectionchange', () => {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    const range = view?.getMode() === 'preview' && readingRange(previewFor(view));
    lastReadingRange = range ? { view, range: range.cloneRange() } : undefined;
  });
  const promptObserver = new MutationObserver(() => {
    // Obsidian closes the prompt and executes the command in the same turn.
    if (promptSelection?.prompt.isConnected) return;
    promptSelection = undefined;
    promptObserver.disconnect();
  });
  plugin.registerDomEvent(document, 'focusin', (event) => {
    if (!event.target.matches?.('.prompt-input')) return;
    const prompt = event.target.closest('.prompt');
    if (!prompt || promptSelection?.prompt === prompt) return;
    promptSelection = undefined;
    promptObserver.disconnect();
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.getMode() !== 'preview') return;
    const preview = previewFor(view);
    const selection = readingSelection(
      preview,
      readingRange(preview) ||
        (lastReadingRange?.view === view ? lastReadingRange.range : undefined),
    );
    if (!selection || selection.path !== view.file?.path) return;
    // Typing in the palette can replace the document selection.
    promptSelection = { prompt, view, selection };
    promptObserver.observe(prompt.ownerDocument.body, { childList: true, subtree: true });
  });
  plugin.registerDomEvent(
    document,
    'contextmenu',
    (event) => {
      const selection = readingSelection(event.target.closest?.('.markdown-preview-view'));
      if (!selection) return;
      const { path, text, ranges } = selection;
      const menu = new Menu();
      menu.setUseNativeMenu(false);
      if (!addItems(menu, app.vault.getAbstractFileByPath(path), text, ranges)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      menu.showAtMouseEvent(event);
    },
    { capture: true },
  );
  plugin.addCommand({
    id: 'convert-selected-tasks',
    name: 'Convert selected tasks…',
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      const file = view?.file;
      if (!supported(file)) return false;
      let text, ranges;
      if (view.getMode() === 'source') {
        ranges = editorRanges(view.editor);
        text = view.editor.getValue();
      } else {
        const selection =
          readingSelection(previewFor(view)) ||
          (promptSelection?.view === view ? promptSelection.selection : undefined);
        if (selection?.path !== file.path) return false;
        ({ text, ranges } = selection);
      }
      if (!ranges.length) return false;
      const choices = choicesFor(file, text, ranges);
      if (!choices.thingsmd && !choices.inline) return false;
      if (!checking) {
        promptSelection = undefined;
        promptObserver.disconnect();
        const menu = new Menu();
        menu.setUseNativeMenu(false);
        addItems(menu, file, text, ranges, choices);
        menu.showAtPosition({ x: innerWidth / 2, y: innerHeight / 2 });
      }
      return true;
    },
  });
  plugin.register(() => {
    disposed = true;
    delete plugin.convertTaskToInline;
    clearTimeout(timer);
    promptObserver.disconnect();
    cache.clear();
    eligible.clear();
  });
};
