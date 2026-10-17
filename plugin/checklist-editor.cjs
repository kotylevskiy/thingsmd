const { iconButton } = require('./dom.cjs');

// Checklist rows own keyboard/pointer gestures; the host owns the task draft and saves.
module.exports = function checklistEditor(parent, items, { disabled, onChange, fallbackFocus }) {
  const checklist = parent.createDiv('ot-checklist');
  let cancelDrag;
  const moveChecklist = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    onChange();
    renderChecklist();
    checklist.querySelectorAll('input:not([type=checkbox])')[to]?.focus();
  };
  const renderChecklist = () => {
    cancelDrag?.();
    checklist.empty();
    for (const [index, item] of items.entries()) {
      const itemRow = checklist.createDiv('ot-checklist-row');
      const check = itemRow.createEl('input', {
        attr: { type: 'checkbox', 'aria-label': `Checklist item ${index + 1}` },
      });
      check.checked = !!item.done;
      check.disabled = disabled;
      const text = itemRow.createEl('input', {
        attr: { 'aria-label': `Checklist text ${index + 1}`, placeholder: 'Checklist' },
      });
      text.value = item.text;
      check.onchange = () => {
        item.done = check.checked;
        onChange();
      };
      text.oninput = () => {
        item.text = text.value;
        onChange();
      };
      text.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          items.splice(index + 1, 0, { text: '', done: false });
          onChange();
          renderChecklist();
          checklist.querySelectorAll('input[type=text],input:not([type])')[index + 1]?.focus();
        }
        if (e.key === 'Backspace' && !text.value) {
          e.preventDefault();
          items.splice(index, 1);
          onChange();
          renderChecklist();
          (
            checklist.querySelectorAll('input:not([type=checkbox])')[Math.max(0, index - 1)] ||
            fallbackFocus
          ).focus();
        }
      };
      const grip = iconButton(
        itemRow,
        'Reorder checklist item ' + (index + 1),
        'grip-horizontal',
        () => {},
      );
      grip.addClass('ot-checklist-grip');
      grip.onkeydown = (e) => {
        if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          moveChecklist(index, index + (e.key === 'ArrowDown' ? 1 : -1));
        }
      };
      grip.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        cancelDrag?.();
        const win = parent.ownerDocument.defaultView,
          controller = new AbortController();
        let destination = index;
        const clean = () => {
          controller.abort();
          checklist
            .querySelectorAll('.is-checklist-target')
            .forEach((el) => el.removeClass('is-checklist-target'));
        };
        cancelDrag = clean;
        win.addEventListener(
          'pointermove',
          (event) => {
            const rows = [...checklist.children];
            destination = rows.findIndex((el) => event.clientY < el.getBoundingClientRect().bottom);
            if (destination < 0) destination = rows.length - 1;
            rows.forEach((el, i) =>
              el.toggleClass('is-checklist-target', i === destination && i !== index),
            );
          },
          { signal: controller.signal },
        );
        win.addEventListener(
          'pointerup',
          () => {
            clean();
            moveChecklist(index, destination);
          },
          { signal: controller.signal },
        );
        win.addEventListener('pointercancel', clean, { signal: controller.signal });
        win.addEventListener('blur', clean, { signal: controller.signal });
        win.addEventListener(
          'keydown',
          (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopImmediatePropagation();
              clean();
            }
          },
          { capture: true, signal: controller.signal },
        );
      };
    }
  };
  renderChecklist();
  return {
    add() {
      items.push({ text: '', done: false });
      onChange();
      renderChecklist();
      Array.from(checklist.querySelectorAll('input:not([type=checkbox])')).at(-1)?.focus();
    },
    cancelDrag: () => cancelDrag?.(),
  };
};
