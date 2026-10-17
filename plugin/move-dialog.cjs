const { Modal, Platform, setIcon } = require('obsidian');
const { projectProgress, renderProgress } = require('./project-progress.cjs');
const { removeModalCloseButton } = require('./dom.cjs');
const { LISTS, isListAvailable } = require('./lists.cjs');
const { datePicker } = require('./date-picker.cjs');

// Destination selection is presentation; transferTask owns coordinated writes.
class MoveDialog extends Modal {
  constructor(plugin, ctx) {
    super(plugin.app);
    this.plugin = plugin;
    this.ctx = ctx;
  }
  async onOpen() {
    const plugin = this.plugin;
    this.setTitle('Move');
    this.modalEl.addClass('ot-move-modal');
    removeModalCloseButton(this.modalEl);
    this.containerEl.addClass('ot-move-container');
    const searchBar = this.contentEl.createDiv('ot-move-search');
    setIcon(searchBar.createSpan('ot-move-search-icon'), 'search');
    const search = searchBar.createEl('input', {
      attr: { type: 'search', placeholder: 'Move to…', 'aria-label': 'Find destination' },
    });
    const results = this.contentEl.createDiv('ot-move-results');
    const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
    const records = await plugin.records();
    if (!this.contentEl.isConnected) return;
    const progress = plugin.settings.showProjectProgress ? projectProgress(records) : new Map();
    const icons = Object.fromEntries(LISTS.map(([id, , icon]) => [id, icon]));
    const options = [
      ...LISTS.filter(([id]) => !['logbook', 'trash'].includes(id))
        .filter(([id]) => isListAvailable(id, plugin.settings))
        .map(([list, label]) => ({ list, label })),
      ...records
        .filter((t) => t.meta.type === 'things-project')
        .map((t) => ({ label: t.meta.title, path: t.file.path })),
    ];
    const counts = new Map();
    for (const o of options) counts.set(o.label, (counts.get(o.label) || 0) + 1);
    const position = () => {
      if (!this.modalEl.isConnected || innerWidth <= 600) return;
      const r = this.ctx.anchor || {
        left: innerWidth / 2 - 150,
        top: innerHeight / 2,
        bottom: innerHeight / 2,
      };
      const h = this.modalEl.offsetHeight,
        w = this.modalEl.offsetWidth;
      this.modalEl.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
      this.modalEl.style.top = `${Math.max(12, Math.min(r.top >= h + 20 ? r.top - h - 8 : r.bottom + 8, innerHeight - h - 12))}px`;
    };
    this.reposition = position;
    window.addEventListener('resize', position);
    const draw = () => {
      results.empty();
      const query = search.value.trim().toLowerCase();
      const matches = options.filter((o) =>
        (o.label + ' ' + (o.path || '')).toLowerCase().includes(query),
      );
      let notesStarted = false;
      for (const o of matches) {
        if (o.path && !notesStarted) {
          notesStarted = true;
          if (matches.some((m) => m.list)) results.createDiv('ot-move-divider');
        }
        const b = results.createEl('button', {
          cls: 'ot-move-option',
          attr: { type: 'button', 'aria-label': o.label },
        });
        if (o.list) setIcon(b.createSpan({ cls: 'ot-move-icon is-' + o.list }), icons[o.list]);
        else if (progress.has(o.path)) renderProgress(b, progress.get(o.path));
        const label = b.createSpan('ot-move-label');
        label.createSpan({ text: o.label });
        if (o.path && counts.get(o.label) > 1) label.createEl('small', { text: o.path });
        if (o.path && o.path === this.ctx.sourcePath) {
          setIcon(b.createSpan('ot-move-current'), 'check');
          b.setAttribute('aria-description', 'Current project');
        }
        b.onclick = async () => {
          if (this.busy) return;
          if (o.list === 'upcoming') {
            results.empty();
            const back = results.createEl('button', {
              cls: 'ot-move-back',
              text: '‹ Destinations',
              attr: { type: 'button' },
            });
            back.onclick = draw;
            results.createEl('p', { cls: 'ot-move-date-label', text: 'Schedule for' });
            const calendar = results.createDiv('ot-move-calendar');
            datePicker(calendar, {
              kind: 'when',
              inline: true,
              dateOnly: true,
              setIcon,
              onSelect: async (when) => {
                if (this.busy) return;
                this.busy = true;
                try {
                  const task = (await plugin.taskRecords()).find((t) => t.meta.id === this.ctx.id);
                  if (!task || task.meta.deleted) throw new Error('This task is unavailable.');
                  if (this.ctx.onSchedule) await this.ctx.onSchedule(when);
                  else await plugin.patchTask(task, { when });
                  this.close();
                } catch (e) {
                  error.textContent = e.message;
                  this.busy = false;
                }
              },
            });
            position();
            return;
          }
          this.busy = true;
          error.textContent = '';
          results.querySelectorAll('button').forEach((b) => (b.disabled = true));
          try {
            await plugin.transferTask({
              id: this.ctx.id,
              sourcePath: this.ctx.sourcePath,
              ...(o.path ? { destination: o.path } : { list: o.list }),
            });
            this.close();
          } catch (e) {
            error.textContent = e.message;
            this.busy = false;
            results.querySelectorAll('button').forEach((b) => (b.disabled = false));
          }
        };
      }
      if (!matches.length)
        results.createEl('p', { cls: 'ot-move-empty', text: 'No destinations found.' });
      requestAnimationFrame(position);
    };
    search.oninput = draw;
    this.contentEl.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
      const rows = [...results.querySelectorAll('.ot-move-option:not(:disabled)')];
      if (!rows.length) return;
      const index = rows.indexOf(document.activeElement);
      if (e.key === 'Enter') {
        if (document.activeElement === search) {
          e.preventDefault();
          rows[0].click();
        }
        return;
      }
      e.preventDefault();
      rows[
        Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
      ]?.focus();
    });
    draw();
    if (this.ctx.schedule) {
      results.querySelector('[aria-label="Upcoming"]').click();
    } else if (!Platform.isMobile) search.focus();
  }
  onClose() {
    window.removeEventListener('resize', this.reposition);
    this.contentEl.empty();
  }
}

module.exports = MoveDialog;
