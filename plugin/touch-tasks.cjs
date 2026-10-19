// Touch stays scrollable until a stationary hold. A held drag moves a task;
// releasing the hold without moving opens its existing actions menu.
module.exports = function install(plugin) {
  const doc = document,
    win = doc.defaultView;
  let state = null,
    suppressUntil = 0;
  const clear = () => {
    if (!state) return;
    clearTimeout(state.timer);
    state.row.classList.remove('ot-touch-held');
    state.driver?.cancel?.();
    state = null;
  };
  const cancel = () => {
    if (state?.held) suppressUntil = Date.now() + 500;
    clear();
  };
  const event = (e, t) => ({
    pointerId: t.identifier,
    pointerType: 'touch',
    button: 0,
    target: state.row,
    clientX: t.clientX,
    clientY: t.clientY,
    touchDrag: true,
    preventDefault: () => e.preventDefault(),
    stopImmediatePropagation: () => e.stopImmediatePropagation(),
  });
  plugin.registerDomEvent(
    doc,
    'touchstart',
    (e) => {
      suppressUntil = 0;
      if (e.touches.length !== 1) {
        cancel();
        return;
      }
      const row = e.target.closest('.ot-task[data-task-id]');
      const taskNote = row?.closest('.ot-task-note-controls');
      if (
        !row ||
        (row.classList.contains('is-expanded') && !taskNote) ||
        e.target.closest('input:not([type=checkbox]),textarea,button,a')
      )
        return;
      clear();
      const t = e.touches[0],
        native = row.closest('.cm-editor,.markdown-preview-view');
      state = {
        row,
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        // Task notes keep their controls expanded. They still need a hold menu,
        // but dragging this header must never reorder the native Markdown note.
        driver:
          taskNote || e.target.matches('input[type=checkbox]')
            ? undefined
            : native
              ? native._otTouchDrag
              : row._otTouchDrag,
      };
      state.driver?.hold?.();
      state.timer = setTimeout(() => {
        if (!state?.row.isConnected) {
          clear();
          return;
        }
        state.held = true;
        row.classList.add('ot-touch-held');
      }, 350);
    },
    { passive: true },
  );
  plugin.registerDomEvent(
    doc,
    'touchmove',
    (e) => {
      if (!state) return;
      const t = [...e.touches].find((t) => t.identifier === state.id);
      if (!t) {
        cancel();
        return;
      }
      if (!state.held) {
        if (Math.hypot(t.clientX - state.x, t.clientY - state.y) > 8) clear();
        return;
      }
      e.preventDefault();
      if (
        !state.dragging &&
        Math.hypot(t.clientX - state.x, t.clientY - state.y) > 8 &&
        state.driver
      ) {
        state.dragging = true;
        state.driver.down(
          event(e, { ...t, identifier: state.id, clientX: state.x, clientY: state.y }),
        );
      }
      if (state.dragging) state.driver.move(event(e, t));
    },
    { passive: false },
  );
  plugin.registerDomEvent(
    doc,
    'touchend',
    (e) => {
      if (!state) return;
      const t = [...e.changedTouches].find((t) => t.identifier === state.id);
      if (!t) return;
      if (state.held) {
        e.preventDefault();
        suppressUntil = Date.now() + 500;
        const current = state;
        if (current.dragging) current.driver.up(event(e, t));
        else plugin.showTaskMenu(current.row, { clientX: t.clientX, clientY: t.clientY });
      }
      clear();
    },
    { passive: false },
  );
  plugin.registerDomEvent(doc, 'touchcancel', cancel);
  plugin.registerDomEvent(win, 'blur', cancel);
  plugin.registerDomEvent(
    doc,
    'click',
    (e) => {
      if (
        Date.now() < suppressUntil &&
        e.target.closest('.ot-task') &&
        !e.target.closest('button,input:not([type=checkbox]),textarea')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  plugin.registerDomEvent(
    doc,
    'contextmenu',
    (e) => {
      if (state?.held) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  plugin.register(clear);
};
