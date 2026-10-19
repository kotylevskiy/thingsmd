// Electron's UI language can differ from the OS regional format. Mobile uses
// the browser's system locale; neither path uses Obsidian's translation setting.
function systemLocale() {
  try {
    const locale = require('@electron/remote').app.getSystemLocale();
    if (locale) return Intl.getCanonicalLocales(locale.replaceAll('_', '-'))[0];
  } catch {
    // Mobile and restricted renderer environments do not expose Electron.
  }
  return new Intl.DateTimeFormat().resolvedOptions().locale;
}
module.exports = { systemLocale };
