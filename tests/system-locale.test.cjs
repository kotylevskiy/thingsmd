const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function resolveLocale(remote) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('plugin/system-locale.cjs', 'utf8'), {
    module,
    require: () => {
      if (remote instanceof Error) throw remote;
      return remote;
    },
    Intl: {
      getCanonicalLocales: Intl.getCanonicalLocales,
      DateTimeFormat: class {
        resolvedOptions() {
          return { locale: 'en-US' };
        }
      },
    },
  });
  return module.exports.systemLocale();
}
test('desktop regional locale wins over renderer language and normalizes separators', () => {
  assert.equal(resolveLocale({ app: { getSystemLocale: () => 'en_RU' } }), 'en-RU');
});
test('mobile and unavailable Electron fall back to the system browser locale', () => {
  assert.equal(resolveLocale(new Error('Mobile has no Electron')), 'en-US');
  assert.equal(resolveLocale({ app: {} }), 'en-US');
});
