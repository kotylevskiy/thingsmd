const { nextFence } = require('./markdown-fence.cjs');
// Move a complete reference line with one undoable editor transaction.
function lineMove(text, from, to, target) {
  if (target >= from && target <= Math.min(to + 1, text.length)) return null;
  const reference = text.slice(from, to);
  let removeFrom = from,
    removeTo = Math.min(to + 1, text.length);
  if (to === text.length && from > 0) removeFrom--;
  const prefix = target === text.length && !text.endsWith('\n') ? '\n' : '';
  const suffix = target === text.length && !text.endsWith('\n') ? '' : '\n';
  const insert = prefix + reference + suffix;
  const changes = [
    { from: removeFrom, to: removeTo, insert: '' },
    { from: target, insert },
  ].sort((a, b) => a.from - b.from);
  return {
    changes,
    anchor: target - (target > removeFrom ? removeTo - removeFrom : 0) + prefix.length,
  };
}
function mountDrag(view, EditorView, transfer) {
  const doc = view.dom.ownerDocument,
    win = doc.defaultView;
  let drag = null,
    suppressClickUntil = 0;
  const isTask = (root) =>
    root && view.contentDOM.contains(root) && !root.querySelector('.is-expanded');
  const safeBoundary = (pos) => {
    if (pos === 0 && view.state.doc.line(1).text === '---') return false;
    let fence = null,
      yaml = false;
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const line = view.state.doc.line(n);
      if (line.from >= pos) break;
      if (n === 1 && line.text === '---') {
        yaml = true;
        continue;
      }
      if (yaml) {
        if (line.text === '---') yaml = false;
        continue;
      }
      fence = nextFence(fence, line.text);
    }
    return !yaml && !fence;
  };
  const locate = () => {
    const { x, y } = drag;
    const area = view.scrollDOM.getBoundingClientRect();
    const elementAtPoint = doc.elementFromPoint(x, y);
    const list = elementAtPoint?.closest('.ot-list-link[data-list]');
    if (transfer && list && !list.hidden && list.dataset.list !== 'logbook')
      return { note: list, list: list.dataset.list };
    const note = elementAtPoint?.closest('.nav-file-title[data-path]');
    if (transfer && note?.dataset.path.endsWith('.md')) return { note, path: note.dataset.path };
    if (x < area.left || x > area.right || y < area.top || y > area.bottom) return null;
    const element = doc.elementFromPoint(x, y);
    const root = element?.closest('.ot-native');
    let line, bounds;
    if (root && view.contentDOM.contains(root)) {
      line = view.state.doc.lineAt(view.posAtDOM(root));
      bounds = root.getBoundingClientRect();
    } else if (element?.closest('.cm-line') && view.contentDOM.contains(element)) {
      // Native widgets can make CodeMirror's coordinate map lag behind the DOM.
      const renderedLine = element.closest('.cm-line');
      line = view.state.doc.lineAt(view.posAtDOM(renderedLine));
      bounds = renderedLine.getBoundingClientRect();
    } else {
      const pos = view.posAtCoords({ x, y }, false);
      if (pos === null) return null;
      line = view.state.doc.lineAt(pos);
      const block = view.lineBlockAt(line.from);
      bounds = { top: view.documentTop + block.top, bottom: view.documentTop + block.bottom };
    }
    const after = y > (bounds.top + bounds.bottom) / 2;
    const target = after ? Math.min(line.to + 1, view.state.doc.length) : line.from;
    if (!safeBoundary(target)) return null;
    const content = view.contentDOM.getBoundingClientRect();
    return {
      target,
      top: after ? bounds.bottom : bounds.top,
      left: Math.max(content.left, area.left) + 4,
      width: Math.min(content.right, area.right) - Math.max(content.left, area.left) - 8,
    };
  };
  const paint = () => {
    if (!drag?.started) return;
    drag.ghost.style.left = `${drag.x + 14}px`;
    drag.ghost.style.top = `${drag.y + 12}px`;
    drag.destination = locate();
    const target = drag.destination;
    drag.note?.classList.remove('ot-note-drop-target');
    drag.note = target?.note;
    drag.note?.classList.add('ot-note-drop-target');
    drag.marker.hidden = !target || !!target.note;
    if (target && !target.note)
      Object.assign(drag.marker.style, {
        top: `${target.top}px`,
        left: `${target.left}px`,
        width: `${target.width}px`,
      });
  };
  const tick = () => {
    if (!drag?.started) return;
    const box = view.scrollDOM.getBoundingClientRect();
    if (drag.x >= box.left && drag.x <= box.right) {
      const delta =
        drag.y < box.top + 45
          ? -Math.min(16, (box.top + 45 - drag.y) / 3)
          : drag.y > box.bottom - 45
            ? Math.min(16, (drag.y - box.bottom + 45) / 3)
            : 0;
      if (delta) view.scrollDOM.scrollTop += delta;
    }
    paint();
    drag.frame = win.requestAnimationFrame(tick);
  };
  const cleanup = () => {
    if (!drag) return;
    win.cancelAnimationFrame(drag.frame);
    drag.root.classList.remove('ot-pointer-dragging');
    drag.ghost?.remove();
    drag.marker?.remove();
    drag.note?.classList.remove('ot-note-drop-target');
    doc.body.classList.remove('ot-task-drag-active');
    drag = null;
    win.removeEventListener('pointermove', move, true);
    win.removeEventListener('pointerup', up, true);
    win.removeEventListener('pointercancel', cancel, true);
    win.removeEventListener('keydown', key, true);
    win.removeEventListener('blur', cancel);
  };
  const cancel = () => {
    if (drag?.started) suppressClickUntil = Date.now() + 250;
    cleanup();
  };
  const key = (e) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    }
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    if (view.state.doc !== drag.snapshot) {
      cancel();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!drag.started) {
      drag.started = true;
      drag.root.classList.add('ot-pointer-dragging');
      doc.body.classList.add('ot-task-drag-active');
      drag.ghost = doc.createElement('div');
      drag.ghost.className = 'ot-task-drag-ghost';
      drag.ghost.textContent = drag.title;
      doc.body.append(drag.ghost);
      drag.marker = doc.createElement('div');
      drag.marker.className = 'ot-task-drop-marker';
      doc.body.append(drag.marker);
      tick();
    }
    paint();
  };
  const up = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const state = drag;
    if (!state.started) {
      cleanup();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressClickUntil = Date.now() + 250;
    const destination = locate();
    cleanup();
    if (!destination || view.state.doc !== state.snapshot) return;
    if (destination.path || destination.list) {
      transfer(state.root.dataset.taskPath, destination.path, destination.list);
      return;
    }
    const change = lineMove(view.state.doc.toString(), state.from, state.to, destination.target);
    if (!change) return;
    view.dispatch({
      changes: change.changes,
      selection: { anchor: change.anchor },
      effects: EditorView.scrollIntoView(change.anchor, { y: 'nearest' }),
      userEvent: 'move.drop',
    });
    win.requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      for (const root of view.contentDOM.querySelectorAll('.ot-native'))
        if (view.posAtDOM(root) === change.anchor) {
          root.querySelector('.ot-task')?.focus({ preventScroll: true });
          break;
        }
    });
  };
  const down = (e) => {
    if (
      e.button !== 0 ||
      (e.pointerType === 'touch' && !e.touchDrag) ||
      e.target.closest('input,textarea,button,a') ||
      drag
    )
      return;
    const root = e.target.closest('.ot-native');
    if (!isTask(root)) return;
    const line = view.state.doc.lineAt(view.posAtDOM(root));
    drag = {
      root,
      pointerId: e.pointerId,
      from: line.from,
      to: line.to,
      snapshot: view.state.doc,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      title: root.querySelector('.ot-task-title')?.textContent || 'Task',
    };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', cancel, true);
    win.addEventListener('keydown', key, true);
    win.addEventListener('blur', cancel);
  };
  const blockClick = (e) => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const blockNative = (e) => {
    if (drag) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  view.dom._otTouchDrag = {
    down,
    move,
    up,
    cancel,
    hold: () => {
      suppressClickUntil = 0;
    },
  };
  view.dom.addEventListener('pointerdown', down, true);
  view.dom.addEventListener('click', blockClick, true);
  view.dom.addEventListener('dragstart', blockNative, true);
  return () => {
    delete view.dom._otTouchDrag;
    cleanup();
    view.dom.removeEventListener('pointerdown', down, true);
    view.dom.removeEventListener('click', blockClick, true);
    view.dom.removeEventListener('dragstart', blockNative, true);
  };
}
module.exports = { lineMove, mountDrag };
