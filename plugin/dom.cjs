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

module.exports = { button, iconButton };
