// Obsidian often catches exceptions and displays their messages as Notices.
// Those failures never reach Playwright's pageerror listener.
export const runtimeErrorPattern =
  /(?:undefined|null) is not an object|cannot (?:read|set|convert) (?:propert|undefined|null)|\b[\w.$]+ is not a function|\b[\w.$]+ is not defined|\b(?:TypeError|ReferenceError|SyntaxError):/i;
export const runtimeNoticePrefix = 'ThingsMD UI runtime error: ';

// Self-contained because Playwright evaluates this function in each renderer.
export function installRuntimeNoticeAudit({ pattern, prefix }) {
  window.__thingsmdNoticeAudit?.disconnect();
  const errors = new RegExp(pattern, 'i');
  const seen = new Set();
  const selector = '.notice, [role="alert"]';
  const inspect = (element) => {
    if (element?.nodeType !== 1) return;
    const candidates = [...element.querySelectorAll(selector)];
    const owner = element.closest(selector);
    if (owner) candidates.push(owner);
    for (const candidate of candidates) {
      const message = candidate.textContent.trim();
      if (!errors.test(message) || seen.has(message)) continue;
      seen.add(message);
      console.error(prefix + message);
    }
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      inspect(
        mutation.target.nodeType === 1
          ? mutation.target.closest(selector)
          : mutation.target.parentElement,
      );
      for (const node of mutation.addedNodes) inspect(node);
    }
  });
  observer.observe(document, { childList: true, characterData: true, subtree: true });
  window.__thingsmdNoticeAudit = observer;
  if (document.body) inspect(document.body);
}
