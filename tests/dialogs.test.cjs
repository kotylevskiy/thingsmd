const test = require('node:test');
const assert = require('node:assert/strict');
const install = require('../plugin/dialogs.cjs');

test('closed dialogs release ownership and plugin unload closes only remaining dialogs', () => {
  let cleanup;
  const plugin = {
    register: (fn) => {
      cleanup = fn;
    },
  };
  install(plugin);
  class Dialog {
    constructor(owner, label) {
      assert.equal(owner, plugin);
      this.label = label;
      this.closes = 0;
    }
    open() {}
    close() {
      this.closes++;
      this.onClose();
    }
    onClose() {
      this.cleaned = true;
    }
  }
  const closed = plugin.openDialog(Dialog, 'closed');
  const remaining = plugin.openDialog(Dialog, 'open');
  closed.close();
  cleanup();
  assert.equal(closed.closes, 1);
  assert.equal(remaining.closes, 1);
  assert.equal(remaining.cleaned, true);
  assert.equal(plugin.openDialog, undefined);
});
