const { Setting, Platform, Scope, setIcon } = require('obsidian');
function accelerator(event) {
  if (['Control', 'Meta', 'Alt', 'Shift', 'AltGraph'].includes(event.key) || event.isComposing)
    return null;
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.metaKey) modifiers.push('Super');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (!event.ctrlKey && !event.metaKey && !event.altKey)
    throw new Error('Include Command, Control, or Alt with the key.');
  const named = {
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Enter: 'Enter',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
  };
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit\d$/.test(event.code)
      ? event.code.slice(5)
      : /^F\d{1,2}$/.test(event.key)
        ? event.key
        : named[event.code];
  if (!key) throw new Error('This key cannot be used for global capture.');
  return [...modifiers, key].join('+');
}
function label(value, mac) {
  const names = mac
    ? {
        CommandOrControl: '⌘',
        CmdOrCtrl: '⌘',
        Command: '⌘',
        Cmd: '⌘',
        Super: '⌘',
        Meta: '⌘',
        Control: '⌃',
        Ctrl: '⌃',
        Alt: '⌥',
        Option: '⌥',
        Shift: '⇧',
      }
    : {
        CommandOrControl: 'Ctrl',
        CmdOrCtrl: 'Ctrl',
        Control: 'Ctrl',
        Super: 'Win',
        Meta: 'Win',
        Alt: 'Alt',
        Shift: 'Shift',
      };
  return value
    .split('+')
    .map((key) => names[key] || key)
    .join(' ');
}
module.exports = function hotkeySetting(plugin, container) {
  const setting = new Setting(container)
    .setName('Global capture shortcut')
    .setDesc(
      'Open capture from any app while this vault is open. Saves to the default capture destination.',
    );
  const keys = setting.controlEl.createDiv('setting-command-hotkeys');
  const add = setting.controlEl.createSpan({
    cls: 'clickable-icon setting-add-hotkey-button',
    attr: { 'aria-label': 'Customize global capture shortcut', role: 'button', tabindex: '0' },
  });
  setIcon(add, 'plus-circle');
  const status = setting.descEl.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
  const doc = container.ownerDocument,
    win = doc.defaultView;
  let recording = false,
    busy = false,
    disposed = false,
    resume = null,
    scope = null;
  const report = (error) => {
    status.textContent = error?.message || error || '';
  };
  const stop = () => {
    recording = false;
    doc.removeEventListener('keydown', keydown, true);
    if (scope) plugin.app.keymap.popScope(scope);
    scope = null;
    doc.removeEventListener('pointerdown', outside, true);
    win.removeEventListener('blur', cancel);
    // A settings tab may close while saveData is pending. Restore only after
    // the queued save has published its new preference (or rolled back).
    if (!busy) {
      const restore = resume;
      resume = null;
      try {
        restore?.();
      } catch (e) {
        report(e);
      }
    }
    render();
  };
  const save = async (value) => {
    busy = true;
    let saved = false;
    render();
    try {
      await plugin.setGlobalCaptureHotkey(value);
      saved = true;
      report('');
    } catch (e) {
      report(e);
    } finally {
      busy = false;
      if (saved || disposed) stop();
      else render();
    }
  };
  const cancel = () => {
    if (!busy) stop();
  };
  const outside = (e) => {
    if (!setting.settingEl.contains(e.target)) cancel();
  };
  const keydown = (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (busy || e.repeat) return;
    if (e.key === 'Escape') {
      cancel();
      add.focus();
      return;
    }
    try {
      const value = accelerator(e);
      if (value) void save(value);
    } catch (error) {
      report(error);
    }
  };
  const start = () => {
    if (busy) return;
    if (recording) {
      cancel();
      return;
    }
    report('');
    resume = plugin.pauseGlobalCapture();
    recording = true;
    // Intercept Escape before the enclosing settings modal's keymap closes it.
    scope = new Scope(plugin.app.scope);
    scope.register([], 'Escape', (event) => {
      keydown(event);
      return false;
    });
    plugin.app.keymap.pushScope(scope);
    doc.addEventListener('keydown', keydown, true);
    doc.addEventListener('pointerdown', outside, true);
    win.addEventListener('blur', cancel);
    render();
    add.focus();
  };
  function render() {
    if (disposed) return;
    keys.empty();
    add.toggleClass('mod-active', recording);
    add.setAttribute('aria-disabled', String(busy));
    const value = plugin.settings.globalCaptureHotkey;
    if (recording) {
      keys.createSpan({ cls: 'setting-hotkey mod-active', text: 'Press hotkey...' });
      return;
    }
    if (!value) {
      keys.createSpan({ cls: 'setting-hotkey mod-empty', text: 'Blank' });
      return;
    }
    const badge = keys.createSpan({
      cls: 'setting-hotkey',
      text: label(value, Platform.isMacOS) + ' ',
    });
    const remove = badge.createSpan({
      cls: 'setting-hotkey-icon setting-delete-hotkey',
      attr: { 'aria-label': 'Delete global capture hotkey', role: 'button', tabindex: '0' },
    });
    setIcon(remove, 'x');
    remove.onclick = () => {
      if (!busy) void save('');
    };
    remove.onkeydown = (e) => {
      if (['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        remove.click();
      }
    };
  }
  add.onclick = start;
  add.onkeydown = (e) => {
    if (!recording && ['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      start();
    }
  };
  report(plugin.globalCaptureError);
  render();
  return () => {
    stop();
    disposed = true;
  };
};
