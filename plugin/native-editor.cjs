const { taskReferences } = require('./task-references.cjs');
const { nextFence } = require('./markdown-fence.cjs');
const {
  editorLivePreviewField,
  editorInfoField,
  Notice,
  MarkdownRenderChild,
} = require('obsidian');
const { StateField, StateEffect, Prec } = require('@codemirror/state');
const { EditorView, Decoration, WidgetType } = require('@codemirror/view');

module.exports = async function installNative(plugin) {
  const { isHidden: hiddenByPolicy } = require('./model.cjs');
  const isHidden = (meta) =>
    hiddenByPolicy(meta, undefined, plugin.settings.logbook, plugin.settings.timeZone);
  const refresh = StateEffect.define();
  const editors = new Set();
  const cards = new Set();
  let records = [];
  const pendingCreations = new Map();
  const pendingDeletions = new Set();
  const openOnCreate = new Set();
  let timer;
  let disposed = false,
    version = 0;
  const reload = async () => {
    if (plugin.movingTasks) return;
    const current = ++version;
    const next = await plugin.records();
    if (disposed || current !== version) return;
    records = [
      ...next,
      ...records.filter(
        (r) => pendingCreations.has(r.file.path) && !next.some((n) => n.file.path === r.file.path),
      ),
    ];
    for (const card of cards) card.render();
    for (const view of editors) view.dispatch({ effects: refresh.of(null) });
  };
  await reload();
  for (const event of ['modify', 'create', 'delete', 'rename'])
    plugin.registerEvent(
      plugin.app.vault.on(event, () => {
        version++;
        clearTimeout(timer);
        timer = setTimeout(() => reload().catch(console.error), 150);
      }),
    );
  plugin.registerEvent(
    plugin.app.workspace.on('thingsmd-tasks-changed', () => {
      version++;
      clearTimeout(timer);
      timer = setTimeout(() => reload().catch(console.error), 50);
    }),
  );
  plugin.register(() => {
    disposed = true;
    clearTimeout(timer);
  });
  const lookup = (path) =>
    records.find((r) => r.file.path === path && r.meta.type === 'thingsmd-task');
  const isTaskPath = (path) =>
    !!lookup(path) ||
    (path.startsWith(plugin.settings.tasksFolder + '/') &&
      !plugin.app.vault.getAbstractFileByPath(path));

  class TaskWidget extends WidgetType {
    constructor(path) {
      super();
      this.path = path;
    }
    eq(other) {
      return this.path === other.path;
    }
    toDOM(view) {
      return require('./native-task-card.cjs')(plugin, this.path, view, {
        lookup,
        isHidden,
        pendingCreations,
        openOnCreate,
        onSaved: (updated) => {
          records = records.map((r) => (r.file.path === updated.file.path ? updated : r));
        },
        onMount: (card) => cards.add(card),
        onDispose: (card) => cards.delete(card),
      });
    }
    destroy(dom) {
      dom._thingsmdCard?.dispose();
    }
    ignoreEvent() {
      return true;
    }
  }
  const readingDrag = require('./reading-drag.cjs')(plugin);
  // Reading mode uses the exact same card and task editor as Live Preview.
  // Replace the embed itself, so Obsidian cannot display its filename/open-link UI.
  plugin.registerMarkdownPostProcessor(async (element, context) => {
    if (
      element.closest('.ot-native,.ot-task-notes-preview,.ot-task-notes-render') ||
      element.closest('.cm-editor')
    )
      return;
    readingDrag.section(element, context.getSectionInfo(element));
    const usedLines = new Set();
    for (const embed of element.querySelectorAll('.internal-embed')) {
      if (embed.closest('.ot-native')) continue;
      const source = embed.getAttribute('src') || '';
      if (/[#|]/.test(source)) continue;
      const path = source.endsWith('.md') ? source : source + '.md';
      if (!lookup(path) && path.startsWith(plugin.settings.tasksFolder + '/')) await reload();
      if (!isTaskPath(path)) continue;
      const section = context.getSectionInfo(embed);
      if (!section) continue;
      const lines = section.text.split('\n');
      const reference = lines.slice(section.lineStart, section.lineEnd + 1);
      const offset = reference.findIndex(
        (line, index) => line === `![[${source}]]` && !usedLines.has(section.lineStart + index),
      );
      if (offset < 0) continue;
      const lineNumber = section.lineStart + offset;
      usedLines.add(lineNumber);
      // Keep a placeholder when rendering outruns the async task index. The
      // shared card refresh fills it in without reopening the note.
      const root = new TaskWidget(path).toDOM(null);
      root.classList.add('ot-reading-task');
      embed.replaceWith(root);
      const child = new MarkdownRenderChild(root);
      let disposeDrag;
      let observer;
      child.onload = () => {
        const attach = () => {
          if (!root.isConnected) return;
          observer?.disconnect();
          disposeDrag = readingDrag.mount(root, context.sourcePath, lineNumber);
        };
        observer = new MutationObserver(attach);
        observer.observe(root.ownerDocument.body, { childList: true, subtree: true });
        attach();
      };
      child.onunload = () => {
        observer?.disconnect();
        disposeDrag?.();
        root._thingsmdCard?.dispose();
      };
      context.addChild(child);
    }
  });
  plugin.register(() => {
    for (const card of [...cards]) card.dispose();
  });
  const build = (state) => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    const ranges = [];
    for (const reference of taskReferences(state.doc.toString())) {
      if (!isTaskPath(reference.path)) continue;
      ranges.push(
        Decoration.replace({
          widget: new TaskWidget(reference.path),
          block: true,
          inclusive: true,
        }).range(reference.from, state.doc.lineAt(reference.from).to),
      );
    }
    return Decoration.set(ranges);
  };
  const field = StateField.define({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.effects.length ? build(tr.state) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
  const { ViewPlugin } = require('@codemirror/view');
  plugin.registerEditorExtension([
    Prec.highest(field),
    ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          editors.add(view);
          this.disposeDrag = require('./task-drag.cjs').mountDrag(
            view,
            EditorView,
            (path, destination, list) =>
              (list
                ? plugin.dropTaskOnList(
                    { path, sourcePath: view.state.field(editorInfoField, false)?.file?.path },
                    list,
                  )
                : plugin.transferTask({
                    path,
                    destination,
                    sourcePath: view.state.field(editorInfoField, false)?.file?.path,
                  })
              ).catch((error) => new Notice(error.message)),
          );
          this.column = 0;
          const taskAt = (line) => {
            let found;
            view.state.field(field).between(line.from, line.to, (from, to, decoration) => {
              if (from !== line.from || !(decoration.spec.widget instanceof TaskWidget)) return;
              const task = lookup(decoration.spec.widget.path);
              if (task) found = isHidden(task.meta) ? 'hidden' : 'visible';
            });
            return found;
          };
          const nextLine = (line, direction) => {
            for (
              let number = line.number + direction;
              number >= 1 && number <= view.state.doc.lines;
              number += direction
            ) {
              const candidate = view.state.doc.line(number);
              if (taskAt(candidate) !== 'hidden') return candidate;
            }
            return null;
          };
          const focusTask = (line) => {
            view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'nearest' }) });
            const focus = () => {
              for (const root of view.contentDOM.querySelectorAll('.ot-native')) {
                if (view.state.doc.lineAt(view.posAtDOM(root)).number === line.number) {
                  root.querySelector('.ot-task')?.focus({ preventScroll: true });
                  return true;
                }
              }
              return false;
            };
            if (!focus())
              requestAnimationFrame(() => {
                if (editors.has(view)) focus();
              });
          };
          const focusLine = (line) => {
            if (!line) return;
            if (taskAt(line) === 'visible') focusTask(line);
            else {
              view.dispatch({
                selection: { anchor: Math.min(line.from + this.column, line.to) },
                scrollIntoView: true,
              });
              view.focus();
            }
          };
          this.key = (e) => {
            if (
              e.target === view.contentDOM &&
              !e.altKey &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.shiftKey &&
              ['Backspace', 'Delete'].includes(e.key) &&
              view.state.field(editorLivePreviewField, false) &&
              view.state.selection.ranges.length === 1 &&
              view.state.selection.main.empty
            ) {
              const reference = require('./task-reference-deletion.cjs').deletionTarget(
                view.state.doc.toString(),
                view.state.selection.main.head,
                e.key,
              );
              const task = reference && lookup(reference.path);
              if (task) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!task.meta.deleted && !pendingDeletions.has(task.meta.id)) {
                  pendingDeletions.add(task.meta.id);
                  plugin
                    .trashTask(task)
                    .catch((error) => new Notice(error.message))
                    .finally(() => pendingDeletions.delete(task.meta.id));
                }
                return;
              }
            }
            if (
              !view.contentDOM.contains(e.target) ||
              e.altKey ||
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey ||
              !['ArrowDown', 'ArrowUp'].includes(e.key)
            )
              return;
            if (!view.state.field(editorLivePreviewField, false)) return;
            const direction = e.key === 'ArrowDown' ? 1 : -1;
            const selected = e.target.closest('.ot-task');
            let target;
            if (selected) {
              if (e.target !== selected || selected.classList.contains('is-expanded')) return;
              const root = selected.closest('.ot-native');
              const line = view.state.doc.lineAt(view.posAtDOM(root));
              e.preventDefault();
              e.stopImmediatePropagation();
              focusLine(nextLine(line, direction));
              return;
            }
            if (
              e.target !== view.contentDOM ||
              !view.state.selection.main.empty ||
              view.state.selection.ranges.length !== 1
            )
              return;
            const pos = view.state.selection.main.head;
            const line = view.state.doc.lineAt(pos);
            this.column = pos - line.from;
            const currentTask = taskAt(line);
            if (currentTask === 'visible') target = line;
            else {
              // Let CodeMirror traverse wrapped visual lines before entering a task.
              const caret = view.coordsAtPos(pos);
              const block = view.lineBlockAt(pos);
              if (
                currentTask !== 'hidden' &&
                caret &&
                (direction > 0
                  ? caret.bottom < view.documentTop + block.bottom - view.defaultLineHeight / 2
                  : caret.top > view.documentTop + block.top + view.defaultLineHeight / 2)
              )
                return;
              const number = line.number + direction;
              if (number < 1 || number > view.state.doc.lines) return;
              // Logged/deleted cards have zero height. CodeMirror can bounce
              // back at their replacements, so cross those references ourselves.
              target = nextLine(line, direction);
              if (
                currentTask !== 'hidden' &&
                target?.number === number &&
                taskAt(target) !== 'visible'
              )
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            focusLine(target);
          };
          view.dom.ownerDocument.defaultView.addEventListener('keydown', this.key, true);
          // Obsidian can add a zero-width embed at the replacement boundary when
          // the cursor enters its source. Suppress only the matching adjacent copy.
          this.reconcile = () => {
            for (const embed of view.contentDOM.querySelectorAll('.internal-embed')) {
              const previous = embed.previousElementSibling;
              const source = embed.getAttribute('src') || '';
              const path = source.endsWith('.md') ? source : source + '.md';
              const duplicate =
                previous?.classList.contains('ot-native') && previous.dataset.taskPath === path;
              embed.classList.toggle('ot-duplicate-task-embed', !!duplicate);
            }
          };
          this.observer = new MutationObserver(this.reconcile);
          this.observer.observe(view.contentDOM, { childList: true, subtree: true });
          queueMicrotask(this.reconcile);
        }
        destroy() {
          this.disposeDrag();
          this.view.dom.ownerDocument.defaultView.removeEventListener('keydown', this.key, true);
          this.observer.disconnect();
          for (const embed of this.view.contentDOM.querySelectorAll('.ot-duplicate-task-embed'))
            embed.classList.remove('ot-duplicate-task-embed');
          editors.delete(this.view);
        }
      },
    ),
  ]);

  plugin.registerEditorExtension(
    Prec.highest(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (
          text !== ' ' ||
          from !== to ||
          !view.state.selection.main.empty ||
          !view.state.field(editorLivePreviewField, false)
        )
          return false;
        const line = view.state.doc.lineAt(from);
        if (line.text !== '+' || from !== line.to) return false;
        let fence = null;
        let yaml = false;
        for (let i = 1; i < line.number; i++) {
          const value = view.state.doc.line(i).text;
          if (i === 1 && value === '---') {
            yaml = true;
            continue;
          }
          if (yaml) {
            if (value === '---') yaml = false;
            continue;
          }
          fence = nextFence(fence, value);
        }
        if (fence || yaml) return false;
        const file = view.state.field(editorInfoField, false)?.file;
        if (!file) return false;
        const id = crypto.randomUUID();
        const path = `${plugin.settings.tasksFolder}/${id}.md`;
        const fields = { title: '', project: file.path, order: Date.now() };
        // Render immediately; disk creation must not swallow the next typed character.
        const provisional = {
          file: { path },
          meta: { type: 'thingsmd-task', id, status: 'todo', ...fields },
          body: '',
        };
        records.push(provisional);
        openOnCreate.add(path);
        let writing;
        const ensureCreated = () => {
          if (writing) return writing;
          writing = plugin.createTask(fields, id).then(
            (task) => {
              // The open card still references this provisional snapshot.
              // Adopt creation defaults once, before its first draft save;
              // later reloads must keep their normal conflict protection.
              Object.assign(provisional, task);
              records = records.map((r) => (r.file.path === path ? task : r));
              pendingCreations.delete(path);
              return task;
            },
            (error) => {
              // Keep the provisional draft, but release the failed attempt so
              // its next save can retry creation with the same stable ID.
              writing = null;
              throw error;
            },
          );
          return writing;
        };
        pendingCreations.set(path, ensureCreated);
        ensureCreated().catch((error) => new Notice(`Could not create task: ${error.message}`));
        const reference = `![[${path.slice(0, -3)}]]`;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: reference + '\n' },
          selection: { anchor: line.from + reference.length + 1 },
          userEvent: 'input',
        });
        return true;
      }),
    ),
  );
};
