const { Notice } = require('obsidian');

module.exports = function installCaptureUri(plugin) {
  plugin.registerObsidianProtocolHandler('thingsmd', ({ command, title, description }) => {
    if (command !== 'capture') {
      new Notice('ThingsMD URL requires command=capture.');
      return;
    }
    if (plugin.captureModal) {
      plugin.capture();
      new Notice('Finish or cancel the open task draft, then reopen the ThingsMD URL.');
      return;
    }
    // Obsidian decodes the query. Keep the title on one line and pass the
    // description as Markdown body content, separate from task metadata.
    const name = typeof title === 'string' ? title.replace(/\r\n|[\r\n]/g, ' ') : '';
    plugin.capture({ title: name }, typeof description === 'string' ? description : '');
  });
};
