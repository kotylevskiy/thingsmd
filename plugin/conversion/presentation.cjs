const { Notice } = require('obsidian');
const labels = { thingsmd: 'ThingsMD format', inline: 'Tasks Emoji / Dataview format' };
function report(result) {
  if (result.skipped)
    new Notice(
      `${result.skipped} tasks were skipped because their metadata or references could not be converted safely.`,
    );
}
module.exports = { labels, report };
