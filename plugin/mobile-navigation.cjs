const { Notice, Platform, setIcon } = require('obsidian');

// Obsidian exposes no navigation-bar API. Keep this optional DOM adapter isolated
// and restore host attributes/handlers when disabled, unloaded, or rebuilt.
module.exports = function installMobileNavigation(plugin, doc = document) {
  const actions = [
    { selector: '.mobile-navbar-action-new-tab', label: 'New task', run: () => plugin.capture() },
    {
      selector: '.mobile-navbar-action-quick-switcher',
      label: 'Search Tasks',
      icon: 'things-task-search',
      run: () => plugin.openSearch(),
    },
  ];
  const selector = actions.map(({ selector }) => `.mobile-navbar ${selector}`).join(',');
  const attributes = ['aria-label', 'title', 'role', 'tabindex'];
  const originals = new Map();
  let events,
    observer,
    disposed = false,
    scheduled = false,
    pending = false;
  const restore = (element, { attributes, icon }) => {
    // Keep the original node, including any host listeners, for exact restoration.
    icon?.replacement.replaceWith(icon.original);
    for (const [name, value] of Object.entries(attributes))
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
  };
  const reconcile = () => {
    for (const [element, values] of originals)
      if (!element.isConnected || !element.matches(selector)) {
        restore(element, values);
        originals.delete(element);
      }
    for (const element of doc.querySelectorAll(selector)) {
      if (!originals.has(element))
        originals.set(element, {
          attributes: Object.fromEntries(
            attributes.map((name) => [name, element.getAttribute(name)]),
          ),
        });
      const action = actions.find(({ selector }) => element.matches(selector));
      const original = originals.get(element);
      if (action.icon && !original.icon) {
        const host = element.querySelector('.clickable-icon');
        if (host) {
          const replacement = host.cloneNode(false);
          setIcon(replacement, action.icon);
          host.replaceWith(replacement);
          original.icon = { original: host, replacement };
        }
      }
      element.setAttribute('aria-label', action.label);
      element.setAttribute('title', action.label);
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
    }
  };
  const stop = () => {
    observer?.disconnect();
    observer = null;
    events?.abort();
    events = null;
    for (const [element, values] of originals) restore(element, values);
    originals.clear();
  };
  const intercept = (event) => {
    const element = event.target.closest?.(selector);
    if (!element || !originals.has(element)) return;
    if (['keydown', 'keyup'].includes(event.type) && !['Enter', ' '].includes(event.key)) return;
    // Stop host click and long-press handlers. Leave touch defaults alone so the
    // browser still synthesizes one click after a normal tap.
    event.stopImmediatePropagation();
    if (!['click', 'keydown', 'keyup', 'contextmenu', 'dblclick'].includes(event.type)) return;
    event.preventDefault();
    if (event.type !== 'click' && event.type !== 'keydown') return;
    if (event.repeat || pending || (event.type === 'click' && event.button !== 0)) return;
    const action = actions.find(({ selector }) => element.matches(selector));
    pending = true;
    Promise.resolve()
      .then(() => {
        if (!disposed && events) return action.run();
      })
      .catch((error) => new Notice(error.message))
      .finally(() => {
        pending = false;
      });
  };
  const refresh = () => {
    if (disposed || !Platform.isMobile || plugin.settings.mobileTaskNavigation !== true) {
      stop();
      return;
    }
    if (!events) {
      events = new doc.defaultView.AbortController();
      for (const type of [
        'pointerdown',
        'pointerup',
        'mousedown',
        'mouseup',
        'touchstart',
        'touchend',
        'click',
        'dblclick',
        'contextmenu',
        'keydown',
        'keyup',
      ])
        doc.addEventListener(type, intercept, {
          capture: true,
          passive: false,
          signal: events.signal,
        });
      observer = new doc.defaultView.MutationObserver((mutations) => {
        if (
          scheduled ||
          !mutations.some((mutation) =>
            [...mutation.addedNodes, ...mutation.removedNodes].some(
              (node) =>
                node.nodeType === 1 &&
                (node.matches('.mobile-navbar, .mobile-navbar-action') ||
                  node.querySelector('.mobile-navbar, .mobile-navbar-action')),
            ),
          )
        )
          return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (events && !disposed) reconcile();
        });
      });
      observer.observe(doc.body, { childList: true, subtree: true });
    }
    reconcile();
  };
  plugin.refreshMobileNavigation = refresh;
  plugin.app.workspace.onLayoutReady(refresh);
  refresh();
  plugin.register(() => {
    disposed = true;
    stop();
    delete plugin.refreshMobileNavigation;
  });
};
