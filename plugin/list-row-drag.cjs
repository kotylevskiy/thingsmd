// Mouse and touch adapters share the view's drop commands and ordering policy.
module.exports = function attachListDrag(view, row, task, occurrence, expanded) {
  row.draggable = !expanded && !['trash', 'logbook'].includes(view.page);
  row.ondragstart = (e) => {
    if (view.editing || e.target.closest('input,textarea')) {
      e.preventDefault();
      return;
    }
    view.selectTask(task.meta.id, occurrence);
    view.dragging = true;
    e.dataTransfer.setData('text/ot-task', task.meta.id);
    e.dataTransfer.setData('text/ot-occurrence', occurrence);
    e.dataTransfer.effectAllowed = 'move';
    row.addClass('is-dragging');
  };
  if (!expanded && !['trash', 'logbook', 'repeating'].includes(view.page)) {
    let target = null,
      ghost = null,
      frame;
    const clean = () => {
      cancelAnimationFrame(frame);
      target?.classList.remove('is-over', 'is-over-after');
      target = null;
      ghost?.remove();
      ghost = null;
      view.dragging = false;
      row.removeClass('is-dragging');
    };
    let x, y;
    const locate = () => {
      target?.classList.remove('is-over', 'is-over-after');
      target = row.ownerDocument
        .elementFromPoint(x, y)
        ?.closest('.ot-task,.ot-capture,.ot-list-link,.nav-file-title');
      if (target === row) target = null;
      target?.classList.add('is-over');
      if (target?.matches('.ot-task'))
        target.classList.toggle(
          'is-over-after',
          y > target.getBoundingClientRect().top + target.offsetHeight / 2,
        );
      if (ghost) {
        ghost.style.left = `${x + 12}px`;
        ghost.style.top = `${y + 12}px`;
      }
    };
    const tick = () => {
      const scroll = row.closest('.ot-main'),
        box = scroll?.getBoundingClientRect();
      if (box) {
        if (y < box.top + 40) scroll.scrollTop -= 10;
        else if (y > box.bottom - 40) scroll.scrollTop += 10;
      }
      locate();
      frame = requestAnimationFrame(tick);
    };
    row._otTouchDrag = {
      hold: () => {
        view.dragging = true;
      },
      down: (e) => {
        view.selectTask(task.meta.id, occurrence);
        view.dragging = true;
        row.addClass('is-dragging');
        x = e.clientX;
        y = e.clientY;
        ghost = document.createElement('div');
        ghost.className = 'ot-task-drag-ghost';
        ghost.textContent = task.meta.title;
        document.body.append(ghost);
        tick();
      },
      move: (e) => {
        x = e.clientX;
        y = e.clientY;
        locate();
      },
      up: () => {
        const destination = target,
          after = target?.classList.contains('is-over-after');
        clean();
        if (!destination) return;
        if (destination.matches('.ot-list-link')) {
          view.dropOnList(task.meta.id, destination.dataset.list);
          return;
        }
        if (destination.matches('.nav-file-title')) {
          view.run(() =>
            view.plugin.transferTask({ id: task.meta.id, destination: destination.dataset.path }),
          );
          return;
        }
        const group = destination.closest('.ot-group');
        if (group)
          view.dropInGroup(
            {
              dataTransfer: {
                getData: (key) => (key === 'text/ot-task' ? task.meta.id : occurrence),
              },
            },
            group,
            destination.dataset.taskId || null,
            after,
          );
      },
      cancel: clean,
    };
  }
  row.ondragend = () => {
    view.dragging = false;
    row.removeClass('is-dragging');
  };
  if (!['trash', 'logbook', 'repeating'].includes(view.page)) {
    row.ondragover = (e) => {
      if (expanded) return;
      e.preventDefault();
      row.toggleClass(
        'is-over-after',
        e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2,
      );
      row.addClass('is-over');
    };
    row.ondragleave = () => row.removeClass('is-over', 'is-over-after');
    row.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const after = row.hasClass('is-over-after');
      row.removeClass('is-over', 'is-over-after');
      view.dropInGroup(e, row.parentElement, task.meta.id, after);
    };
  }
};
