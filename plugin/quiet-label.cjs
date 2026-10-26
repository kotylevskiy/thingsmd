// Obsidian displays aria-label as a hover tooltip. Keep an accessible name
// through a separate hidden label for controls that do not need hover help.
let labelId = 0;
function quietLabel(element, label) {
  const caption = element.ownerDocument.createElement('span');
  caption.className = 'ot-sr-only';
  // These IDs only connect DOM nodes. WebKit can omit crypto.randomUUID in
  // embedded documents, and a cryptographic identifier adds no value here.
  do caption.id = `ot-quiet-label-${++labelId}`;
  while (element.ownerDocument.getElementById(caption.id));
  caption.textContent = label;
  element.after(caption);
  element.dataset.quietLabel = label;
  element.removeAttribute('aria-label');
  element.setAttribute('aria-labelledby', caption.id);
}

module.exports = { quietLabel };
