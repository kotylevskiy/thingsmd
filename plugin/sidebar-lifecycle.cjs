// Mobile can build/rebuild the file explorer after workspace layout events fire.
// Watch structural changes as well, so its shortcuts follow the actual DOM lifecycle.
function install(plugin, root = document.body) {
  const drawer = '.workspace-drawer, .workspace-drawer-inner';
  const selector = `.nav-files-container, .nav-header, .ot-list-links, ${drawer}`;
  const relevant = (node) =>
    node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector));
  let timer;
  const painted = new WeakSet();
  const repaintRevealed = () => {
    for (const element of root.querySelectorAll('.workspace-drawer')) {
      const box = element.getBoundingClientRect();
      const visible =
        box.width > 0 &&
        box.height > 0 &&
        box.left >= -0.5 &&
        box.right <= root.ownerDocument.documentElement.clientWidth + 0.5;
      if (!visible) painted.delete(element);
      else if (!painted.has(element)) {
        painted.add(element);
        for (const nav of element.querySelectorAll('.ot-list-links')) repaintLinks(nav);
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      plugin.mountListLinks();
      repaintRevealed();
    }, 0);
  };
  const watchDrawers = () => {
    for (const element of root.querySelectorAll(drawer))
      observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
  };
  const observer = new root.ownerDocument.defaultView.MutationObserver((mutations) => {
    if (
      !mutations.some((mutation) =>
        mutation.type === 'attributes'
          ? mutation.target.matches(drawer)
          : [...mutation.addedNodes, ...mutation.removedNodes].some(relevant),
      )
    )
      return;
    if (mutations.some((mutation) => mutation.type !== 'attributes')) watchDrawers();
    schedule();
  });
  // Revealing a mobile drawer changes styles/classes, not necessarily its DOM.
  observer.observe(root, { childList: true, subtree: true });
  watchDrawers();
  const revealed = (event) => {
    if (event.target.matches?.(drawer)) schedule();
  };
  plugin.registerDomEvent(root, 'transitionend', revealed, true);
  plugin.registerDomEvent(root, 'animationend', revealed, true);
  const resume = () => {
    if (!root.ownerDocument.hidden) plugin.mountListLinks();
  };
  plugin.registerDomEvent(root.ownerDocument, 'visibilitychange', resume);
  plugin.register(() => {
    observer.disconnect();
    clearTimeout(timer);
  });
}

// Reattach the existing control to invalidate a stale WebKit paint surface.
// Keep its handlers, focus, and the separate file-list scroll position intact.
function repaintLinks(nav) {
  const parent = nav.parentNode;
  if (!parent) return;
  const next = nav.nextSibling;
  const focused = nav.contains(nav.ownerDocument.activeElement)
    ? nav.ownerDocument.activeElement
    : null;
  nav.remove();
  parent.insertBefore(nav, next);
  focused?.focus({ preventScroll: true });
}

function placeLinks(files, nav, header) {
  const anchor = header?.parentElement === files.parentElement ? header : files;
  if (nav.parentElement !== files.parentElement || nav.nextElementSibling !== anchor)
    anchor.before(nav);
}
module.exports = { install, placeLinks, repaintLinks };
