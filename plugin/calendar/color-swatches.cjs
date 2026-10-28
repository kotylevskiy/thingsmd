const { setIcon } = require('obsidian');
const { quietLabel } = require('../shared/quiet-label.cjs');
const PRESETS = [
  ['Red', '#d94b4b'],
  ['Orange', '#e67e22'],
  ['Amber', '#d8a622'],
  ['Yellow', '#f2cf5b'],
  ['Green', '#6da970'],
  ['Teal', '#54a8ab'],
  ['Cyan', '#4aaac5'],
  ['Blue', '#2d73be'],
  ['Indigo', '#6066c4'],
  ['Purple', '#b18bd0'],
  ['Pink', '#d66ba0'],
  ['Gray', '#858585'],
];
function colorSwatches(container, { current, save }) {
  const root = container.createDiv('ot-calendar-color-controls');
  const grid = root.createDiv({ cls: 'ot-calendar-color-grid', attr: { role: 'group' } });
  quietLabel(grid, 'Calendar colors');
  const buttons = [];
  let busy = false;
  const choose = async (color) => {
    if (busy || current().override === color) return;
    busy = true;
    for (const button of buttons) button.disabled = true;
    try {
      await save(color);
    } finally {
      busy = false;
      for (const button of buttons) button.disabled = false;
      if (root.isConnected) paint();
    }
  };
  const check = (element) => setIcon(element.createSpan('ot-calendar-swatch-check'), 'check');
  for (const [name, color] of PRESETS) {
    const button = grid.createEl('button', { cls: 'ot-calendar-swatch', attr: { type: 'button' } });
    button.style.setProperty('--calendar-swatch', color);
    button.dataset.color = color;
    quietLabel(button, name);
    check(button);
    button.onclick = () => void choose(color);
    buttons.push(button);
  }
  const defaultRow = root.createDiv('ot-calendar-default-color');
  const automatic = defaultRow.createEl('button', {
    cls: 'ot-calendar-color-auto ot-calendar-source-color',
    attr: { type: 'button' },
  });
  quietLabel(automatic, 'Default color');
  check(automatic);
  defaultRow.createSpan({ cls: 'ot-calendar-default-label', text: 'Default color' });
  automatic.onclick = () => void choose('');
  buttons.push(automatic);
  const sample = root.createSpan('ot-sr-only');
  const rgb = (color) => {
    sample.style.color = color;
    return sample.ownerDocument.defaultView.getComputedStyle(sample).color;
  };
  const contrast = (color) => {
    const [r, g, b] = rgb(color)
      .match(/[\d.]+/g)
      .map(Number);
    return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#202020' : '#ffffff';
  };
  const paint = () => {
    const { override, sourceColor } = current();
    const selected = rgb(override || sourceColor);
    for (const button of buttons.slice(0, -1)) {
      const matches = selected === rgb(button.dataset.color);
      button.toggleClass('is-selected', matches);
      button.setAttribute('aria-pressed', String(matches));
      button.style.setProperty('--calendar-check', contrast(button.dataset.color));
    }
    automatic.style.setProperty('--calendar-swatch', sourceColor);
    automatic.style.setProperty('--calendar-check', contrast(sourceColor));
    automatic.toggleClass('is-selected', !override);
    automatic.setAttribute('aria-pressed', String(!override));
  };
  paint();
  return root;
}
module.exports = { colorSwatches };
