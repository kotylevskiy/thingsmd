// Obsidian 1.13 split destructive styling from CTA styling; retain older support.
module.exports = (button) => {
  if (typeof button.setDestructive === 'function') button.setDestructive().setCta();
  else button.setWarning();
  return button;
};
