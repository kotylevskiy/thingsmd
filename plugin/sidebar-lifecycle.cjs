// Mobile can build/rebuild the file explorer after workspace layout events fire.
// Watch structural changes as well, so its shortcuts follow the actual DOM lifecycle.
function install(plugin, root = document.body) {
  const selector = '.nav-files-container, .nav-header, .ot-list-links';
  const relevant = (node) =>
    node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector));
  let timer;
  const observer = new root.ownerDocument.defaultView.MutationObserver((mutations) => {
    if (
      !mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(relevant),
      )
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => plugin.mountListLinks(), 0);
  });
  observer.observe(root, { childList: true, subtree: true });
  const resume = () => {
    if (!root.ownerDocument.hidden) plugin.mountListLinks();
  };
  plugin.registerDomEvent(root.ownerDocument, 'visibilitychange', resume);
  plugin.register(() => {
    observer.disconnect();
    clearTimeout(timer);
  });
}

function placeLinks(files, nav, header) {
  const anchor = header?.parentElement === files.parentElement ? header : files;
  if (nav.parentElement !== files.parentElement || nav.nextElementSibling !== anchor)
    anchor.before(nav);
}
module.exports = { install, placeLinks };
