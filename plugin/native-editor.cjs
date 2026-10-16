const TaskEditor = require('./task-editor.cjs');
const { taskIndicators } = require('./task-indicators.cjs');
const { taskState } = require('./task-presentation.cjs');
const { nextFence } = require('./markdown-fence.cjs');
const {
  editorLivePreviewField,
  editorInfoField,
  Notice,
  Scope,
  MarkdownRenderChild,
  Platform,
} = require('obsidian');
const { StateField, StateEffect, Prec } = require('@codemirror/state');
const { EditorView, Decoration, WidgetType } = require('@codemirror/view');

module.exports = async function installNative(plugin) {
  const { isHidden: hiddenByPolicy } = require('./model.cjs');
  const isHidden = (meta) => hiddenByPolicy(meta, undefined, plugin.settings.logbook);
  const refresh = StateEffect.define();
  const editors = new Set();
  const cards = new Set();
  let records = [];
  const pendingWrites = new Map();
  const openOnCreate = new Set();
  let timer;
  let disposed = false,
    version = 0;
  const reload = async () => {
    const current = ++version;
    const next = await plugin.records();
    if (disposed || current !== version) return;
    records = [
      ...next,
      ...records.filter(
        (r) => pendingWrites.has(r.file.path) && !next.some((n) => n.file.path === r.file.path),
      ),
    ];
    for (const card of cards) if (!card.taskDraft) card.render();
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
    plugin.app.workspace.on('things-tasks-changed', () => {
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
    records.find((r) => r.file.path === path && r.meta.type === 'things-task');

  class TaskWidget extends WidgetType {
    constructor(path) {
      super();
      this.path = path;
    }
    eq(other) {
      return this.path === other.path;
    }
    toDOM(view) {
      const root = document.createElement('div');
      root.className = 'ot-root ot-native';
      root.contentEditable = 'false';
      root.dataset.taskPath = this.path;
      for (const event of ['mousedown', 'click', 'dblclick'])
        root.addEventListener(event, (e) => e.stopPropagation());
      const card = new TaskEditor(plugin, root, async () => {
        if (card.scope) {
          plugin.app.keymap.popScope(card.scope);
          card.scope = null;
        }
        card.signature = null;
        await card.render();
      });
      card.render = async () => {
        if (card.taskDraft) return;
        const task = lookup(this.path);
        card.currentTask = task;
        const signature = task
          ? JSON.stringify([task.meta, task.body, isHidden(task.meta)])
          : 'missing';
        if (card.signature === signature && root.childElementCount) return;
        card.signature = signature;
        root.empty();
        root.classList.toggle('ot-hidden-task', !!task && isHidden(task.meta));
        if (task && isHidden(task.meta)) {
          view?.requestMeasure();
          return;
        }
        if (!task) {
          root.createSpan({ text: 'Task file unavailable' });
          return;
        }
        const row = root.createDiv({
          cls: `ot-task ${task.meta.status === 'done' ? 'is-done' : ''}`,
          attr: { tabindex: '0', 'data-task-id': task.meta.id },
        });
        const labelId = `ot-task-label-${crypto.randomUUID()}`;
        row.setAttribute('aria-labelledby', labelId);
        const line = row.createDiv('ot-task-line');
        const check = line.createEl('input', {
          attr: { type: 'checkbox', 'aria-labelledby': labelId },
        });
        check.checked = task.meta.status === 'done';
        check.disabled = !!task.meta.repeat && !task.meta.repeat.next;
        taskState(row, task.meta);
        check.onchange = () =>
          plugin
            .patchTask(task, { status: check.checked ? 'done' : 'todo' })
            .catch((e) => new Notice(e.message));
        line.createSpan({
          cls: 'ot-task-title',
          text: task.meta.title || 'New task',
          attr: { id: labelId },
        });
        taskIndicators(line, task);
        const open = () => {
          if (card.taskDraft) return;
          // Keep Obsidian's link-opening shortcuts away from the hidden reference.
          if (view) {
            const sourceLine = view.state.doc.lineAt(view.posAtDOM(root));
            view.dispatch({
              selection: { anchor: Math.min(sourceLine.to + 1, view.state.doc.length) },
            });
          }
          row.addClass('is-expanded');
          line.querySelector('.ot-task-title').remove();
          line
            .querySelectorAll(
              '.ot-task-details,.ot-row-indicators,.ot-today-marker,.ot-repeat-indicator',
            )
            .forEach((el) => el.remove());
          card.taskEditor(row, line, lookup(this.path) || task);
          card.scope = new Scope(plugin.app.scope);
          card.scope.register([], 'Enter', (event) => {
            if (
              event.isComposing ||
              root.ownerDocument.activeElement !== line.querySelector('.ot-title-input')
            )
              return;
            card.finishTask().then((ok) => {
              if (ok) root.querySelector('.ot-task')?.focus({ preventScroll: true });
            });
            return false;
          });
          card.scope.register([], 'Escape', () => {
            const pop = root.querySelector('.ot-popover');
            if (pop) {
              if (pop.close) pop.close();
              else pop.remove();
            } else
              card.finishTask().then((ok) => {
                if (ok) root.querySelector('.ot-task')?.focus({ preventScroll: true });
              });
            return false;
          });
          plugin.app.keymap.pushScope(card.scope);
          line.querySelector('.ot-title-input').id = labelId;
          line.querySelector('.ot-title-input').focus();
          view?.requestMeasure();
        };
        row.ondblclick = (e) => {
          if (!e.target.closest('input,button')) open();
        };
        row.onclick = (e) => {
          if (!e.target.closest('input,button,textarea')) {
            row.focus();
            if (Platform.isMobile || e.pointerType === 'touch') open();
          }
        };
        row.onkeydown = (e) => {
          if (e.target !== row) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            open();
          } else if (
            !view &&
            !e.altKey &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey &&
            ['ArrowDown', 'ArrowUp'].includes(e.key)
          ) {
            const rows = [
              ...root
                .closest('.markdown-preview-view')
                .querySelectorAll('.ot-native:not(.ot-hidden-task) .ot-task'),
            ];
            const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
            e.preventDefault();
            e.stopPropagation();
            next?.focus();
          }
        };
        if (openOnCreate.delete(this.path))
          queueMicrotask(() => {
            if (root.isConnected) open();
          });
        view?.requestMeasure();
      };
      card.saveTaskDraft = async () => {
        try {
          await pendingWrites.get(this.path);
          if (card.taskDraft) card.taskDraft.task.file = lookup(this.path).file;
          return await TaskEditor.prototype.saveTaskDraft.call(card);
        } catch (error) {
          new Notice(error.message);
          return false;
        }
      };
      card.finishTask = async () => {
        if (!(await card.flushTaskDraft())) return false;
        if (card.taskDraft) {
          const updated = card.taskDraft.task;
          records = records.map((r) => (r.file.path === updated.file.path ? updated : r));
        }
        if (card.scope) {
          plugin.app.keymap.popScope(card.scope);
          card.scope = null;
        }
        card.taskDraft = null;
        card.editing = false;
        card.signature = null;
        await card.render();
        return true;
      };
      const blur = () =>
        setTimeout(() => {
          if (card.taskDraft && !root.contains(root.ownerDocument.activeElement)) card.finishTask();
        }, 0);
      root.addEventListener('focusout', blur);
      const key = (e) => {
        if (!root.contains(e.target)) return;
        if (
          !card.taskDraft &&
          e.target.matches('.ot-task') &&
          ['Backspace', 'Delete'].includes(e.key) &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const task = lookup(this.path);
          card.currentTask = task;
          if (task) plugin.trashTask(task).catch((error) => new Notice(error.message));
          return;
        }
        if (!card.taskDraft) return;
        if (
          e.key === 'Escape' ||
          (e.key === 'Enter' && e.target.matches('.ot-title-input') && !e.isComposing)
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const pop = root.querySelector('.ot-popover');
          if (e.key === 'Escape' && pop) {
            if (pop.close) pop.close();
            else pop.remove();
            return;
          }
          card.finishTask().then((ok) => {
            if (ok) root.querySelector('.ot-task')?.focus({ preventScroll: true });
          });
        }
      };
      root.ownerDocument.defaultView.addEventListener('keydown', key, true);
      card.dispose = () => {
        if (card.disposed) return;
        card.disposed = true;
        card.cancelChecklistDrag?.();
        if (card.scope) {
          plugin.app.keymap.popScope(card.scope);
          card.scope = null;
        }
        root.ownerDocument.defaultView.removeEventListener('keydown', key, true);
        clearTimeout(card.saveTimer);
        card.saveTaskDraft();
        cards.delete(card);
      };
      root._thingsCard = card;
      cards.add(card);
      card.render();
      return root;
    }
    destroy(dom) {
      dom._thingsCard?.dispose();
    }
    ignoreEvent() {
      return true;
    }
  }
  const readingDrag = require('./reading-drag.cjs')(plugin);
  // Reading mode uses the exact same card and task editor as Live Preview.
  // Replace the embed itself, so Obsidian cannot display its filename/open-link UI.
  plugin.registerMarkdownPostProcessor((element, context) => {
    if (element.closest('.ot-native') || element.closest('.cm-editor')) return;
    readingDrag.section(element, context.getSectionInfo(element), context.sourcePath);
    const usedLines = new Set();
    for (const embed of element.querySelectorAll('.internal-embed')) {
      if (embed.closest('.ot-native')) continue;
      const source = embed.getAttribute('src') || '';
      if (!/^\.thingsmd-storage\/[^#|]+$/.test(source)) continue;
      const path = source.endsWith('.md') ? source : source + '.md';
      if (!lookup(path)) continue;
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
        root._thingsCard?.dispose();
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
    let fence = null;
    let yaml = false;
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      if (i === 1 && line.text === '---') {
        yaml = true;
        continue;
      }
      if (yaml) {
        if (line.text === '---') yaml = false;
        continue;
      }
      const previousFence = fence;
      fence = nextFence(fence, line.text);
      if (previousFence || fence) continue;
      const match = line.text.match(/^!\[\[(\.thingsmd-storage\/[^\]|]+?)(?:\.md)?\]\]$/);
      if (match && lookup(`${match[1]}.md`))
        ranges.push(
          Decoration.replace({
            widget: new TaskWidget(`${match[1]}.md`),
            block: true,
            inclusive: true,
          }).range(line.from, line.to),
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
            let found = false;
            view.state.field(field).between(line.from, line.to, (from, to, decoration) => {
              if (
                from === line.from &&
                decoration.spec.widget instanceof TaskWidget &&
                !isHidden(lookup(decoration.spec.widget.path)?.meta || {})
              )
                found = true;
            });
            return found;
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
          this.key = (e) => {
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
              const number = line.number + direction;
              e.preventDefault();
              e.stopImmediatePropagation();
              if (number < 1 || number > view.state.doc.lines) return;
              target = view.state.doc.line(number);
              if (taskAt(target)) focusTask(target);
              else {
                view.dispatch({
                  selection: { anchor: Math.min(target.from + this.column, target.to) },
                  scrollIntoView: true,
                });
                view.focus();
              }
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
            if (taskAt(line)) target = line;
            else {
              // Let CodeMirror traverse wrapped visual lines before entering a task.
              const caret = view.coordsAtPos(pos);
              const block = view.lineBlockAt(pos);
              if (
                caret &&
                (direction > 0
                  ? caret.bottom < view.documentTop + block.bottom - view.defaultLineHeight / 2
                  : caret.top > view.documentTop + block.top + view.defaultLineHeight / 2)
              )
                return;
              const number = line.number + direction;
              if (number < 1 || number > view.state.doc.lines) return;
              target = view.state.doc.line(number);
              if (!taskAt(target)) return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            focusTask(target);
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
        const path = `.thingsmd-storage/${id}.md`;
        const fields = { title: '', project: file.path, order: Date.now() };
        // Render immediately; disk creation must not swallow the next typed character.
        const provisional = {
          file: { path },
          meta: { type: 'things-task', id, status: 'todo', ...fields },
          body: '',
        };
        records.push(provisional);
        openOnCreate.add(path);
        const write = plugin.createTask(fields, id).then((task) => {
          records = records.map((r) => (r.file.path === path ? task : r));
          pendingWrites.delete(path);
          return task;
        });
        pendingWrites.set(path, write);
        write.catch((error) => new Notice(`Could not create task: ${error.message}`));
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
