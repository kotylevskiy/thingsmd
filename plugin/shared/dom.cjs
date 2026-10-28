const { setIcon } = require('obsidian');
function button(parent, label, action, cls = '') {
  const b = parent.createEl('button', { text: label, cls, attr: { type: 'button' } });
  b.onclick = action;
  return b;
}
function iconButton(parent, label, icon, action) {
  const b = button(parent, '', action, 'ot-icon-button');
  b.setAttribute('aria-label', label);
  b.setAttribute('title', label);
  setIcon(b, icon);
  return b;
}

// Obsidian renamed this host control in newer versions. Keep compatibility in
// one place instead of relying on theme CSS or checking only the old class.
function removeModalCloseButton(modalEl) {
  modalEl
    .querySelectorAll(':scope > .modal-close-button, :scope > .modal-header-button')
    .forEach((button) => button.remove());
}
function closePopover(root) {
  const pop = root.querySelector('.ot-popover');
  if (!pop) return false;
  if (pop.close) pop.close();
  else pop.remove();
  return true;
}
module.exports = { button, iconButton, removeModalCloseButton, closePopover };
