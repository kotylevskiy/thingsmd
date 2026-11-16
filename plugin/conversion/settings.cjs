const { Modal, Notice, Setting } = require('obsidian');
const { labels, report } = require('./presentation.cjs');

class ConfirmConversion extends Modal {
  constructor(plugin, plan, done) {
    super(plugin.app);
    this.plugin = plugin;
    this.plan = plan;
    this.done = done;
  }
  onOpen() {
    const { plan, contentEl } = this;
    contentEl.createEl('h2', { text: `Convert vault to ${labels[plan.direction]}?` });
    contentEl.createEl('p', {
      text: `This will convert ${plan.count} tasks in ${plan.noteCount} notes.`,
    });
    contentEl.createEl('p', {
      text:
        plan.direction === 'thingsmd'
          ? 'Checkboxes will become ThingsMD task cards backed by individual task files.'
          : 'All references to these tasks will become independent inline tasks. Their ThingsMD files will be deleted after the notes are saved.',
    });
    contentEl.createEl('p', {
      text: 'To try it first, convert a single note from its menu, or selected tasks from the Preview context menu.',
    });
    if (plan.skipped)
      contentEl.createEl('p', {
        text: `${plan.skipped} invalid or ambiguous tasks will be skipped.`,
      });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText('Convert entire vault')
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            try {
              report(await this.plugin.runConversion(plan));
              this.close();
            } catch (error) {
              new Notice(error.message);
              this.close();
            } finally {
              this.done?.();
            }
          }),
      );
  }
  onClose() {
    this.contentEl.empty();
  }
}
module.exports = function settings(plugin, container) {
  const section = container.createDiv({ cls: 'ot-conversion-settings-section' });
  new Setting(section).setName('Conversion').setHeading();
  for (const direction of ['thingsmd', 'inline']) {
    new Setting(section).setName(`Convert vault to ${labels[direction]}`).addButton((button) => {
      button.setButtonText('Convert…').setDisabled(true);
      button.buttonEl.setAttribute('aria-label', `Convert vault to ${labels[direction]}`);
      const refresh = async () => {
        try {
          const plan = await plugin.planConversion({ direction });
          if (section.isConnected) button.setDisabled(!plan.count);
        } catch (error) {
          button.setDisabled(true);
          button.buttonEl.title = error.message;
        }
      };
      void refresh();
      button.onClick(async () => {
        button.setDisabled(true);
        try {
          const plan = await plugin.planConversion({ direction });
          if (plan.count) plugin.openDialog(ConfirmConversion, plan, refresh);
        } catch (error) {
          new Notice(error.message);
        } finally {
          void refresh();
        }
      });
    });
  }
};
